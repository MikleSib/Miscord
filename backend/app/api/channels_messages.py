"""Routes extracted mechanically from channels.py; keep below 600 lines."""

from .channels_shared import *  # noqa: F401,F403

router = APIRouter()

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

    # Демонстрация экрана живёт только в Redis-presence, в БД её нет.
    # Без неё клиент, открывший страницу после начала стрима, не покажет «В эфире».
    sharing_user_ids: set[int] = set()
    try:
        for presence in await voice_presence.participants(voice_channel_id):
            if presence.get("is_sharing_screen"):
                sharing_user_ids.add(int(presence["user_id"]))
    except Exception:
        logger.warning("Не удалось получить presence голосового канала %s", voice_channel_id)

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
            "is_sharing_screen": user.id in sharing_user_ids,
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
    Сообщения возвращаются пачками:
    - без before → последние `limit` сообщений;
    - with before → ещё `limit` сообщений старше этого id.
    """
    await require_text_channel_access(db, current_user, channel_id)

    # Защита сервера: не даём вытянуть весь чат одним запросом
    limit = max(1, min(int(limit or 50), 100))

    query = select(Message).where(
        Message.text_channel_id == channel_id,
        Message.is_deleted == False,
        or_(Message.ephemeral_user_id.is_(None), Message.ephemeral_user_id == current_user.id),
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
    normalized_polls = {}
    if messages:
        poll_rows = (await db.execute(select(Poll).where(Poll.message_id.in_([message.id for message in messages])))).scalars().all()
        normalized_polls = {poll.message_id: poll for poll in poll_rows}

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
            },
            "poll": await serialize_poll(db, normalized_polls[msg.id], current_user.id)
            if msg.id in normalized_polls else msg.poll,
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
    await bot_event_dispatcher.dispatch_message_delete(db, message_id, message.text_channel_id)

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
    await bot_event_dispatcher.dispatch_message_update(db, message)

    return updated_message

@router.delete("/{channel_id}")
async def delete_channel(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db)
):
    from app.api.community_threads import delete_thread_resource

    if await delete_thread_resource(db, current_user, channel_id):
        return {"detail": "Обсуждение удалено"}
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
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        channel_id,
        "GUILD_DELETE",
        {"id": str(channel_id), "unavailable": False},
    )

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
