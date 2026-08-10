"""Routes extracted mechanically from miscord_api.py; keep below 600 lines."""

from .miscord_api_shared import *  # noqa: F401,F403

router = APIRouter()

@router.get("/channels/{channel_id}/messages")
async def get_channel_messages(
    channel_id: int,
    around: int | None = Query(default=None),
    before: int | None = Query(default=None),
    after: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.READ_MESSAGE_HISTORY)
    if sum(value is not None for value in (around, before, after)) > 1:
        raise MiscordAPIError(400, 50035, "Only one of around, before, or after may be provided")
    query = select(Message).options(
        selectinload(Message.author),
        selectinload(Message.attachments),
        selectinload(Message.reactions),
        selectinload(Message.reply_to).selectinload(Message.author),
        selectinload(Message.reply_to).selectinload(Message.attachments),
        selectinload(Message.reply_to).selectinload(Message.reactions),
    ).where(
        Message.text_channel_id == channel_id,
        Message.is_deleted.is_(False),
        or_(Message.ephemeral_user_id.is_(None), Message.ephemeral_user_id == principal.bot_user.id),
    )
    if around is not None:
        half = max(1, limit // 2)
        query = query.where(Message.id.between(max(0, around - half), around + half)).order_by(Message.id.desc())
    elif before is not None:
        query = query.where(Message.id < before).order_by(Message.id.desc())
    elif after is not None:
        query = query.where(Message.id > after).order_by(Message.id.asc())
    else:
        query = query.order_by(Message.id.desc())
    result = await db.execute(query.limit(limit))
    messages = list(result.scalars().unique().all())
    if after is not None:
        messages.reverse()
    return [miscord_message(item, guild_id=channel.channel_id) for item in messages]


@router.get("/channels/{channel_id}/messages/{message_id}")
async def get_channel_message(
    channel_id: int,
    message_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.READ_MESSAGE_HISTORY)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id or message.is_deleted:
        raise UNKNOWN_MESSAGE()
    return miscord_message(message, guild_id=channel.channel_id)


@router.post("/channels/{channel_id}/messages", status_code=200)
async def create_message(
    channel_id: int,
    request: Request,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    files: list[StarletteUploadFile] = []
    try:
        content_type = request.headers.get("content-type", "").lower()
        if content_type.startswith("multipart/form-data"):
            if not settings.WEBHOOK_FILES_ENABLED:
                raise MiscordAPIError(503, 0, "File uploads are disabled")
            form = await request.form()
            payload_json = form.get("payload_json")
            if not isinstance(payload_json, str):
                raise MiscordAPIError(400, 50035, "multipart requests require payload_json")
            raw_payload = json.loads(payload_json)
            for key, value in form.multi_items():
                if key == "payload_json":
                    continue
                if not key.startswith("files[") or not isinstance(value, StarletteUploadFile):
                    raise MiscordAPIError(400, 50035, f"Unsupported multipart field: {key}")
                files.append(value)
        elif content_type.startswith("application/json"):
            raw_payload = await request.json()
        else:
            raise MiscordAPIError(415, 50035, "Use application/json or multipart/form-data")
        payload = MiscordMessageCreate.model_validate(raw_payload)
    except (ValidationError, ValueError, json.JSONDecodeError) as exc:
        if not isinstance(exc, ValidationError):
            raise MiscordAPIError(400, 50035, "Invalid request body") from exc
        raise _validation_error(exc) from exc
    if len(files) > 10:
        raise MiscordAPIError(413, 30015, "A maximum of 10 files is allowed")
    if not payload.content and not payload.embeds and not payload.components and not payload.poll and not files:
        raise MiscordAPIError(400, 50006, "Cannot send an empty message")
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.SEND_MESSAGES)
    normalized_poll = None
    if payload.poll is not None:
        if not settings.POLLS_ENABLED:
            raise MiscordAPIError(404, 10003, "Polls are not enabled")
        try:
            normalized_poll = PollCreate.model_validate(payload.poll)
        except ValidationError as exc:
            raise _validation_error(exc) from exc
        await require_poll_permission(db, channel, principal.bot_user)
    nonce = str(payload.nonce)[:36] if payload.nonce is not None else None
    if nonce:
        existing_result = await db.execute(
            select(Message).where(Message.author_id == principal.bot_user.id, Message.client_nonce == nonce)
        )
        existing = existing_result.scalar_one_or_none()
        if existing is not None:
            if payload.enforce_nonce:
                return miscord_message(await _message(db, existing.id), guild_id=channel.channel_id)
            nonce = None
    reply_to_id = None
    if payload.message_reference and payload.message_reference.get("message_id"):
        try:
            reply_to_id = int(payload.message_reference["message_id"])
        except (TypeError, ValueError) as exc:
            raise MiscordAPIError(400, 50035, "Invalid message reference") from exc
        referenced = await _message(db, reply_to_id)
        if referenced.text_channel_id != channel_id:
            raise UNKNOWN_MESSAGE()
    staged = []
    finalized: list[str] = []
    try:
        consumed = 0
        for upload in files:
            item = await stage_upload(upload, consumed)
            consumed += item.size_bytes
            staged.append(item)
        for item in staged:
            try:
                await scan_file(item.path)
            except MalwareDetected as exc:
                raise MiscordAPIError(422, 50035, "An attachment was rejected by malware scanning") from exc
            except ClamAVUnavailable as exc:
                raise MiscordAPIError(503, 0, "Malware scanner is unavailable") from exc
        message = Message(
            author_id=principal.bot_user.id,
            text_channel_id=channel_id,
            content=payload.content.strip() if payload.content else None,
            embeds=payload.embeds,
            components=payload.components,
            poll=None,
            flags=payload.flags,
            tts=payload.tts,
            client_nonce=nonce,
            reply_to_id=reply_to_id,
            application_id=principal.application.client_id,
        )
        metadata = {
            int(item.get("id")): item
            for item in payload.attachments
            if isinstance(item, dict) and str(item.get("id", "")).isdigit()
        }
        for index, item in enumerate(staged):
            storage_key, _ = await finalize_staged_file(item)
            finalized.append(storage_key)
            request_meta = metadata.get(index, {})
            message.attachments.append(Attachment(
                file_url=None,
                original_filename=str(request_meta.get("filename") or item.filename)[:255],
                content_type=item.content_type,
                size_bytes=item.size_bytes,
                storage_key=storage_key,
                sha256=item.sha256,
                description=str(request_meta.get("description") or "")[:1024] or None,
            ))
        db.add(message)
        await db.flush()
        db_poll = None
        if normalized_poll is not None:
            db_poll = await create_poll_for_message(
                db,
                message=message,
                creator_id=principal.bot_user.id,
                payload=normalized_poll,
            )
        await db.commit()
    except Exception:
        await db.rollback()
        for item in staged:
            item.path.unlink(missing_ok=True)
        for storage_key in finalized:
            await remove_storage_key(storage_key)
        raise
    loaded = await _message(db, message.id)
    if db_poll is not None:
        loaded.poll = await serialize_poll(db, db_poll, principal.bot_user.id)
    internal = bot_event_dispatcher.internal_message_payload(loaded)
    await manager.send_to_channel(channel_id, {"type": "new_message", "data": internal})
    await bot_event_dispatcher.dispatch_message_create(db, loaded)
    return miscord_message(loaded, guild_id=channel.channel_id)


@router.patch("/channels/{channel_id}/messages/{message_id}")
async def edit_message(
    channel_id: int,
    message_id: int,
    raw_payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = MiscordMessageUpdate.model_validate(raw_payload)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.SEND_MESSAGES)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id or message.author_id != principal.bot_user.id:
        raise UNKNOWN_MESSAGE()
    changes = payload.model_dump(exclude_unset=True)
    for field in ("content", "embeds", "flags", "components"):
        if field in changes:
            setattr(message, field, changes[field])
    message.is_edited = True
    await db.commit()
    loaded = await _message(db, message.id)
    internal = bot_event_dispatcher.internal_message_payload(loaded)
    await manager.send_to_channel(channel_id, {"type": "message_edited", "data": internal})
    await bot_event_dispatcher.dispatch_message_update(db, loaded)
    return miscord_message(loaded, guild_id=channel.channel_id)


@router.delete("/channels/{channel_id}/messages/{message_id}", status_code=204)
async def delete_message(
    channel_id: int,
    message_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, permissions = await _require_bot_text_channel(db, principal, channel_id)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    if message.author_id != principal.bot_user.id and not has_permission(permissions, Permission.MANAGE_MESSAGES):
        raise MISSING_PERMISSIONS()
    await db.delete(message)
    await db.commit()
    await manager.send_to_channel(channel_id, {"type": "message_deleted", "data": {"message_id": message_id, "text_channel_id": channel_id}})
    await bot_event_dispatcher.dispatch_message_delete(db, message_id, channel_id)
    return Response(status_code=204)


@router.put("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me", status_code=204)
async def create_reaction(
    channel_id: int,
    message_id: int,
    emoji: str,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id, permission=Permission.ADD_REACTIONS)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    existing = await db.scalar(select(Reaction.id).where(
        Reaction.message_id == message_id,
        Reaction.user_id == principal.bot_user.id,
        Reaction.emoji == emoji,
    ))
    if existing is None:
        db.add(Reaction(message_id=message_id, user_id=principal.bot_user.id, emoji=emoji[:10]))
        await db.commit()
    await bot_event_dispatcher.dispatch_message_reaction_add(db, message, principal.bot_user, emoji)
    return Response(status_code=204)


@router.delete("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me", status_code=204)
async def delete_own_reaction(
    channel_id: int,
    message_id: int,
    emoji: str,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    await db.execute(delete(Reaction).where(
        Reaction.message_id == message_id,
        Reaction.user_id == principal.bot_user.id,
        Reaction.emoji == emoji,
    ))
    await db.commit()
    await bot_event_dispatcher.dispatch_message_reaction_remove(db, message, principal.bot_user, emoji)
    return Response(status_code=204)


@router.get("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}")
async def get_reactions(
    channel_id: int,
    message_id: int,
    emoji: str,
    limit: int = Query(default=25, ge=1, le=100),
    after: int = Query(default=0, ge=0),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id, permission=Permission.READ_MESSAGE_HISTORY)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    result = await db.execute(
        select(User)
        .join(Reaction, Reaction.user_id == User.id)
        .where(Reaction.message_id == message_id, Reaction.emoji == emoji, User.id > after)
        .order_by(User.id)
        .limit(limit)
    )
    return [miscord_user(user) for user in result.scalars().all()]


@router.delete("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}/{user_id}", status_code=204)
async def delete_user_reaction(
    channel_id: int,
    message_id: int,
    emoji: str,
    user_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_MESSAGES)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    user = await db.get(User, user_id)
    await db.execute(delete(Reaction).where(
        Reaction.message_id == message_id,
        Reaction.user_id == user_id,
        Reaction.emoji == emoji,
    ))
    await db.commit()
    if user is not None:
        await bot_event_dispatcher.dispatch_message_reaction_remove(db, message, user, emoji)
    return Response(status_code=204)


@router.delete("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}", status_code=204)
async def delete_all_reactions_for_emoji(
    channel_id: int,
    message_id: int,
    emoji: str,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_MESSAGES)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    await db.execute(delete(Reaction).where(Reaction.message_id == message_id, Reaction.emoji == emoji))
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(db, channel.channel_id, "MESSAGE_REACTION_REMOVE_EMOJI", {
        "channel_id": str(channel_id),
        "message_id": str(message_id),
        "guild_id": str(channel.channel_id),
        "emoji": {"id": None, "name": emoji},
    }, required_intent=1 << 10)
    return Response(status_code=204)


@router.delete("/channels/{channel_id}/messages/{message_id}/reactions", status_code=204)
async def delete_all_reactions(
    channel_id: int,
    message_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_MESSAGES)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    await db.execute(delete(Reaction).where(Reaction.message_id == message_id))
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(db, channel.channel_id, "MESSAGE_REACTION_REMOVE_ALL", {
        "channel_id": str(channel_id),
        "message_id": str(message_id),
        "guild_id": str(channel.channel_id),
    }, required_intent=1 << 10)
    return Response(status_code=204)
