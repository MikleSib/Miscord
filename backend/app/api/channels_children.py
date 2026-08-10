"""Routes extracted mechanically from channels.py; keep below 600 lines."""

from .channels_shared import *  # noqa: F401,F403

router = APIRouter()

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
        position=channel_data.position,
        category_id=await _validated_category_id(db, channel_id, channel_data.category_id),
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
    await bot_event_dispatcher.dispatch_guild_event(
        db, channel_id, "CHANNEL_CREATE", miscord_channel(new_text_channel, guild_id=channel_id, overwrites=[])
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
        category_id=await _validated_category_id(db, channel_id, channel_data.category_id),
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
    await bot_event_dispatcher.dispatch_guild_event(
        db, channel_id, "CHANNEL_CREATE", miscord_channel(new_voice_channel, guild_id=channel_id, overwrites=[])
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

    await bot_event_dispatcher.dispatch_guild_event(
        db,
        text_channel.channel_id,
        "CHANNEL_UPDATE",
        miscord_channel(text_channel, guild_id=text_channel.channel_id, overwrites=[]),
    )

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

    await bot_event_dispatcher.dispatch_guild_event(
        db,
        voice_channel.channel_id,
        "CHANNEL_UPDATE",
        miscord_channel(voice_channel, guild_id=voice_channel.channel_id, overwrites=[]),
    )

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

    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server_id,
        "CHANNEL_DELETE",
        miscord_channel(text_channel, guild_id=server_id, overwrites=[]),
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

    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server_id,
        "CHANNEL_CREATE",
        miscord_channel(text_channel, guild_id=server_id, overwrites=[]),
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
    deleted_channel_payload = miscord_channel(voice_channel, guild_id=server_id, overwrites=[])

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

    await bot_event_dispatcher.dispatch_guild_event(
        db, server_id, "CHANNEL_DELETE", deleted_channel_payload
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
    await db.flush()
    await create_notification(
        db,
        user_id=target_user.id,
        type="server_invite",
        actor_user_id=current_user.id,
        server_id=channel_id,
        dedupe_key=f"server-invite:{invite.id}:{target_user.id}",
        payload={"code": invite.code, "invite_url": f"/invite/{invite.code}"},
    )
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
