"""Bounded route group extracted from channels_servers.py."""

from .channels_shared import *  # noqa: F401,F403
from app.services.channel_serialization import voice_channel_payload

router = APIRouter()

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
                "category_id": tc.category_id,
                "slow_mode_seconds": tc.slow_mode_seconds,
                "kind": tc.kind,
                "parent_id": tc.parent_id,
                "created_at": tc.created_at
            })

        # Голосовые каналы без активных пользователей
        voice_channels = []
        visible_voice = await filter_viewable_voice_channels(
            db, channel.id, current_user.id, channel.voice_channels, owner_id=channel.owner_id
        )
        for vc in visible_voice:
            voice_channels.append(voice_channel_payload(vc))

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
        legacy_permissions=miscord_permissions_to_legacy(DEFAULT_PERMISSIONS),
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
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        channel_id,
        "GUILD_UPDATE",
        {
            "id": str(channel.id),
            "name": channel.name,
            "description": channel.description,
            "icon": channel.icon,
            "banner": channel.banner,
            "owner_id": str(channel.owner_id),
            "preferred_locale": "ru",
            "features": [],
        },
    )

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
            "is_active": channel.owner.is_active,
            "is_online": channel.owner.is_online,
            "created_at": channel.owner.created_at,
            "updated_at": channel.owner.updated_at
        },
        "text_channels": [],
        "voice_channels": [],
        "members_count": 0
    }
