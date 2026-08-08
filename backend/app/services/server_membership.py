"""Добавление и удаление участников сервера с рассылкой событий."""

from typing import Optional

from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.permissions import ensure_default_role
from app.models import (
    Channel,
    ChannelMember,
    MemberRole,
    User,
    VoiceChannel,
    VoiceChannelUser,
)
from app.services.server_events import notify_server, notify_users
from app.services.bot_event_dispatcher import INTENT_GUILD_MEMBERS, dispatcher as bot_event_dispatcher
from app.services.miscord_serializers import miscord_user


def serialize_member_user(user: User, *, nickname: Optional[str] = None) -> dict:
    """Формат участника сервера — без email (PII)."""
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "nickname": nickname,
        "is_active": user.is_active,
        "is_online": user.is_online,
        "avatar_url": user.avatar_url,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
    }


async def build_server_payload(db: AsyncSession, server_id: int) -> Optional[dict]:
    """Полные данные сервера для события `server_created`."""
    result = await db.execute(
        select(Channel)
        .options(
            selectinload(Channel.owner),
            selectinload(Channel.text_channels),
            selectinload(Channel.voice_channels),
            selectinload(Channel.members),
        )
        .where(Channel.id == server_id)
    )
    server = result.scalar_one_or_none()
    if not server:
        return None

    owner = server.owner
    return {
        "id": server.id,
        "name": server.name,
        "description": server.description,
        "icon": server.icon,
        "banner": server.banner,
        "owner_id": server.owner_id,
        "created_at": server.created_at.isoformat() if server.created_at else None,
        "updated_at": server.updated_at.isoformat() if server.updated_at else None,
        "owner": {
            "id": owner.id,
            "username": owner.display_name or owner.username,
            "display_name": owner.display_name,
            "email": owner.email,
            "is_active": owner.is_active,
            "is_online": owner.is_online,
            "avatar_url": owner.avatar_url,
            "created_at": owner.created_at.isoformat() if owner.created_at else None,
            "updated_at": owner.updated_at.isoformat() if owner.updated_at else None,
        } if owner else None,
        "text_channels": [
            {
                "id": tc.id,
                "name": tc.name,
                "position": tc.position,
                "slow_mode_seconds": tc.slow_mode_seconds,
                "created_at": tc.created_at.isoformat() if tc.created_at else None,
            }
            for tc in sorted(filter_visible_text_channels(server.text_channels), key=lambda item: item.position)
        ],
        "voice_channels": [
            {
                "id": vc.id,
                "name": vc.name,
                "position": vc.position,
                "max_users": vc.max_users,
                "created_at": vc.created_at.isoformat() if vc.created_at else None,
            }
            for vc in sorted(server.voice_channels, key=lambda item: item.position)
        ],
        "members_count": len(server.members),
    }


async def add_member_and_notify(
    db: AsyncSession,
    server_id: int,
    user: User,
    *,
    invited_by: Optional[str] = None,
) -> None:
    """Добавляет участника (если ещё не добавлен) и рассылает события."""
    existing = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == server_id,
                ChannelMember.user_id == user.id,
            )
        )
    )
    if existing.scalar_one_or_none() is None:
        db.add(ChannelMember(channel_id=server_id, user_id=user.id))
        default_role = await ensure_default_role(db, server_id)
        db.add(
            MemberRole(
                server_id=server_id,
                role_id=default_role.id,
                user_id=user.id,
            )
        )
        await db.commit()

    server_payload = await build_server_payload(db, server_id)
    if server_payload:
        await notify_users(
            [user.id],
            {
                "type": "server_created",
                "server": server_payload,
                "invited_by": invited_by,
            },
        )

    await notify_server(
        db,
        server_id,
        {
            "type": "user_joined_channel",
            "channel_id": server_id,
            "user_id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
            "user": serialize_member_user(user),
        },
        exclude_user_id=user.id,
    )
    membership = await db.scalar(select(ChannelMember).where(
        ChannelMember.channel_id == server_id,
        ChannelMember.user_id == user.id,
    ))
    role_ids = (await db.execute(select(MemberRole.role_id).where(
        MemberRole.server_id == server_id,
        MemberRole.user_id == user.id,
    ))).scalars().all()
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server_id,
        "GUILD_MEMBER_ADD",
        {
            "guild_id": str(server_id),
            "user": miscord_user(user),
            "nick": membership.nickname if membership else None,
            "avatar": None,
            "roles": [str(role_id) for role_id in role_ids],
            "joined_at": membership.joined_at.isoformat() if membership and membership.joined_at else None,
            "deaf": False,
            "mute": False,
            "flags": 0,
            "pending": False,
            "communication_disabled_until": None,
        },
        required_intent=INTENT_GUILD_MEMBERS,
    )


async def remove_member_rows(db: AsyncSession, server_id: int, user_id: int) -> None:
    """Удаляет участника сервера: голосовое присутствие, роли, членство."""
    user = await db.get(User, user_id)
    voice_channel_ids_result = await db.execute(
        select(VoiceChannel.id).where(VoiceChannel.channel_id == server_id)
    )
    voice_channel_ids = [row[0] for row in voice_channel_ids_result.fetchall()]
    if voice_channel_ids:
        await db.execute(
            delete(VoiceChannelUser).where(
                and_(
                    VoiceChannelUser.user_id == user_id,
                    VoiceChannelUser.voice_channel_id.in_(voice_channel_ids),
                )
            )
        )

    await db.execute(
        delete(MemberRole).where(
            and_(MemberRole.server_id == server_id, MemberRole.user_id == user_id)
        )
    )
    await db.execute(
        delete(ChannelMember).where(
            and_(
                ChannelMember.channel_id == server_id,
                ChannelMember.user_id == user_id,
            )
        )
    )
    await db.commit()
    if user is not None:
        await bot_event_dispatcher.dispatch_guild_event(
            db,
            server_id,
            "GUILD_MEMBER_REMOVE",
            {"guild_id": str(server_id), "user": miscord_user(user)},
            required_intent=INTENT_GUILD_MEMBERS,
        )
