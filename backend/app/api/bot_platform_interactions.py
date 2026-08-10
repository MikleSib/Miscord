"""Routes extracted mechanically from bot_platform.py; keep below 600 lines."""

from .bot_platform_shared import *  # noqa: F401,F403

router = APIRouter()

@router.post("/v1/channels/{text_channel_id}/messages")
async def create_bot_message(
    text_channel_id: int,
    payload: BotMessageCreate,
    principal: BotPrincipal = Depends(get_current_bot),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await _require_bot_channel(db, principal, text_channel_id, need_send=True)
    _validate_message_data(payload.content, payload.embeds, payload.flags)
    if payload.client_nonce:
        existing_result = await db.execute(
            select(Message).where(Message.author_id == principal.bot_user.id, Message.client_nonce == payload.client_nonce)
        )
        existing = existing_result.scalar_one_or_none()
        if existing:
            if (existing.text_channel_id != text_channel_id or existing.content != payload.content or (existing.embeds or []) != payload.embeds or int(existing.flags or 0) != payload.flags):
                raise HTTPException(status_code=409, detail="client_nonce conflict")
            loaded = await _load_message(db, existing.id)
            return _external_message(serialize_channel_message(loaded))
    message = Message(
        author_id=principal.bot_user.id,
        text_channel_id=text_channel_id,
        content=payload.content.strip() if payload.content else None,
        embeds=payload.embeds,
        flags=payload.flags,
        client_nonce=payload.client_nonce,
    )
    db.add(message)
    await db.commit()
    loaded = await _load_message(db, message.id)
    serialized = serialize_channel_message(loaded)
    await manager.send_to_channel(text_channel_id, {"type": "new_message", "data": serialized})
    await bot_event_dispatcher.dispatch_message_create(db, loaded)
    return _external_message(serialized)


@router.get("/v1/channels/{text_channel_id}/messages/{message_id}")
async def get_bot_message(
    text_channel_id: int,
    message_id: int,
    principal: BotPrincipal = Depends(get_current_bot),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await _require_bot_channel(db, principal, text_channel_id, need_send=False)
    message = await _load_message(db, message_id)
    if not message or message.text_channel_id != text_channel_id or message.author_id != principal.bot_user.id:
        raise HTTPException(status_code=404, detail="Message not found")
    return _external_message(serialize_channel_message(message))


@router.patch("/v1/channels/{text_channel_id}/messages/{message_id}")
async def update_bot_message(
    text_channel_id: int,
    message_id: int,
    payload: BotMessageUpdate,
    principal: BotPrincipal = Depends(get_current_bot),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await _require_bot_channel(db, principal, text_channel_id, need_send=True)
    message = await _load_message(db, message_id)
    if not message or message.text_channel_id != text_channel_id or message.author_id != principal.bot_user.id:
        raise HTTPException(status_code=404, detail="Message not found")
    content = payload.content if "content" in payload.model_fields_set else message.content
    embeds = payload.embeds if "embeds" in payload.model_fields_set else list(message.embeds or [])
    flags = payload.flags if "flags" in payload.model_fields_set else int(message.flags or 0)
    _validate_message_data(content, embeds or [], flags or 0)
    message.content = content.strip() if content else None
    message.embeds = embeds or []
    message.flags = flags or 0
    message.is_edited = True
    await db.commit()
    loaded = await _load_message(db, message.id)
    serialized = serialize_channel_message(loaded)
    await manager.send_to_channel(text_channel_id, {"type": "message_edited", "data": serialized})
    await bot_event_dispatcher.dispatch_message_update(db, loaded)
    return _external_message(serialized)


@router.delete("/v1/channels/{text_channel_id}/messages/{message_id}", status_code=204)
async def delete_bot_message(
    text_channel_id: int,
    message_id: int,
    principal: BotPrincipal = Depends(get_current_bot),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await _require_bot_channel(db, principal, text_channel_id, need_send=False)
    result = await db.execute(select(Message).where(
        Message.id == message_id,
        Message.text_channel_id == text_channel_id,
        Message.author_id == principal.bot_user.id,
    ))
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Message not found")
    await db.delete(message)
    await db.commit()
    await manager.send_to_channel(text_channel_id, {
        "type": "message_deleted",
        "data": {"message_id": message_id, "text_channel_id": text_channel_id},
    })
    await bot_event_dispatcher.dispatch_message_delete(db, message_id, text_channel_id)


@router.post("/v1/interactions/{interaction_id}/{interaction_token}/callback")
async def create_interaction_callback(
    interaction_id: str,
    interaction_token: str,
    payload: BotInteractionCallbackRequest,
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    result = await db.execute(
        select(BotInteraction).where(
            BotInteraction.interaction_id == interaction_id,
            BotInteraction.interaction_token == interaction_token,
        )
    )
    interaction = result.scalar_one_or_none()
    if interaction is None:
        raise HTTPException(status_code=404, detail="Interaction not found")
    if interaction.responded:
        return {"interaction_id": interaction_id, "status": "already_responded"}
    interaction.response_type = int(payload.type)
    interaction.response_payload = {"type": int(payload.type), "data": payload.data}
    interaction.responded = True
    interaction.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return {"interaction_id": interaction_id, "status": "ok"}


@router.post("/bot/apps/{application_id}/commands/dispatch", response_model=BotCommandDispatchResponse)
async def dispatch_bot_command(
    application_id: int,
    payload: BotCommandDispatchRequest,
    principal: BotPrincipal = Depends(get_current_bot),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    if principal.application.id != application_id:
        raise HTTPException(status_code=403, detail="Not allowed to dispatch for this application")
    if payload.type != 2:
        raise HTTPException(status_code=400, detail="Only application command dispatch is supported")

    interaction_name = _normalized_command_name(
        str(payload.data.get("name") if isinstance(payload.data, dict) else None or "").strip()
    )
    if not interaction_name:
        raise HTTPException(status_code=400, detail="command name is required")

    interaction_id = (payload.id or "").strip() or secrets.token_hex(8)
    interaction_token = (payload.token or "").strip() or secrets.token_urlsafe(18)

    interaction = await _load_or_create_interaction_record(
        db,
        principal.application,
        interaction_id,
        interaction_token,
    )
    interaction.guild_id = payload.guild_id
    interaction.channel_id = payload.channel_id

    actor_user_id = _coerce_interaction_number(
        payload.member.get("user", {}).get("id") if isinstance(payload.member, dict) and isinstance(payload.member.get("user"), dict) else None
    )
    if actor_user_id is None:
        actor_user_id = _coerce_interaction_number(
            payload.user.get("id") if isinstance(payload.user, dict) else None
        )
    interaction.author_user_id = actor_user_id

    command = await _resolve_command_for_interaction(db, principal.application, payload.guild_id, interaction_name)
    if not command:
        response = _interaction_error("Command not found.")
        interaction.response_type = int(response["type"])
        interaction.response_payload = response
        interaction.command_id = None
        interaction.responded = True
        interaction.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
        return BotCommandDispatchResponse(
            interaction_id=interaction.interaction_id,
            interaction_token=interaction.interaction_token,
            application_id=principal.application.id,
            command_id=None,
            guild_id=payload.guild_id,
            channel_id=payload.channel_id,
            type=response["type"],
            data=response.get("data"),
        )

    if command.server_id is not None and actor_user_id is None:
        response = _interaction_error("Permission denied.")
        interaction.response_type = int(response["type"])
        interaction.response_payload = response
        interaction.command_id = command.id
        interaction.responded = True
        interaction.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
        return BotCommandDispatchResponse(
            interaction_id=interaction.interaction_id,
            interaction_token=interaction.interaction_token,
            application_id=principal.application.id,
            command_id=command.id,
            guild_id=payload.guild_id,
            channel_id=payload.channel_id,
            type=response["type"],
            data=response.get("data"),
        )

    if command.server_id is not None and actor_user_id is not None:
        await _check_command_permissions(db, command, actor_user_id, payload.guild_id)

    command.definition = command.definition if isinstance(command.definition, dict) else {}
    response = _build_default_command_response(command)
    interaction.command_id = command.id
    interaction.responded = True
    interaction.response_type = int(response.get("type") or 4)
    interaction.response_payload = response
    interaction.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
    return BotCommandDispatchResponse(
        interaction_id=interaction.interaction_id,
        interaction_token=interaction.interaction_token,
        application_id=principal.application.id,
        command_id=command.id,
        guild_id=payload.guild_id,
        channel_id=payload.channel_id,
        type=response.get("type", 4),
        data=response.get("data"),
    )


@router.post("/v1/interactions")
async def create_interaction(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    raw_body = await request.body()
    signature = request.headers.get("X-Signature-Ed25519")
    timestamp = request.headers.get("X-Signature-Timestamp")
    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid interaction body") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid interaction payload")

    application_id = str(payload.get("application_id") or "").strip()
    if not application_id:
        raise HTTPException(status_code=400, detail="application_id is required")
    application = await _application_by_client_id(db, application_id)
    verify_interaction_signature(application, signature, timestamp, raw_body)

    interaction_id = str(payload.get("id") or "")
    interaction_token = str(payload.get("token") or "")
    if not interaction_id or not interaction_token:
        raise HTTPException(status_code=400, detail="interaction id and token are required")

    interaction = await _load_or_create_interaction_record(db, application, interaction_id, interaction_token)
    interaction.guild_id = _coerce_interaction_number(payload.get("guild_id"))
    interaction.channel_id = _coerce_interaction_number(payload.get("channel_id"))
    actor_user_id, _ = _interaction_actor_user(payload)
    interaction.author_user_id = actor_user_id
    await db.commit()
    if interaction.responded:
        cached = _serialize_interaction_response(interaction)
        if cached:
            return cached

    interaction_type = _coerce_interaction_number(payload.get("type"))
    if interaction_type == 1:
        interaction.responded = True
        interaction.response_type = 1
        interaction.response_payload = {"type": 1}
        interaction.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
        return {"type": 1}

    if interaction_type == 2:
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        name = str(data.get("name") or "").strip().lower()
        if not name:
            response = _interaction_error("Command name is required.")
            interaction.response_type = int(response["type"])
            interaction.response_payload = response
            interaction.responded = True
            interaction.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
            return response
        guild_id = _coerce_interaction_number(payload.get("guild_id"))
        command = await _resolve_command_for_interaction(db, application, guild_id, name)
        if not command:
            response = _interaction_error("Command not found.")
            interaction.response_type = int(response["type"])
            interaction.response_payload = response
            interaction.responded = True
            interaction.updated_at = datetime.now(timezone.utc)
            await db.commit()
            await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
            return response
        if command.server_id is not None and actor_user_id is not None:
            await _check_command_permissions(db, command, actor_user_id, guild_id)
        elif command.server_id is not None and not actor_user_id:
            response = _interaction_error("Permission denied.")
            interaction.response_type = int(response["type"])
            interaction.response_payload = response
            interaction.responded = True
            interaction.updated_at = datetime.now(timezone.utc)
            await db.commit()
            return response

        command.definition = command.definition if isinstance(command.definition, dict) else {}
        response = _build_default_command_response(command)
        interaction.command_id = command.id
        interaction.responded = True
        interaction.response_type = int(response.get("type") or 4)
        interaction.response_payload = response
        interaction.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
        return response

    if interaction_type in (3, 5):
        response = _interaction_error("This interaction type is currently unsupported.")
        interaction.response_type = int(response["type"])
        interaction.response_payload = response
        interaction.responded = True
        interaction.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
        return response

    raise HTTPException(status_code=400, detail="Unsupported interaction type")
