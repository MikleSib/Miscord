"""Управление сервером Miscord: роли, участники, баны, приглашения и аудит.

Смонтирован на /api/v1/servers. «Сервер» в проекте — это модель Channel.
"""

import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_active_user, get_optional_user
from app.core.media import to_public_media_path
from app.core.permissions import (
    ALL_PERMISSIONS,
    DEFAULT_PERMISSIONS,
    OWNER_POSITION,
    PERMISSION_CATALOG,
    PERMISSION_GROUPS,
    Permission,
    miscord_permissions_to_legacy,
    ensure_default_role,
    get_default_role,
    get_member_permissions,
    get_server,
    get_top_role_position,
    has_permission,
    is_member,
    require_membership,
    require_permission,
    require_hierarchy,
)
from app.db.database import get_db
from app.models import (
    AuditLog,
    Channel,
    ChannelMember,
    Invite,
    MemberRole,
    Role,
    ServerBan,
    TextChannel,
    User,
)
from app.schemas.server import (
    BanCreate,
    ChannelNotificationOverrideUpdate,
    InviteCreate,
    MemberUpdate,
    NotificationSettingsUpdate,
    RoleCreate,
    RoleReorderRequest,
    RoleUpdate,
    TransferOwnershipRequest,
)
from app.services.notification_settings import (
    delete_channel_override,
    get_settings as get_notification_settings,
    upsert_channel_override,
    upsert_settings as upsert_notification_settings,
)
from app.services.server_invites import find_reusable_invite
from app.services.audit_service import AuditAction, log_audit
from app.services.bot_event_dispatcher import (
    INTENT_GUILD_INVITES,
    INTENT_GUILD_MEMBERS,
    INTENT_GUILD_MODERATION,
    dispatcher as bot_event_dispatcher,
)
from app.services.miscord_serializers import miscord_role, miscord_user
from app.services.server_events import notify_server, notify_users
from app.services.server_membership import (
    add_member_and_notify,
    remove_member_rows,
    serialize_member_user,
)


INVITE_ALPHABET = string.ascii_letters + string.digits


# --------------------------------------------------------------------------
# Вспомогательные функции
# --------------------------------------------------------------------------

def _serialize_role(role: Role) -> dict:
    return {
        "id": role.id,
        "server_id": role.server_id,
        "name": role.name,
        "color": role.color,
        "position": int(role.position or 0),
        "permissions": int(role.permissions or 0),
        "is_default": bool(role.is_default),
        "created_at": role.created_at.isoformat() if role.created_at else None,
    }


async def _load_member_roles_map(db: AsyncSession, server_id: int) -> dict[int, list[Role]]:
    """Роли всех участников сервера одним запросом."""
    result = await db.execute(
        select(MemberRole.user_id, Role)
        .join(Role, MemberRole.role_id == Role.id)
        .where(MemberRole.server_id == server_id)
        .order_by(Role.position.desc())
    )
    mapping: dict[int, list[Role]] = {}
    for user_id, role in result.all():
        mapping.setdefault(user_id, []).append(role)
    return mapping


async def _miscord_member_update(db: AsyncSession, server_id: int, user_id: int) -> dict:
    user = await _get_user_or_404(db, user_id)
    membership = await db.scalar(select(ChannelMember).where(
        ChannelMember.channel_id == server_id,
        ChannelMember.user_id == user_id,
    ))
    role_ids = (await db.execute(select(MemberRole.role_id).where(
        MemberRole.server_id == server_id,
        MemberRole.user_id == user_id,
    ))).scalars().all()
    return {
        "guild_id": str(server_id),
        "roles": [str(role_id) for role_id in role_ids],
        "user": miscord_user(user),
        "nick": membership.nickname if membership else None,
        "avatar": None,
        "joined_at": membership.joined_at.isoformat() if membership and membership.joined_at else None,
        "deaf": False,
        "mute": False,
        "flags": 0,
        "pending": False,
        "communication_disabled_until": None,
    }


async def _serialize_members(db: AsyncSession, server: Channel) -> list[dict]:
    result = await db.execute(
        select(ChannelMember, User)
        .join(User, ChannelMember.user_id == User.id)
        .where(ChannelMember.channel_id == server.id)
    )
    rows = result.all()

    role_map = await _load_member_roles_map(db, server.id)
    default_role = await get_default_role(db, server.id)
    base_permissions = int(default_role.permissions) if default_role else DEFAULT_PERMISSIONS

    members: list[dict] = []
    for membership, user in rows:
        roles = role_map.get(user.id, [])
        is_owner = user.id == server.owner_id

        if is_owner:
            permissions = ALL_PERMISSIONS
        else:
            permissions = base_permissions
            for role in roles:
                permissions |= int(role.permissions or 0)
            if permissions & int(Permission.ADMINISTRATOR):
                permissions = ALL_PERMISSIONS

        members.append(
            {
                **serialize_member_user(user, nickname=membership.nickname),
                "user_id": user.id,
                "joined_at": membership.joined_at.isoformat() if membership.joined_at else None,
                "is_owner": is_owner,
                "roles": [_serialize_role(role) for role in roles],
                "role_ids": [role.id for role in roles],
                "color": next((role.color for role in roles if role.color), None),
                "top_role_position": OWNER_POSITION if is_owner else max(
                    (int(role.position or 0) for role in roles), default=0
                ),
                "permissions": permissions,
            }
        )

    members.sort(
        key=lambda item: (
            0 if item["is_owner"] else 1,
            -item["top_role_position"],
            (item["display_name"] or item["username"] or "").lower(),
        )
    )
    return members


async def _generate_invite_code(db: AsyncSession, length: int = 8) -> str:
    for _ in range(10):
        code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(length))
        existing = await db.execute(select(Invite.id).where(Invite.code == code))
        if existing.scalar_one_or_none() is None:
            return code
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Не удалось сгенерировать код приглашения",
    )


def _invite_is_expired(invite: Invite) -> bool:
    if invite.expires_at and invite.expires_at <= datetime.now(timezone.utc):
        return True
    if invite.max_uses and int(invite.uses or 0) >= int(invite.max_uses):
        return True
    return False


async def _invite_allowed_for_server(
    db: AsyncSession,
    server: Channel,
    invite: Invite,
) -> bool:
    """Можно ли войти по этому приглашению на текущих настройках сервера.

    На открытом сервере действуют любые неистёкшие ссылки.
    На закрытом — только ссылки от владельца или участника с правом CREATE_INVITE.
    Так «старые» ссылки, созданные когда сервер был открыт обычным участником,
    перестают работать после закрытия.
    """
    if bool(server.is_public):
        return True

    if invite.inviter_id is None:
        return False
    if invite.inviter_id == server.owner_id:
        return True

    # Приглашающий мог покинуть сервер — тогда ссылка больше недействительна
    if not await is_member(db, server.id, invite.inviter_id):
        return False

    permissions = await get_member_permissions(
        db, server.id, invite.inviter_id, owner_id=server.owner_id
    )
    return has_permission(permissions, Permission.CREATE_INVITE)


async def revoke_server_invites(db: AsyncSession, server_id: int) -> int:
    """Отзывает все приглашения сервера. Возвращает число удалённых ссылок."""
    result = await db.execute(delete(Invite).where(Invite.server_id == server_id))
    return int(result.rowcount or 0)


def _serialize_invite(invite: Invite, *, inviter: Optional[User] = None) -> dict:
    return {
        "id": invite.id,
        "code": invite.code,
        "server_id": invite.server_id,
        "inviter_id": invite.inviter_id,
        "inviter": {
            "id": inviter.id,
            "username": inviter.display_name or inviter.username,
            "avatar_url": inviter.avatar_url,
        } if inviter else None,
        "target_text_channel_id": invite.target_text_channel_id,
        "max_uses": invite.max_uses,
        "uses": int(invite.uses or 0),
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        "created_at": invite.created_at.isoformat() if invite.created_at else None,
        "is_expired": _invite_is_expired(invite),
    }


def _miscord_invite(invite: Invite, *, inviter: Optional[User] = None) -> dict:
    max_age = 0
    if invite.expires_at and invite.created_at:
        expires_at = invite.expires_at if invite.expires_at.tzinfo else invite.expires_at.replace(tzinfo=timezone.utc)
        created_at = invite.created_at if invite.created_at.tzinfo else invite.created_at.replace(tzinfo=timezone.utc)
        max_age = max(0, int((expires_at - created_at).total_seconds()))
    return {
        "channel_id": str(invite.target_text_channel_id) if invite.target_text_channel_id else None,
        "code": invite.code,
        "created_at": invite.created_at.isoformat() if invite.created_at else None,
        "guild_id": str(invite.server_id),
        "inviter": miscord_user(inviter) if inviter else None,
        "max_age": max_age,
        "max_uses": int(invite.max_uses or 0),
        "target_type": 0,
        "temporary": False,
        "uses": int(invite.uses or 0),
    }


async def _get_user_or_404(db: AsyncSession, user_id: int) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    return user


async def _get_role_or_404(db: AsyncSession, server_id: int, role_id: int) -> Role:
    result = await db.execute(
        select(Role).where(Role.id == role_id, Role.server_id == server_id)
    )
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Роль не найдена",
        )
    return role


async def _is_banned(db: AsyncSession, server_id: int, user_id: int) -> bool:
    result = await db.execute(
        select(ServerBan.id).where(
            ServerBan.server_id == server_id, ServerBan.user_id == user_id
        )
    )
    return result.scalar_one_or_none() is not None


# --------------------------------------------------------------------------
# Мета: справочник прав (без привязки к серверу)
# --------------------------------------------------------------------------

__all__ = [name for name in globals() if not name.startswith('__')]
