from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, delete, update
from sqlalchemy.orm import selectinload
from typing import List, Optional
from app.db.database import get_db
from app.models import (
    Channel, ChannelMember, TextChannel, VoiceChannel, User, ChannelType,
    VoiceChannelUser, Message, Reaction, Role, MemberRole, ServerBan, Invite, AuditLog, Attachment,
    ChannelPermissionOverwrite, ChannelKind,
)
from app.schemas.channel import (
    ChannelCreate, Channel as ChannelSchema, ChannelUpdate,
    TextChannelCreate, TextChannel as TextChannelSchema,
    VoiceChannelCreate, VoiceChannel as VoiceChannelSchema,
    TextChannelUpdate, VoiceChannelUpdate
)
from app.schemas.user import User as UserResponse
from app.core.dependencies import get_current_active_user, get_current_user
from app.core.permissions import (
    DEFAULT_PERMISSIONS, Permission, ensure_default_role, get_default_role,
    get_member_permissions, has_permission, is_member as is_server_member,
    require_membership, require_permission
)
from app.websocket.connection_manager import manager
from datetime import timezone, datetime, timedelta
from app.schemas.message import MessageUpdate
from app.services.user_activity_service import user_activity_service
from app.services.audit_service import AuditAction, log_audit
from app.services.message_serializer import serialize_attachment
from app.services.server_membership import add_member_and_notify
from app.services.text_channel_visibility import (
    get_text_channel_any,
    get_visible_text_channel,
)
from app.services.channel_permissions import (
    filter_viewable_text_channels,
    filter_viewable_voice_channels,
)
from app.services.channel_access import (
    require_text_channel_access,
    require_voice_channel_access,
    user_can_manage_messages,
)
import secrets as secrets_mod

router = APIRouter()


async def _delete_server_text_messages(db: AsyncSession, server_id: int) -> None:
    """Удаляет все сообщения текстовых каналов сервера."""
    text_channel_ids_stmt = select(TextChannel.id).where(TextChannel.channel_id == server_id)
    text_channel_ids_result = await db.execute(text_channel_ids_stmt)
    text_channel_ids = [row[0] for row in text_channel_ids_result.fetchall()]

    if not text_channel_ids:
        return

    messages_stmt = select(Message.id).where(Message.text_channel_id.in_(text_channel_ids))
    messages_result = await db.execute(messages_stmt)
    message_ids = [row[0] for row in messages_result.fetchall()]

    if message_ids:
        await db.execute(delete(Attachment).where(Attachment.message_id.in_(message_ids)))
        await db.execute(delete(Reaction).where(Reaction.message_id.in_(message_ids)))

    await db.execute(
        update(Message)
        .where(Message.text_channel_id.in_(text_channel_ids))
        .values(reply_to_id=None)
    )
    await db.execute(delete(Message).where(Message.text_channel_id.in_(text_channel_ids)))


def _serialize_server_member(user: User) -> dict:
    """Формат участника сервера — без email (PII)."""
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "is_active": user.is_active,
        "is_online": user.is_online,
        "avatar_url": user.avatar_url,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
    }


async def _get_server_member_ids(db: AsyncSession, server_id: int) -> list[int]:
    result = await db.execute(
        select(ChannelMember.user_id).where(ChannelMember.channel_id == server_id)
    )
    return [row[0] for row in result.fetchall()]


async def _notify_server_member_joined(
    db: AsyncSession,
    server_id: int,
    joined_user: User,
    *,
    exclude_user_id: int | None = None,
) -> None:
    """Уведомляет всех участников сервера о новом члене (через /ws/notifications)."""
    member_ids = await _get_server_member_ids(db, server_id)
    message = {
        "type": "user_joined_channel",
        "channel_id": server_id,
        "user_id": joined_user.id,
        "username": joined_user.display_name or joined_user.username,
        "display_name": joined_user.display_name,
        "avatar_url": joined_user.avatar_url,
        "user": _serialize_server_member(joined_user),
    }
    for member_id in member_ids:
        if exclude_user_id is not None and member_id == exclude_user_id:
            continue
        await manager.send_to_user(member_id, message)


async def _notify_server_member_left(
    db: AsyncSession,
    server_id: int,
    left_user_id: int,
    *,
    exclude_user_id: int | None = None,
) -> None:
    member_ids = await _get_server_member_ids(db, server_id)
    message = {
        "type": "user_left_channel",
        "channel_id": server_id,
        "user_id": left_user_id,
    }
    for member_id in member_ids:
        if exclude_user_id is not None and member_id == exclude_user_id:
            continue
        await manager.send_to_user(member_id, message)


@router.get("/full")
async def get_full_server_data(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Возвращает информацию о серверах, где пользователь является участником.
    """
    # Получаем только серверы, где пользователь является участником
    stmt = (
        select(Channel)
        .join(ChannelMember, Channel.id == ChannelMember.channel_id)
        .where(ChannelMember.user_id == current_user.id)
        .options(
            selectinload(Channel.owner),
            selectinload(Channel.text_channels),
            selectinload(Channel.voice_channels)
        )
        .order_by(Channel.created_at)
    )
    result = await db.execute(stmt)
    channels = result.scalars().unique().all()

    servers = []
    for channel in channels:
        # Текстовые каналы без сообщений
        text_channels = []
        visible_text = await filter_viewable_text_channels(
            db, channel.id, current_user.id, channel.text_channels, owner_id=channel.owner_id
        )
        for tc in visible_text:
            text_channels.append({
                "id": tc.id,
                "name": tc.name,
                "position": tc.position,
                "slow_mode_seconds": tc.slow_mode_seconds,
                "created_at": tc.created_at
            })
        
        # Голосовые каналы без активных пользователей
        voice_channels = []
        visible_voice = await filter_viewable_voice_channels(
            db, channel.id, current_user.id, channel.voice_channels, owner_id=channel.owner_id
        )
        for vc in visible_voice:
            voice_channels.append({
                "id": vc.id,
                "name": vc.name,
                "position": vc.position,
                "max_users": vc.max_users,
                "bitrate": int(getattr(vc, "bitrate", 64) or 64),
                "video_quality": getattr(vc, "video_quality", None) or "auto",
                "created_at": vc.created_at
            })
            
        servers.append({
            "id": channel.id,
            "name": channel.name,
            "description": channel.description,
            "icon": channel.icon,
            "banner": channel.banner,
            "is_public": bool(channel.is_public),
            "owner_id": channel.owner_id,
            "created_at": channel.created_at,
            "updated_at": channel.updated_at,
            "owner": {
                "id": channel.owner.id,
                "username": channel.owner.display_name or channel.owner.username,
                "email": channel.owner.email,
                "is_active": channel.owner.is_active,
                "is_online": channel.owner.is_online,
                "avatar_url": channel.owner.avatar_url,
                "created_at": channel.owner.created_at,
                "updated_at": channel.owner.updated_at
            } if channel.owner else None,
            "text_channels": text_channels,
            "voice_channels": voice_channels
        })

    return {
        "servers": servers
    }

@router.post("/", response_model=ChannelSchema)
async def create_channel(
    channel_data: ChannelCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Создание нового канала (сервера)"""
    # Создаем основной канал
    db_channel = Channel(
        name=channel_data.name,
        description=channel_data.description,
        icon=channel_data.icon,
        owner_id=current_user.id
    )
    db.add(db_channel)
    await db.commit()
    await db.refresh(db_channel)
    
    # Автоматически добавляем создателя как участника
    member = ChannelMember(
        channel_id=db_channel.id,
        user_id=current_user.id
    )
    db.add(member)

    # Базовая роль @everyone — основа системы прав сервера
    db.add(Role(
        server_id=db_channel.id,
        name="@everyone",
        color=None,
        position=0,
        permissions=DEFAULT_PERMISSIONS,
        is_default=True,
    ))
    
    # Создаем дефолтный текстовый канал "general"
    default_text = TextChannel(
        name="general",
        channel_id=db_channel.id,
        position=0
    )
    db.add(default_text)
    
    # Создаем дефолтный голосовой канал "General"
    default_voice = VoiceChannel(
        name="General",
        channel_id=db_channel.id,
        position=0,
        max_users=0,
        bitrate=64,
        video_quality="auto",
    )
    db.add(default_voice)
    
    await db.commit()
    
    # Отправляем WebSocket уведомление только создателю (участнику) о новом сервере
    await manager.send_to_user(current_user.id, {
        "type": "server_created",
        "server": {
            "id": db_channel.id,
            "name": db_channel.name,
            "description": db_channel.description,
            "owner_id": db_channel.owner_id,
            "created_at": db_channel.created_at.isoformat(),
            "updated_at": db_channel.updated_at.isoformat() if db_channel.updated_at else None,
            "owner": {
                "id": current_user.id,
                "username": current_user.username,
                "email": current_user.email,
                "is_active": current_user.is_active,
                "is_online": current_user.is_online,
                "created_at": current_user.created_at.isoformat(),
                "updated_at": current_user.updated_at.isoformat() if current_user.updated_at else None
            },
            "text_channels": [],
            "voice_channels": [],
            "members_count": 1
        },
        "created_by": {
            "id": current_user.id,
            "username": current_user.username
        }
    })
    
    return {
        "id": db_channel.id,
        "name": db_channel.name,
        "description": db_channel.description,
        "owner_id": db_channel.owner_id,
        "created_at": db_channel.created_at,
        "updated_at": db_channel.updated_at,
        "owner": {
            "id": current_user.id,
            "username": current_user.username,
            "email": current_user.email,
            "is_active": current_user.is_active,
            "is_online": current_user.is_online,
            "created_at": current_user.created_at,
            "updated_at": current_user.updated_at
        },
        "text_channels": [],
        "voice_channels": [],
        "members_count": 1
    }

@router.get("/online-users")
async def get_online_users(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение списка онлайн пользователей"""
    online_users = await user_activity_service.get_online_users(db)
    
    return {
        "online_users": [
            {
                "id": user.id,
                "username": user.username,
                "avatar_url": user.avatar_url,
                "is_online": user.is_online,
                "last_activity": user.last_activity.isoformat() if user.last_activity else None
            }
            for user in online_users
        ],
        "count": len(online_users)
    }

@router.get("/", response_model=List[ChannelSchema])
async def get_all_channels(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение каналов (серверов) где пользователь является участником"""
    stmt = (
        select(Channel)
        .join(ChannelMember, Channel.id == ChannelMember.channel_id)
        .where(ChannelMember.user_id == current_user.id)
        .options(
            selectinload(Channel.owner),
            selectinload(Channel.members),
            selectinload(Channel.text_channels),
            selectinload(Channel.voice_channels)
        )
        .order_by(Channel.created_at)
    )
    result = await db.execute(stmt)
    channels = result.scalars().unique().all()
    
    response_channels = []
    for channel in channels:
        if not channel.owner:
            continue
            
        # Преобразуем модели SQLAlchemy в Pydantic схемы
        visible_text = await filter_viewable_text_channels(
            db, channel.id, current_user.id, channel.text_channels, owner_id=channel.owner_id
        )
        text_channels_schema = [TextChannelSchema.from_orm(tc) for tc in visible_text]
        visible_voice = await filter_viewable_voice_channels(
            db, channel.id, current_user.id, channel.voice_channels, owner_id=channel.owner_id
        )
        voice_channels_schema = [VoiceChannelSchema.from_orm(vc) for vc in visible_voice]

        response_channels.append({
            "id": channel.id,
            "name": channel.name,
            "description": channel.description,
            "icon": channel.icon,
            "banner": channel.banner,
            "is_public": bool(channel.is_public),
            "owner_id": channel.owner_id,
            "created_at": channel.created_at,
            "updated_at": channel.updated_at,
            "owner": {
                "id": channel.owner.id,
                "username": channel.owner.username,
                "email": channel.owner.email,
                "is_active": channel.owner.is_active,
                "is_online": channel.owner.is_online,
                "created_at": channel.owner.created_at,
                "updated_at": channel.owner.updated_at
            },
            "text_channels": text_channels_schema,
            "voice_channels": voice_channels_schema,
            "members_count": len(channel.members)
        })

    return response_channels

@router.put("/{channel_id}", response_model=ChannelSchema)
async def update_channel(
    channel_id: int,
    channel_data: ChannelUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Обновление настроек сервера (право «Управлять сервером»)"""
    # Находим канал
    stmt = select(Channel).options(selectinload(Channel.owner)).where(Channel.id == channel_id)
    result = await db.execute(stmt)
    channel = result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сервер не найден"
        )
    
    await require_permission(db, channel_id, current_user, Permission.MANAGE_SERVER)
    
    # Обновляем данные
    update_data = channel_data.dict(exclude_unset=True)
    was_public = bool(channel.is_public)
    becoming_private = (
        "is_public" in update_data
        and was_public
        and not bool(update_data.get("is_public"))
    )

    for field, value in update_data.items():
        setattr(channel, field, value)

    revoked_invites = 0
    if becoming_private:
        # Закрыли сервер — все старые ссылки-приглашения сразу перестают действовать
        revoke_result = await db.execute(delete(Invite).where(Invite.server_id == channel_id))
        revoked_invites = int(revoke_result.rowcount or 0)
        if revoked_invites:
            update_data = {**update_data, "revoked_invites": revoked_invites}
    
    channel.updated_at = func.now()
    await db.commit()
    await db.refresh(channel)

    await log_audit(
        db,
        channel_id,
        current_user,
        AuditAction.SERVER_UPDATE,
        target_type="server",
        target_id=channel_id,
        target_name=channel.name,
        changes=update_data,
    )

    if becoming_private and revoked_invites:
        await log_audit(
            db,
            channel_id,
            current_user,
            AuditAction.INVITE_DELETE,
            target_type="invite",
            target_id=None,
            target_name="*",
            changes={"reason": "server_closed", "revoked_count": revoked_invites},
        )
    
    # Отправляем WebSocket уведомление всем участникам сервера о обновлении
    # Получаем всех участников сервера
    members_stmt = select(ChannelMember.user_id).where(ChannelMember.channel_id == channel_id)
    members_result = await db.execute(members_stmt)
    member_ids = [row[0] for row in members_result.fetchall()]
    
    # Отправляем уведомление каждому участнику
    for member_id in member_ids:
        await manager.send_to_user(member_id, {
            "type": "server_updated",
            "data": {
                "server_id": channel.id,
                "name": channel.name,
                "description": channel.description,
                "icon": channel.icon,
                "banner": channel.banner,
                "is_public": bool(channel.is_public),
                "updated_by": {
                    "id": current_user.id,
                    "username": current_user.username,
                    "display_name": current_user.display_name
                }
            }
        })
    
    return {
        "id": channel.id,
        "name": channel.name,
        "description": channel.description,
        "icon": channel.icon,
        "banner": channel.banner,
        "is_public": bool(channel.is_public),
        "owner_id": channel.owner_id,
        "created_at": channel.created_at,
        "updated_at": channel.updated_at,
        "owner": {
            "id": channel.owner.id,
            "username": channel.owner.username,
            "email": channel.owner.email,
            "is_active": channel.owner.is_active,
            "is_online": channel.owner.is_online,
            "created_at": channel.owner.created_at,
            "updated_at": channel.owner.updated_at
        },
        "text_channels": [],
        "voice_channels": [],
        "members_count": 0
    }

@router.get("/{channel_id}")
async def get_channel_details(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение детальной информации о канале и участниках сервера"""
    # Получаем основной канал
    channel_result = await db.execute(
        select(Channel)
        .options(selectinload(Channel.owner))
        .where(Channel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Channel not found"
        )

    # Данные сервера доступны только его участникам
    await require_membership(db, channel_id, current_user)
    
    # Получаем текстовые каналы
    text_result = await db.execute(
        select(TextChannel)
        .where(TextChannel.channel_id == channel_id)
        .order_by(TextChannel.position)
    )
    all_text_channels = text_result.scalars().all()
    text_channels = await filter_viewable_text_channels(
        db, channel_id, current_user.id, all_text_channels, owner_id=channel.owner_id
    )
    
    # Получаем голосовые каналы
    voice_result = await db.execute(
        select(VoiceChannel).where(VoiceChannel.channel_id == channel_id).order_by(VoiceChannel.position)
    )
    all_voice_channels = voice_result.scalars().all()
    voice_channels = await filter_viewable_voice_channels(
        db, channel_id, current_user.id, all_voice_channels, owner_id=channel.owner_id
    )
    
    # Получаем участников сервера вместе с их серверными никнеймами
    members_result = await db.execute(
        select(ChannelMember, User)
        .join(User, User.id == ChannelMember.user_id)
        .where(ChannelMember.channel_id == channel_id)
    )
    member_rows = members_result.all()

    # Роли участников — для цвета имени в списке участников (как в Discord)
    member_roles_result = await db.execute(
        select(MemberRole.user_id, Role)
        .join(Role, MemberRole.role_id == Role.id)
        .where(MemberRole.server_id == channel_id)
        .order_by(Role.position.desc())
    )
    roles_by_user: dict[int, list[Role]] = {}
    for user_id, role in member_roles_result.all():
        roles_by_user.setdefault(user_id, []).append(role)

    return {
        "id": channel.id,
        "name": channel.name,
        "description": channel.description,
        "icon": channel.icon,
        "banner": channel.banner,
        "is_public": bool(channel.is_public),
        "owner_id": channel.owner_id,
        "created_at": channel.created_at,
        "updated_at": channel.updated_at,
        "members_count": len(member_rows),
        "type": "server",  # Это сервер, содержащий каналы
        "owner": {
            "id": channel.owner.id,
            "username": channel.owner.display_name or channel.owner.username,
            "email": channel.owner.email,
            "is_active": channel.owner.is_active,
            "is_online": channel.owner.is_online,
            "avatar_url": channel.owner.avatar_url,
            "created_at": channel.owner.created_at,
            "updated_at": channel.owner.updated_at
        } if channel.owner else None,
        "channels": [
            {"id": tc.id, "name": tc.name, "type": "text", "position": tc.position, "slow_mode_seconds": tc.slow_mode_seconds}
            for tc in text_channels
        ] + [
            {
                "id": vc.id,
                "name": vc.name,
                "type": "voice",
                "position": vc.position,
                "max_users": vc.max_users,
                "bitrate": int(getattr(vc, "bitrate", 64) or 64),
                "video_quality": getattr(vc, "video_quality", None) or "auto",
            }
            for vc in voice_channels
        ],
        "members": [
            {
                "id": member.id,
                "username": member.display_name or member.username,
                "display_name": member.display_name,
                "nickname": membership.nickname,
                "is_active": member.is_active,
                "is_online": member.is_online,
                "avatar_url": member.avatar_url,
                "created_at": member.created_at,
                "updated_at": member.updated_at,
                "is_owner": member.id == channel.owner_id,
                "role_ids": [role.id for role in roles_by_user.get(member.id, [])],
                "color": next(
                    (role.color for role in roles_by_user.get(member.id, []) if role.color),
                    None,
                ),
            }
            for membership, member in member_rows
        ]
    }

@router.post("/{channel_id}/join")
async def join_channel(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Присоединение к публичному серверу. Закрытый — только по приглашению."""
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Channel not found"
        )

    ban_result = await db.execute(
        select(ServerBan.id).where(
            and_(ServerBan.server_id == channel_id, ServerBan.user_id == current_user.id)
        )
    )
    if ban_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Вы заблокированы на этом сервере"
        )

    if not channel.is_public and current_user.id != channel.owner_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Сервер закрыт. Нужно приглашение.",
        )

    if await is_server_member(db, channel_id, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already a member of this channel"
        )

    await add_member_and_notify(db, channel_id, current_user)
    return {"detail": "Successfully joined the channel"}


@router.post("/{channel_id}/leave")
async def leave_channel(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Покинуть сервер (недоступно владельцу — только удаление сервера)."""
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сервер не найден",
        )

    if channel.owner_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Владелец не может покинуть сервер. Удалите сервер, если хотите закрыть его.",
        )

    member_result = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id,
            )
        )
    )
    if not member_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Вы не состоите в этом сервере",
        )

    voice_channel_ids_result = await db.execute(
        select(VoiceChannel.id).where(VoiceChannel.channel_id == channel_id)
    )
    voice_channel_ids = [row[0] for row in voice_channel_ids_result.fetchall()]
    if voice_channel_ids:
        await db.execute(
            delete(VoiceChannelUser).where(
                and_(
                    VoiceChannelUser.user_id == current_user.id,
                    VoiceChannelUser.voice_channel_id.in_(voice_channel_ids),
                )
            )
        )

    await db.execute(
        delete(MemberRole).where(
            and_(
                MemberRole.server_id == channel_id,
                MemberRole.user_id == current_user.id,
            )
        )
    )

    await db.execute(
        delete(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == current_user.id,
            )
        )
    )
    await db.commit()

    try:
        await _notify_server_member_left(
            db,
            channel_id,
            current_user.id,
            exclude_user_id=current_user.id,
        )
    except Exception as exc:
        print(f"[Leave] Не удалось уведомить участников сервера: {exc}")

    await log_audit(
        db,
        channel_id,
        current_user,
        AuditAction.MEMBER_LEAVE,
        target_type="member",
        target_id=current_user.id,
        target_name=current_user.display_name or current_user.username,
    )

    return {"detail": "Successfully left the server", "channel_id": channel_id}


@router.post("/{channel_id}/text-channels", response_model=TextChannelSchema)
async def create_text_channel(
    channel_id: int,
    channel_data: TextChannelCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Создание текстового канала (право «Управлять каналами»)"""
    await require_permission(db, channel_id, current_user, Permission.MANAGE_CHANNELS)

    # Создание текстового канала
    new_text_channel = TextChannel(
        name=channel_data.name,
        channel_id=channel_id,
        position=channel_data.position
    )
    db.add(new_text_channel)
    await db.commit()
    await db.refresh(new_text_channel)
    
    # Отправляем WebSocket уведомление всем пользователям
    try:
        await manager.broadcast({
            "type": "text_channel_created",
            "channel_id": channel_id,
            "text_channel": {
                "id": new_text_channel.id,
                "name": new_text_channel.name,
                "type": "text",
                "position": new_text_channel.position,
                "serverId": channel_id,
            },
            "created_by": {
                "id": current_user.id,
                "username": current_user.username
            }
        })
    except Exception as e:
        print(f"[channels] Не удалось разослать text_channel_created: {e}")

    await log_audit(
        db,
        channel_id,
        current_user,
        AuditAction.CHANNEL_CREATE,
        target_type="channel",
        target_id=new_text_channel.id,
        target_name=new_text_channel.name,
        changes={"kind": "text"},
    )
    
    return new_text_channel

@router.post("/{channel_id}/voice-channels", response_model=VoiceChannelSchema)
async def create_voice_channel(
    channel_id: int,
    channel_data: VoiceChannelCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Создание голосового канала (право «Управлять каналами»)"""
    await require_permission(db, channel_id, current_user, Permission.MANAGE_CHANNELS)

    # Создание голосового канала
    new_voice_channel = VoiceChannel(
        name=channel_data.name,
        channel_id=channel_id,
        position=channel_data.position,
        max_users=channel_data.max_users,
        bitrate=channel_data.bitrate,
        video_quality=channel_data.video_quality,
    )
    db.add(new_voice_channel)
    await db.commit()
    await db.refresh(new_voice_channel)
    
    # Отправляем WebSocket уведомление всем пользователям
    try:
        await manager.broadcast({
            "type": "voice_channel_created",
            "channel_id": channel_id,
            "voice_channel": {
                "id": new_voice_channel.id,
                "name": new_voice_channel.name,
                "type": "voice",
                "position": new_voice_channel.position,
                "max_users": new_voice_channel.max_users,
                "bitrate": new_voice_channel.bitrate,
                "video_quality": new_voice_channel.video_quality,
                "serverId": channel_id,
            },
            "created_by": {
                "id": current_user.id,
                "username": current_user.username
            }
        })
    except Exception as e:
        print(f"[channels] Не удалось разослать voice_channel_created: {e}")

    await log_audit(
        db,
        channel_id,
        current_user,
        AuditAction.CHANNEL_CREATE,
        target_type="channel",
        target_id=new_voice_channel.id,
        target_name=new_voice_channel.name,
        changes={"kind": "voice"},
    )
    
    return new_voice_channel

@router.put("/text/{text_channel_id}", response_model=TextChannelSchema)
async def update_text_channel(
    text_channel_id: int,
    channel_data: TextChannelUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Обновление текстового канала (право «Управлять каналами»)"""
    # Находим текстовый канал
    stmt = (
        select(TextChannel)
        .join(Channel, TextChannel.channel_id == Channel.id)
        .where(
            TextChannel.id == text_channel_id,
            TextChannel.is_hidden.is_(False),
        )
    )
    result = await db.execute(stmt)
    text_channel = result.scalar_one_or_none()

    if not text_channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Текстовый канал не найден"
        )

    await require_permission(
        db, text_channel.channel_id, current_user, Permission.MANAGE_CHANNELS
    )

    # Обновляем данные
    update_data = channel_data.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(text_channel, field, value)

    await db.commit()
    await db.refresh(text_channel)

    await log_audit(
        db,
        text_channel.channel_id,
        current_user,
        AuditAction.CHANNEL_UPDATE,
        target_type="channel",
        target_id=text_channel.id,
        target_name=text_channel.name,
        changes={**update_data, "kind": "text"},
    )

    # Отправляем WebSocket уведомление всем участникам сервера об обновлении канала
    members_stmt = select(ChannelMember.user_id).where(ChannelMember.channel_id == text_channel.channel_id)
    members_result = await db.execute(members_stmt)
    member_ids = [row[0] for row in members_result.fetchall()]

    for member_id in member_ids:
        await manager.send_to_user(member_id, {
            "type": "text_channel_updated",
            "data": {
                "text_channel_id": text_channel.id,
                "name": text_channel.name,
                "position": text_channel.position,
                "slow_mode_seconds": text_channel.slow_mode_seconds,
                "updated_by": {
                    "id": current_user.id,
                    "username": current_user.display_name or current_user.username
                }
            }
        })

    return text_channel

@router.put("/voice/{voice_channel_id}", response_model=VoiceChannelSchema)
async def update_voice_channel(
    voice_channel_id: int,
    channel_data: VoiceChannelUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Обновление голосового канала (право «Управлять каналами»)"""
    # Находим голосовой канал
    stmt = (
        select(VoiceChannel)
        .join(Channel, VoiceChannel.channel_id == Channel.id)
        .where(VoiceChannel.id == voice_channel_id)
    )
    result = await db.execute(stmt)
    voice_channel = result.scalar_one_or_none()

    if not voice_channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Голосовой канал не найден"
        )

    await require_permission(
        db, voice_channel.channel_id, current_user, Permission.MANAGE_CHANNELS
    )

    # Обновляем данные
    update_data = channel_data.dict(exclude_unset=True)
    for field, value in update_data.items():
        setattr(voice_channel, field, value)

    await db.commit()
    await db.refresh(voice_channel)

    await log_audit(
        db,
        voice_channel.channel_id,
        current_user,
        AuditAction.CHANNEL_UPDATE,
        target_type="channel",
        target_id=voice_channel.id,
        target_name=voice_channel.name,
        changes={**update_data, "kind": "voice"},
    )

    # Отправляем WebSocket уведомление всем участникам сервера об обновлении канала
    members_stmt = select(ChannelMember.user_id).where(ChannelMember.channel_id == voice_channel.channel_id)
    members_result = await db.execute(members_stmt)
    member_ids = [row[0] for row in members_result.fetchall()]

    for member_id in member_ids:
        await manager.send_to_user(member_id, {
            "type": "voice_channel_updated",
            "data": {
                "voice_channel_id": voice_channel.id,
                "name": voice_channel.name,
                "position": voice_channel.position,
                "max_users": voice_channel.max_users,
                "bitrate": voice_channel.bitrate,
                "video_quality": voice_channel.video_quality,
                "updated_by": {
                    "id": current_user.id,
                    "username": current_user.display_name or current_user.username
                }
            }
        })

    return voice_channel

@router.delete("/text/{text_channel_id}")
async def delete_text_channel(
    text_channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Скрывает текстовый канал. Сообщения и вложения остаются в базе для аудита."""
    text_channel = await get_visible_text_channel(db, text_channel_id)

    if not text_channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Текстовый канал не найден"
        )

    await require_permission(
        db, text_channel.channel_id, current_user, Permission.MANAGE_CHANNELS
    )

    server_id = text_channel.channel_id
    deleted_channel_name = text_channel.name

    members_stmt = select(ChannelMember.user_id).where(ChannelMember.channel_id == server_id)
    members_result = await db.execute(members_stmt)
    member_ids = [row[0] for row in members_result.fetchall()]

    text_channel.is_hidden = True
    text_channel.hidden_at = datetime.now(timezone.utc)
    text_channel.hidden_by_id = current_user.id

    await db.commit()

    for member_id in member_ids:
        await manager.send_to_user(member_id, {
            "type": "text_channel_deleted",
            "data": {
                "text_channel_id": text_channel_id,
                "server_id": server_id,
                "deleted_by": {
                    "id": current_user.id,
                    "username": current_user.display_name or current_user.username
                }
            }
        })

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.CHANNEL_DELETE,
        target_type="channel",
        target_id=text_channel_id,
        target_name=deleted_channel_name,
        changes={"kind": "text", "soft_hide": True},
    )

    return {"detail": "Текстовый канал скрыт"}


@router.post("/text/{text_channel_id}/restore", response_model=TextChannelSchema)
async def restore_text_channel(
    text_channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Восстанавливает ранее скрытый текстовый канал."""
    text_channel = await get_text_channel_any(db, text_channel_id)

    if not text_channel or not text_channel.is_hidden:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Скрытый текстовый канал не найден"
        )

    await require_permission(
        db, text_channel.channel_id, current_user, Permission.MANAGE_CHANNELS
    )

    server_id = text_channel.channel_id
    restored_name = text_channel.name

    text_channel.is_hidden = False
    text_channel.hidden_at = None
    text_channel.hidden_by_id = None

    await db.commit()
    await db.refresh(text_channel)

    members_stmt = select(ChannelMember.user_id).where(ChannelMember.channel_id == server_id)
    members_result = await db.execute(members_stmt)
    member_ids = [row[0] for row in members_result.fetchall()]

    for member_id in member_ids:
        await manager.send_to_user(member_id, {
            "type": "text_channel_created",
            "text_channel": {
                "id": text_channel.id,
                "name": text_channel.name,
                "channel_id": server_id,
                "position": text_channel.position,
            },
        })

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.CHANNEL_UPDATE,
        target_type="channel",
        target_id=text_channel.id,
        target_name=restored_name,
        changes={"kind": "text", "restored": True},
    )

    return text_channel

@router.delete("/voice/{voice_channel_id}")
async def delete_voice_channel(
    voice_channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Удаление голосового канала (право «Управлять каналами»)"""
    # Находим голосовой канал
    stmt = (
        select(VoiceChannel)
        .join(Channel, VoiceChannel.channel_id == Channel.id)
        .where(VoiceChannel.id == voice_channel_id)
    )
    result = await db.execute(stmt)
    voice_channel = result.scalar_one_or_none()

    if not voice_channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Голосовой канал не найден"
        )

    await require_permission(
        db, voice_channel.channel_id, current_user, Permission.MANAGE_CHANNELS
    )

    # Получаем сервер для уведомления
    server_id = voice_channel.channel_id
    deleted_channel_name = voice_channel.name

    # Получаем всех участников сервера для уведомления
    members_stmt = select(ChannelMember.user_id).where(ChannelMember.channel_id == server_id)
    members_result = await db.execute(members_stmt)
    member_ids = [row[0] for row in members_result.fetchall()]

    # Удаляем канал и все связанные данные
    # 1. Пользователи в голосовом канале
    await db.execute(delete(VoiceChannelUser).where(VoiceChannelUser.voice_channel_id == voice_channel_id))

    # 2. Переопределения прав канала
    await db.execute(
        delete(ChannelPermissionOverwrite).where(
            ChannelPermissionOverwrite.channel_kind == ChannelKind.VOICE,
            ChannelPermissionOverwrite.channel_id == voice_channel_id,
        )
    )

    # 3. Сам канал
    await db.execute(delete(VoiceChannel).where(VoiceChannel.id == voice_channel_id))

    await db.commit()

    # Отправляем WebSocket уведомление всем участникам сервера об удалении канала
    for member_id in member_ids:
        await manager.send_to_user(member_id, {
            "type": "voice_channel_deleted",
            "data": {
                "voice_channel_id": voice_channel_id,
                "server_id": server_id,
                "deleted_by": {
                    "id": current_user.id,
                    "username": current_user.display_name or current_user.username
                }
            }
        })

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.CHANNEL_DELETE,
        target_type="channel",
        target_id=voice_channel_id,
        target_name=deleted_channel_name,
        changes={"kind": "voice"},
    )

    return {"detail": "Голосовой канал успешно удален"}

# Новые эндпоинты для приглашений
@router.post("/{channel_id}/invite")
async def invite_user_to_channel(
    channel_id: int,
    username: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Приглашение по username: создаёт одноразовый инвайт и уведомляет человека.
    Не добавляет на сервер без согласия (в отличие от старого поведения).
    """
    await require_permission(db, channel_id, current_user, Permission.CREATE_INVITE)

    user_result = await db.execute(
        select(User).where(User.username == username)
    )
    target_user = user_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден"
        )

    ban_result = await db.execute(
        select(ServerBan.id).where(
            and_(ServerBan.server_id == channel_id, ServerBan.user_id == target_user.id)
        )
    )
    if ban_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пользователь заблокирован на этом сервере. Сначала снимите блокировку."
        )

    if await is_server_member(db, channel_id, target_user.id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пользователь уже в этом канале"
        )

    code = secrets_mod.token_urlsafe(8)
    invite = Invite(
        code=code,
        server_id=channel_id,
        inviter_id=current_user.id,
        max_uses=1,
        uses=0,
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)

    await manager.send_personal_message(
        {
            "type": "server_invite",
            "data": {
                "code": invite.code,
                "server_id": channel_id,
                "inviter_id": current_user.id,
                "inviter_name": current_user.display_name or current_user.username,
                "invite_url": f"/invite/{invite.code}",
            },
        },
        target_user.id,
    )

    await log_audit(
        db,
        channel_id,
        current_user,
        AuditAction.INVITE_CREATE,
        target_type="invite",
        target_id=invite.id,
        target_name=invite.code,
        changes={"method": "username_invite", "target_user_id": target_user.id},
    )

    return {
        "message": f"Приглашение отправлено пользователю {username}",
        "channel_id": channel_id,
        "user_id": target_user.id,
        "invite_code": invite.code,
        "pending_accept": True,
    }

@router.get("/{channel_id}/members")
async def get_channel_members(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение списка участников сервера"""
    channel = await require_membership(db, channel_id, current_user)

    result = await db.execute(
        select(ChannelMember, User)
        .join(User, ChannelMember.user_id == User.id)
        .where(ChannelMember.channel_id == channel_id)
    )
    rows = result.all()

    roles_result = await db.execute(
        select(MemberRole.user_id, Role)
        .join(Role, MemberRole.role_id == Role.id)
        .where(MemberRole.server_id == channel_id)
        .order_by(Role.position.desc())
    )
    roles_by_user: dict[int, list[Role]] = {}
    for user_id, role in roles_result.all():
        roles_by_user.setdefault(user_id, []).append(role)

    return [
        {
            "id": member.id,
            "username": member.display_name or member.username,
            "display_name": member.display_name,
            "nickname": membership.nickname,
            "is_active": member.is_active,
            "is_online": member.is_online,
            "avatar_url": member.avatar_url,
            "is_owner": member.id == channel.owner_id,
            "role_ids": [role.id for role in roles_by_user.get(member.id, [])],
            "color": next(
                (role.color for role in roles_by_user.get(member.id, []) if role.color),
                None,
            ),
        }
        for membership, member in rows
    ]

@router.get("/voice/{voice_channel_id}/members")
async def get_voice_channel_members(
    voice_channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Получение списка участников голосового канала"""
    await require_voice_channel_access(db, current_user, voice_channel_id)
    result = await db.execute(
        select(VoiceChannelUser, User).join(User, VoiceChannelUser.user_id == User.id).where(
            VoiceChannelUser.voice_channel_id == voice_channel_id
        )
    )
    voice_members = result.all()
    
    return [
        {
            "id": user.id,
            "user_id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "is_active": user.is_active,
            "is_online": user.is_online,
            "avatar_url": user.avatar_url,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
            "is_muted": voice_user.is_muted,
            "is_deafened": voice_user.is_deafened,
        }
        for voice_user, user in voice_members
    ]

@router.get("/text/{channel_id}/messages")
async def get_channel_messages(
    channel_id: int,
    limit: int = 50,
    before: Optional[int] = None,  # ID сообщения, до которого загружать
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Сообщения пачками (как Discord):
    - без before → последние `limit` сообщений;
    - with before → ещё `limit` сообщений старше этого id.
    """
    await require_text_channel_access(db, current_user, channel_id)

    # Защита сервера: не даём вытянуть весь чат одним запросом
    limit = max(1, min(int(limit or 50), 100))

    query = select(Message).where(
        Message.text_channel_id == channel_id,
        Message.is_deleted == False
    )
    
    if before:
        query = query.where(Message.id < before)
    
    query = query.order_by(Message.timestamp.desc()).limit(limit)
    
    # Загружаем связанные данные
    query = query.options(
        selectinload(Message.author),
        selectinload(Message.attachments),
        selectinload(Message.reactions).selectinload(Reaction.user),
        selectinload(Message.reply_to).selectinload(Message.author)
    )
    
    result = await db.execute(query)
    messages = result.scalars().all()
    
    # Разворачиваем порядок (старые сообщения сначала)
    messages = list(reversed(messages))
    
    # Преобразуем в формат для фронтенда
    message_list = []
    for msg in messages:
        # Обрабатываем случай удаленного пользователя
        if msg.webhook_id is not None:
            author_data = {
                "id": msg.webhook_id,
                "username": msg.webhook_name or "Webhook",
                "email": "",
                "display_name": None,
                "avatar_url": msg.webhook_avatar_url,
                "is_webhook": True,
            }
        elif msg.author is None:
            author_data = {
                "id": -1,  # Специальный ID для удаленных пользователей
                "username": "УДАЛЕННЫЙ АККАУНТ",
                "email": "",
                "display_name": "УДАЛЕННЫЙ АККАУНТ",
                "avatar_url": None
            }
        else:
            author_data = {
                "id": msg.author.id,
                "username": msg.author.display_name or msg.author.username,
                "email": "",
                "display_name": msg.author.display_name,
                "avatar_url": getattr(msg.author, 'avatar_url', None)
                ,"is_webhook": False
            }
        
        # Формируем реакции
        reactions_dict = {}
        for reaction in msg.reactions:
            emoji = reaction.emoji
            if emoji not in reactions_dict:
                reactions_dict[emoji] = {
                    "id": reaction.id,
                    "emoji": emoji,
                    "count": 0,
                    "users": [],
                    "current_user_reacted": False
                }
            reactions_dict[emoji]["count"] += 1
            reactions_dict[emoji]["users"].append({
                "id": reaction.user.id,
                "username": reaction.user.display_name or reaction.user.username,
                "email": "",
                "display_name": reaction.user.display_name,
                "avatar_url": getattr(reaction.user, 'avatar_url', None)
            })
            if reaction.user_id == current_user.id:
                reactions_dict[emoji]["current_user_reacted"] = True
        
        message_dict = {
            "id": msg.id,
            "content": msg.content,
            "channelId": msg.text_channel_id,
            "timestamp": msg.timestamp.replace(tzinfo=timezone.utc).isoformat(),
            "is_edited": msg.is_edited,
            "webhook_id": msg.webhook_id,
            "embeds": msg.embeds or [],
            "flags": msg.flags or 0,
            "author": author_data,
            "attachments": [
                {
                    "id": att.id,
                    "file_url": serialize_attachment(att)["file_url"],
                    "filename": att.original_filename,
                    "content_type": att.content_type,
                    "size_bytes": att.size_bytes or 0,
                    "description": att.description,
                } for att in msg.attachments
            ],
            "reactions": list(reactions_dict.values()),
            "reply_to": None if not msg.reply_to else {
                "id": msg.reply_to.id,
                "content": "Сообщение удалено" if msg.reply_to.is_deleted else msg.reply_to.content,
                "channelId": msg.reply_to.text_channel_id,
                "timestamp": msg.reply_to.timestamp.replace(tzinfo=timezone.utc).isoformat(),
                "is_deleted": msg.reply_to.is_deleted,
                "author": {
                    "id": msg.reply_to.webhook_id,
                    "username": msg.reply_to.webhook_name or "Webhook",
                    "email": "",
                    "display_name": None,
                    "avatar_url": msg.reply_to.webhook_avatar_url,
                    "is_webhook": True,
                } if msg.reply_to.webhook_id is not None else {
                    "id": msg.reply_to.author.id,
                    "username": msg.reply_to.author.display_name or msg.reply_to.author.username,
                    "email": "",
                    "display_name": msg.reply_to.author.display_name,
                    "avatar_url": getattr(msg.reply_to.author, 'avatar_url', None)
                } if msg.reply_to.author else {
                    "id": -1,
                    "username": "УДАЛЕННЫЙ АККАУНТ",
                    "email": "",
                    "display_name": "УДАЛЕННЫЙ АККАУНТ",
                    "avatar_url": None
                },
                "attachments": [],
                "reactions": []
            }
        }
        message_list.append(message_dict)
    
    return {
        "messages": message_list,
        "has_more": len(messages) == limit  # Есть ли еще сообщения
    }

@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Удаление сообщения (только автор, в течение 2 часов)"""
    # Получаем сообщение
    message_result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    message = message_result.scalar_one_or_none()
    
    if not message:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    
    text_channel = await require_text_channel_access(
        db, current_user, message.text_channel_id
    )
    is_author = message.author_id == current_user.id
    can_manage = await user_can_manage_messages(db, current_user, text_channel)

    if not is_author and not can_manage:
        raise HTTPException(status_code=403, detail="Недостаточно прав для удаления")

    if is_author and not can_manage:
        time_limit = timedelta(hours=2)
        msg_ts = message.timestamp.replace(tzinfo=None) if message.timestamp.tzinfo else message.timestamp
        if datetime.utcnow() - msg_ts > time_limit:
            raise HTTPException(
                status_code=403,
                detail="Сообщение можно удалить только в течение 2 часов после отправки",
            )

    message.is_deleted = True
    message.content = None
    await db.execute(delete(Reaction).where(Reaction.message_id == message_id))
    await db.commit()
    
    await manager.send_to_channel(message.text_channel_id, {
        "type": "message_deleted",
        "data": {
            "message_id": message_id,
            "text_channel_id": message.text_channel_id
        }
    })
    
    return {"message": "Сообщение удалено"}

@router.put("/messages/{message_id}")
async def edit_message(
    message_id: int,
    message_data: MessageUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Редактирование сообщения (только автор, в течение 2 часов)"""
    message_result = await db.execute(
        select(Message)
        .where(Message.id == message_id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions).selectinload(Reaction.user),
            selectinload(Message.reply_to).selectinload(Message.author)
        )
    )
    message = message_result.scalar_one_or_none()
    
    if not message:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")

    await require_text_channel_access(db, current_user, message.text_channel_id)

    if message.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Вы можете редактировать только свои сообщения")
    
    time_limit = timedelta(hours=2)
    msg_ts = message.timestamp.replace(tzinfo=None) if message.timestamp.tzinfo else message.timestamp
    if datetime.utcnow() - msg_ts > time_limit:
        raise HTTPException(status_code=403, detail="Сообщение можно редактировать только в течение 2 часов после отправки")
    
    message.content = message_data.content.strip()
    message.is_edited = True
    
    await db.commit()
    await db.refresh(message)
    
    # Формируем реакции
    reactions_dict = {}
    for reaction in message.reactions:
        emoji = reaction.emoji
        if emoji not in reactions_dict:
            reactions_dict[emoji] = {
                "id": reaction.id,
                "emoji": emoji,
                "count": 0,
                "users": [],
                "current_user_reacted": False
            }
        reactions_dict[emoji]["count"] += 1
        reactions_dict[emoji]["users"].append({
            "id": reaction.user.id,
            "username": reaction.user.display_name or reaction.user.username,
            "email": "",
            "display_name": reaction.user.display_name,
            "avatar_url": getattr(reaction.user, 'avatar_url', None)
        })
        if reaction.user_id == current_user.id:
            reactions_dict[emoji]["current_user_reacted"] = True
    
    # Формируем обновленное сообщение
    updated_message = {
        "id": message.id,
        "content": message.content,
        "channelId": message.text_channel_id,
        "timestamp": message.timestamp.replace(tzinfo=timezone.utc).isoformat(),
        "is_edited": message.is_edited,
        "is_deleted": message.is_deleted,
        "author": {
            "id": message.author.id,
            "username": message.author.display_name or message.author.username,
            "email": "",
            "display_name": message.author.display_name,
            "avatar_url": getattr(message.author, 'avatar_url', None)
        },
        "attachments": [
            {
                "id": att.id,
                "file_url": att.file_url,
                "filename": getattr(att, 'filename', None)
            } for att in message.attachments
        ],
        "reactions": list(reactions_dict.values()),
        "reply_to": None if not message.reply_to else {
            "id": message.reply_to.id,
            "content": "Сообщение удалено" if message.reply_to.is_deleted else message.reply_to.content,
            "channelId": message.reply_to.text_channel_id,
            "timestamp": message.reply_to.timestamp.replace(tzinfo=timezone.utc).isoformat(),
            "is_deleted": message.reply_to.is_deleted,
            "author": {
                "id": message.reply_to.author.id,
                "username": message.reply_to.author.display_name or message.reply_to.author.username,
                "email": "",
                "display_name": message.reply_to.author.display_name,
                "avatar_url": getattr(message.reply_to.author, 'avatar_url', None)
            } if message.reply_to.author else {
                "id": -1,
                "username": "УДАЛЕННЫЙ АККАУНТ",
                "email": "",
                "display_name": "УДАЛЕННЫЙ АККАУНТ",
                "avatar_url": None
            },
            "attachments": [],
            "reactions": []
        }
    }
    
    # Отправляем WebSocket уведомление об изменении
    await manager.send_to_channel(message.text_channel_id, {
        "type": "message_edited", 
        "data": updated_message
    })
    
    return updated_message

@router.delete("/{channel_id}")
async def delete_channel(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    """Удаление сервера (только для владельца)"""
    # Находим сервер
    stmt = select(Channel).options(selectinload(Channel.owner)).where(Channel.id == channel_id)
    result = await db.execute(stmt)
    channel = result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сервер не найден"
        )
    
    # Проверяем права (только владелец может удалить сервер)
    if channel.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только владелец сервера может его удалить"
        )
    
    # Получаем всех участников сервера для уведомления
    members_stmt = select(ChannelMember.user_id).where(ChannelMember.channel_id == channel_id)
    members_result = await db.execute(members_stmt)
    member_ids = [row[0] for row in members_result.fetchall()]
    
    # Удаляем все связанные данные
    await _delete_server_text_messages(db, channel_id)
    
    # Пользователи в голосовых каналах
    await db.execute(delete(VoiceChannelUser).where(VoiceChannelUser.voice_channel_id.in_(
        select(VoiceChannel.id).where(VoiceChannel.channel_id == channel_id)
    )))
    
    # 4. Приглашения — до текстовых каналов, на которые они ссылаются
    await db.execute(delete(Invite).where(Invite.server_id == channel_id))

    # 5. Текстовые каналы
    await db.execute(delete(TextChannel).where(TextChannel.channel_id == channel_id))
    
    # 6. Голосовые каналы
    await db.execute(delete(VoiceChannel).where(VoiceChannel.channel_id == channel_id))
    
    # 7. Участники сервера
    await db.execute(delete(ChannelMember).where(ChannelMember.channel_id == channel_id))

    # 8. Роли, баны и журнал аудита сервера
    await db.execute(delete(MemberRole).where(MemberRole.server_id == channel_id))
    await db.execute(delete(Role).where(Role.server_id == channel_id))
    await db.execute(delete(ServerBan).where(ServerBan.server_id == channel_id))
    await db.execute(delete(AuditLog).where(AuditLog.server_id == channel_id))
    
    # 9. Сам сервер
    await db.execute(delete(Channel).where(Channel.id == channel_id))
    
    await db.commit()
    
    # Отправляем WebSocket уведомление всем участникам о удалении сервера
    for member_id in member_ids:
        await manager.send_to_user(member_id, {
            "type": "server_deleted",
            "data": {
                "server_id": channel_id,
                "server_name": channel.name,
                "deleted_by": {
                    "id": current_user.id,
                    "username": current_user.display_name or current_user.username
                }
            }
        })
    
    return {"detail": "Сервер успешно удален"}
