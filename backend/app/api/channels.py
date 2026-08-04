from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, delete
from sqlalchemy.orm import selectinload
from typing import List, Optional
from app.db.database import get_db
from app.models import (
    Channel, ChannelMember, TextChannel, VoiceChannel, User, ChannelType,
    VoiceChannelUser, Message, Reaction, Role, MemberRole, ServerBan, Invite, AuditLog
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
from app.services.server_membership import add_member_and_notify

router = APIRouter()


def _serialize_server_member(user: User) -> dict:
    """Формат участника сервера — совпадает с GET /channels/{id}."""
    return {
        "id": user.id,
        "username": user.display_name or user.username,
        "display_name": user.display_name,
        "email": user.email,
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
        for tc in channel.text_channels:
            text_channels.append({
                "id": tc.id,
                "name": tc.name,
                "position": tc.position,
                "created_at": tc.created_at
            })
        
        # Голосовые каналы без активных пользователей
        voice_channels = []
        for vc in channel.voice_channels:
            voice_channels.append({
                "id": vc.id,
                "name": vc.name,
                "position": vc.position,
                "max_users": vc.max_users,
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
        max_users=10
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
                "username": user.display_name or user.username,
                "email": user.email,
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
        text_channels_schema = [TextChannelSchema.from_orm(tc) for tc in channel.text_channels]
        voice_channels_schema = [VoiceChannelSchema.from_orm(vc) for vc in channel.voice_channels]

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
    for field, value in update_data.items():
        setattr(channel, field, value)
    
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
        select(TextChannel).where(TextChannel.channel_id == channel_id).order_by(TextChannel.position)
    )
    text_channels = text_result.scalars().all()
    
    # Получаем голосовые каналы
    voice_result = await db.execute(
        select(VoiceChannel).where(VoiceChannel.channel_id == channel_id).order_by(VoiceChannel.position)
    )
    voice_channels = voice_result.scalars().all()
    
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
            {"id": tc.id, "name": tc.name, "type": "text", "position": tc.position}
            for tc in text_channels
        ] + [
            {"id": vc.id, "name": vc.name, "type": "voice", "position": vc.position, "max_users": vc.max_users}
            for vc in voice_channels
        ],
        "members": [
            {
                "id": member.id,
                "username": member.display_name or member.username,
                "display_name": member.display_name,
                "nickname": membership.nickname,
                "email": member.email,
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
    """Присоединение к каналу"""
    # Проверка существования канала
    channel_result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    if not channel_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Channel not found"
        )

    # Заблокированный пользователь не может вернуться на сервер
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
    
    # Проверка, не является ли уже участником
    member_result = await db.execute(
        select(ChannelMember)
        .where(
            (ChannelMember.channel_id == channel_id) &
            (ChannelMember.user_id == current_user.id)
        )
    )
    if member_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Already a member of this channel"
        )
    
    # Добавление участника
    new_member = ChannelMember(
        channel_id=channel_id,
        user_id=current_user.id
    )
    db.add(new_member)
    await db.commit()

    await _notify_server_member_joined(
        db,
        channel_id,
        current_user,
        exclude_user_id=current_user.id,
    )
    
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
        max_users=channel_data.max_users
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
        .where(TextChannel.id == text_channel_id)
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
    """Удаление текстового канала (право «Управлять каналами»)"""
    # Находим текстовый канал
    stmt = (
        select(TextChannel)
        .join(Channel, TextChannel.channel_id == Channel.id)
        .where(TextChannel.id == text_channel_id)
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

    # Получаем сервер для уведомления
    server_id = text_channel.channel_id
    deleted_channel_name = text_channel.name

    # Получаем всех участников сервера для уведомления
    members_stmt = select(ChannelMember.user_id).where(ChannelMember.channel_id == server_id)
    members_result = await db.execute(members_stmt)
    member_ids = [row[0] for row in members_result.fetchall()]

    # Удаляем канал и все связанные данные
    # 1. Реакции на сообщения
    messages_stmt = select(Message.id).where(Message.text_channel_id == text_channel_id)
    messages_result = await db.execute(messages_stmt)
    message_ids = [row[0] for row in messages_result.fetchall()]

    if message_ids:
        await db.execute(delete(Reaction).where(Reaction.message_id.in_(message_ids)))

    # 2. Сообщения
    await db.execute(delete(Message).where(Message.text_channel_id == text_channel_id))

    # 3. Сам канал
    await db.execute(delete(TextChannel).where(TextChannel.id == text_channel_id))

    await db.commit()

    # Отправляем WebSocket уведомление всем участникам сервера об удалении канала
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
        changes={"kind": "text"},
    )

    return {"detail": "Текстовый канал успешно удален"}

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

    # 2. Сам канал
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
    """Приглашение пользователя в канал (сервер) по имени пользователя"""
    await require_permission(db, channel_id, current_user, Permission.CREATE_INVITE)

    # Находим пользователя по username
    user_result = await db.execute(
        select(User).where(User.username == username)
    )
    target_user = user_result.scalar_one_or_none()
    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден"
        )

    # Заблокированного пользователя нельзя пригласить обратно
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
    
    # Проверяем, не является ли пользователь уже участником
    existing_member = await db.execute(
        select(ChannelMember).where(
            and_(
                ChannelMember.channel_id == channel_id,
                ChannelMember.user_id == target_user.id
            )
        )
    )
    if existing_member.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пользователь уже в этом канале"
        )

    # Добавление участника и рассылка событий — общая логика для всех способов входа
    await add_member_and_notify(
        db,
        channel_id,
        target_user,
        invited_by=current_user.display_name or current_user.username,
    )

    await log_audit(
        db,
        channel_id,
        current_user,
        AuditAction.MEMBER_JOIN,
        target_type="member",
        target_id=target_user.id,
        target_name=target_user.display_name or target_user.username,
        changes={"method": "username_invite"},
    )
    
    member_payload = _serialize_server_member(target_user)
    return {
        "message": f"User {username} successfully invited to channel",
        "channel_id": channel_id,
        "user_id": target_user.id,
        "username": member_payload["username"],
        "display_name": target_user.display_name,
        "avatar_url": target_user.avatar_url,
        "user": member_payload,
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
            "email": member.email,
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
    # Проверяем существование голосового канала
    voice_channel_result = await db.execute(
        select(VoiceChannel).where(VoiceChannel.id == voice_channel_id)
    )
    voice_channel = voice_channel_result.scalar_one_or_none()
    if not voice_channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Voice channel not found"
        )
    
    # Получаем всех участников голосового канала с информацией о пользователях
    membership_result = await db.execute(
        select(ChannelMember).where(
            (ChannelMember.channel_id == voice_channel.channel_id) &
            (ChannelMember.user_id == current_user.id)
        )
    )
    if not membership_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Server membership required"
        )
    result = await db.execute(
        select(VoiceChannelUser, User).join(User, VoiceChannelUser.user_id == User.id).where(
            VoiceChannelUser.voice_channel_id == voice_channel_id
        )
    )
    voice_members = result.all()
    
    return [
        {
            "id": user.id,
            "username": user.display_name or user.username,
            "email": user.email,
            "is_active": user.is_active,
            "is_online": user.is_online,
            "avatar_url": user.avatar_url,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
            "is_muted": voice_user.is_muted,
            "is_deafened": voice_user.is_deafened
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
    """Получение сообщений текстового канала"""
    # Проверяем существование канала
    channel_result = await db.execute(
        select(TextChannel).where(TextChannel.id == channel_id)
    )
    channel = channel_result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(status_code=404, detail="Текстовый канал не найден")
    
    # Согласно памяти - все пользователи имеют доступ к любым каналам
    # Убираем проверку членства
    
    # Строим запрос для сообщений (показываем только не удаленные)
    query = select(Message).where(
        Message.text_channel_id == channel_id,
        Message.is_deleted == False
    )
    
    # Если указан before, загружаем сообщения до этого ID
    if before:
        query = query.where(Message.id < before)
    
    # Сортируем по времени (новые сначала для пагинации, потом развернем)
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
        if msg.author is None:
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
                "email": msg.author.email,
                "display_name": msg.author.display_name,
                "avatar_url": getattr(msg.author, 'avatar_url', None)
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
                "email": reaction.user.email,
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
            "author": author_data,
            "attachments": [
                {
                    "id": att.id,
                    "file_url": att.file_url,
                    "filename": getattr(att, 'filename', None)
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
                    "id": msg.reply_to.author.id,
                    "username": msg.reply_to.author.display_name or msg.reply_to.author.username,
                    "email": msg.reply_to.author.email,
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
    
    # Проверяем авторство
    if message.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Вы можете удалять только свои сообщения")
    
    # Проверяем временное ограничение (2 часа)
    time_limit = timedelta(hours=2)
    time_since_creation = datetime.utcnow() - message.timestamp
    
    if time_since_creation > time_limit:
        raise HTTPException(status_code=403, detail="Сообщение можно удалить только в течение 2 часов после отправки")
    
    # Помечаем сообщение как удаленное (не удаляем физически из-за ссылок)
    message.is_deleted = True
    message.content = None  # Очищаем контент
    
    # Удаляем реакции и вложения
    await db.execute(delete(Reaction).where(Reaction.message_id == message_id))
    
    await db.commit()
    
    # Отправляем WebSocket уведомление о удалении
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
    # Получаем сообщение с полными данными
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
    
    # Проверяем авторство
    if message.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Вы можете редактировать только свои сообщения")
    
    # Проверяем временное ограничение (2 часа)
    time_limit = timedelta(hours=2)
    time_since_creation = datetime.utcnow() - message.timestamp
    
    if time_since_creation > time_limit:
        raise HTTPException(status_code=403, detail="Сообщение можно редактировать только в течение 2 часов после отправки")
    
    # Обновляем контент и помечаем как отредактированное
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
            "email": reaction.user.email,
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
            "email": message.author.email,
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
                "email": message.reply_to.author.email,
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
    # 1. Реакции на сообщения
    messages_stmt = select(Message.id).join(TextChannel).where(TextChannel.channel_id == channel_id)
    messages_result = await db.execute(messages_stmt)
    message_ids = [row[0] for row in messages_result.fetchall()]
    
    if message_ids:
        await db.execute(delete(Reaction).where(Reaction.message_id.in_(message_ids)))
    
    # 2. Сообщения в текстовых каналах
    await db.execute(delete(Message).where(Message.text_channel_id.in_(
        select(TextChannel.id).where(TextChannel.channel_id == channel_id)
    )))
    
    # 3. Пользователи в голосовых каналах
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
