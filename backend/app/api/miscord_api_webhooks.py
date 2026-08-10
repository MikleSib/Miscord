"""Routes extracted mechanically from miscord_api.py; keep below 600 lines."""

from .miscord_api_shared import *  # noqa: F401,F403

router = APIRouter()

def _miscord_webhook(webhook: Webhook, token: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": str(webhook.id),
        "type": 1,
        "guild_id": str(webhook.server_id),
        "channel_id": str(webhook.text_channel_id),
        "user": None,
        "name": webhook.name,
        "avatar": webhook.avatar_url,
        "application_id": None,
        "source_guild": None,
        "source_channel": None,
        "url": None,
    }
    if token is not None:
        payload["token"] = token
        payload["url"] = f"{settings.SERVER_HOST.rstrip('/')}/api/v1/webhooks/{webhook.id}/{token}"
    return payload


async def _managed_bot_webhook(db: AsyncSession, principal: BotPrincipal, webhook_id: int) -> Webhook:
    webhook = await db.get(Webhook, webhook_id)
    if webhook is None:
        raise MiscordAPIError(404, 10015, "Unknown Webhook")
    await _require_bot_text_channel(db, principal, webhook.text_channel_id, permission=Permission.MANAGE_WEBHOOKS)
    return webhook


@router.post("/channels/{channel_id}/webhooks", status_code=200)
async def create_channel_webhook(
    channel_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_WEBHOOKS)
    name = str(payload.get("name") or "").strip()
    if not 1 <= len(name) <= 80 or any(value in name.casefold() for value in ("miscord", "miscord", "system", "official")):
        raise MiscordAPIError(400, 50035, "Invalid webhook name")
    channel_count = await db.scalar(select(func.count(Webhook.id)).where(Webhook.text_channel_id == channel_id))
    if int(channel_count or 0) >= 15:
        raise MiscordAPIError(400, 30007, "Maximum number of webhooks reached")
    token = generate_webhook_token()
    webhook = Webhook(
        server_id=channel.channel_id,
        text_channel_id=channel.id,
        name=name,
        avatar_url=str(payload.get("avatar") or "")[:2048] or None,
        token_hash=hash_webhook_token(token),
        token_ciphertext="",
        created_by_id=principal.bot_user.id,
    )
    db.add(webhook)
    await db.commit()
    await db.refresh(webhook)
    await bot_event_dispatcher.dispatch_guild_event(db, channel.channel_id, "WEBHOOKS_UPDATE", {
        "guild_id": str(channel.channel_id),
        "channel_id": str(channel.id),
    })
    return _miscord_webhook(webhook, token)


@router.get("/channels/{channel_id}/webhooks")
async def get_channel_webhooks(
    channel_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_WEBHOOKS)
    result = await db.execute(select(Webhook).where(Webhook.text_channel_id == channel_id).order_by(Webhook.id))
    return [_miscord_webhook(webhook) for webhook in result.scalars().all()]


@router.get("/guilds/{guild_id}/webhooks")
async def get_guild_webhooks(
    guild_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_WEBHOOKS)
    result = await db.execute(select(Webhook).where(Webhook.server_id == guild_id).order_by(Webhook.id))
    return [_miscord_webhook(webhook) for webhook in result.scalars().all()]


@router.get("/webhooks/{webhook_id}")
async def get_webhook(
    webhook_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    return _miscord_webhook(await _managed_bot_webhook(db, principal, webhook_id))


@router.patch("/webhooks/{webhook_id}")
async def modify_webhook(
    webhook_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    webhook = await _managed_bot_webhook(db, principal, webhook_id)
    previous_channel_id = webhook.text_channel_id
    if "name" in payload:
        name = str(payload["name"] or "").strip()
        if not 1 <= len(name) <= 80:
            raise MiscordAPIError(400, 50035, "Invalid webhook name")
        webhook.name = name
    if "avatar" in payload:
        webhook.avatar_url = str(payload["avatar"] or "")[:2048] or None
    if "channel_id" in payload:
        try:
            target_id = int(payload["channel_id"])
        except (TypeError, ValueError) as exc:
            raise MiscordAPIError(400, 50035, "Invalid channel_id") from exc
        target, _, _ = await _require_bot_text_channel(db, principal, target_id, permission=Permission.MANAGE_WEBHOOKS)
        if target.channel_id != webhook.server_id:
            raise MiscordAPIError(400, 50035, "A webhook cannot be moved to another guild")
        webhook.text_channel_id = target.id
    await db.commit()
    for changed_channel_id in {previous_channel_id, webhook.text_channel_id}:
        await bot_event_dispatcher.dispatch_guild_event(db, webhook.server_id, "WEBHOOKS_UPDATE", {
            "guild_id": str(webhook.server_id),
            "channel_id": str(changed_channel_id),
        })
    return _miscord_webhook(webhook)


@router.delete("/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    webhook = await _managed_bot_webhook(db, principal, webhook_id)
    guild_id = webhook.server_id
    channel_id = webhook.text_channel_id
    await db.delete(webhook)
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "WEBHOOKS_UPDATE", {
        "guild_id": str(guild_id),
        "channel_id": str(channel_id),
    })
    return Response(status_code=204)


@router.get("/webhooks/{webhook_id}/{token}")
async def get_webhook_with_token(webhook_id: int, token: str, db: AsyncSession = Depends(get_db)):
    from app.api.webhooks import get_webhook_with_token as implementation
    return await implementation(webhook_id=webhook_id, token=token, db=db)


@router.patch("/webhooks/{webhook_id}/{token}")
async def modify_webhook_with_token(
    webhook_id: int,
    token: str,
    payload: WebhookTokenUpdate,
    db: AsyncSession = Depends(get_db),
):
    from app.api.webhooks import update_webhook_with_token as implementation
    return await implementation(payload=payload, webhook_id=webhook_id, token=token, db=db)


@router.delete("/webhooks/{webhook_id}/{token}", status_code=204)
async def delete_webhook_with_token(webhook_id: int, token: str, db: AsyncSession = Depends(get_db)):
    from app.api.webhooks import delete_webhook_with_token as implementation
    return await implementation(webhook_id=webhook_id, token=token, db=db)


async def _interaction_webhook(db: AsyncSession, application_id: int, token: str):
    try:
        return await load_interaction_by_token(db, str(application_id), token)
    except MiscordAPIError as exc:
        if exc.code == 10062:
            return None
        raise


@router.post("/webhooks/{webhook_id}/{token}")
async def execute_webhook(
    request: Request,
    webhook_id: int,
    token: str,
    wait: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    interaction_pair = await _interaction_webhook(db, webhook_id, token)
    if interaction_pair is not None:
        interaction, application = interaction_pair
        try:
            payload = MiscordMessageCreate.model_validate(await request.json())
        except (ValidationError, ValueError) as exc:
            if isinstance(exc, ValidationError):
                raise _validation_error(exc) from exc
            raise MiscordAPIError(400, 50035, "Invalid JSON body") from exc
        message = await create_followup(db, interaction, application, payload.model_dump(exclude_unset=True))
        return miscord_message(message, guild_id=interaction.guild_id)
    from app.api.webhooks import execute_webhook as implementation
    return await implementation(request=request, webhook_id=webhook_id, token=token, wait=wait, db=db)


@router.get("/webhooks/{webhook_id}/{token}/messages/{message_id}")
async def get_webhook_message(webhook_id: int, token: str, message_id: str, db: AsyncSession = Depends(get_db)):
    interaction_pair = await _interaction_webhook(db, webhook_id, token)
    if interaction_pair is not None:
        interaction, _ = interaction_pair
        if message_id == "@original":
            return miscord_message(await get_original_response(db, interaction), guild_id=interaction.guild_id)
        try:
            numeric_id = int(message_id)
        except ValueError as exc:
            raise UNKNOWN_MESSAGE() from exc
        link = await db.scalar(select(BotInteractionMessage.id).where(
            BotInteractionMessage.interaction_id == interaction.id,
            BotInteractionMessage.message_id == numeric_id,
            BotInteractionMessage.is_original.is_(False),
        ))
        if link is None:
            raise UNKNOWN_MESSAGE()
        return miscord_message(await load_response_message(db, numeric_id), guild_id=interaction.guild_id)
    try:
        numeric_id = int(message_id)
    except ValueError as exc:
        raise UNKNOWN_MESSAGE() from exc
    from app.api.webhooks import get_webhook_message as implementation
    return await implementation(webhook_id=webhook_id, token=token, message_id=numeric_id, db=db)


@router.patch("/webhooks/{webhook_id}/{token}/messages/{message_id}")
async def edit_webhook_message(
    request: Request,
    webhook_id: int,
    token: str,
    message_id: str,
    db: AsyncSession = Depends(get_db),
):
    interaction_pair = await _interaction_webhook(db, webhook_id, token)
    if interaction_pair is not None:
        interaction, _ = interaction_pair
        try:
            payload = MiscordMessageUpdate.model_validate(await request.json())
        except (ValidationError, ValueError) as exc:
            if isinstance(exc, ValidationError):
                raise _validation_error(exc) from exc
            raise MiscordAPIError(400, 50035, "Invalid JSON body") from exc
        changes = payload.model_dump(exclude_unset=True)
        if message_id == "@original":
            message = await edit_original_response(db, interaction, changes)
        else:
            try:
                numeric_id = int(message_id)
            except ValueError as exc:
                raise UNKNOWN_MESSAGE() from exc
            link = await db.scalar(select(BotInteractionMessage.id).where(
                BotInteractionMessage.interaction_id == interaction.id,
                BotInteractionMessage.message_id == numeric_id,
                BotInteractionMessage.is_original.is_(False),
            ))
            if link is None:
                raise UNKNOWN_MESSAGE()
            message = await update_response_message(db, interaction, await load_response_message(db, numeric_id), changes)
        return miscord_message(message, guild_id=interaction.guild_id)
    try:
        numeric_id = int(message_id)
    except ValueError as exc:
        raise UNKNOWN_MESSAGE() from exc
    from app.api.webhooks import edit_webhook_message as implementation
    return await implementation(request=request, webhook_id=webhook_id, token=token, message_id=numeric_id, db=db)


@router.delete("/webhooks/{webhook_id}/{token}/messages/{message_id}", status_code=204)
async def delete_webhook_message(webhook_id: int, token: str, message_id: str, db: AsyncSession = Depends(get_db)):
    interaction_pair = await _interaction_webhook(db, webhook_id, token)
    if interaction_pair is not None:
        interaction, _ = interaction_pair
        if message_id == "@original":
            message = await get_original_response(db, interaction)
        else:
            try:
                numeric_id = int(message_id)
            except ValueError as exc:
                raise UNKNOWN_MESSAGE() from exc
            link = await db.scalar(select(BotInteractionMessage.id).where(
                BotInteractionMessage.interaction_id == interaction.id,
                BotInteractionMessage.message_id == numeric_id,
                BotInteractionMessage.is_original.is_(False),
            ))
            if link is None:
                raise UNKNOWN_MESSAGE()
            message = await load_response_message(db, numeric_id)
        await delete_response_message(db, interaction, message)
        return Response(status_code=204)
    try:
        numeric_id = int(message_id)
    except ValueError as exc:
        raise UNKNOWN_MESSAGE() from exc
    from app.api.webhooks import delete_webhook_message as implementation
    return await implementation(webhook_id=webhook_id, token=token, message_id=numeric_id, db=db)


async def _miscord_invite_payload(db: AsyncSession, invite: Invite) -> dict[str, Any]:
    guild = await _guild(db, invite.server_id)
    channel = await db.get(TextChannel, invite.target_text_channel_id) if invite.target_text_channel_id else None
    inviter = await db.get(User, invite.inviter_id) if invite.inviter_id else None
    created_at = invite.created_at
    max_age = 0
    if invite.expires_at and created_at:
        expires = invite.expires_at if invite.expires_at.tzinfo else invite.expires_at.replace(tzinfo=timezone.utc)
        created = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        max_age = max(0, int((expires - created).total_seconds()))
    return {
        "type": 0,
        "code": invite.code,
        "guild": {"id": str(guild.id), "name": guild.name, "icon": guild.icon, "features": []},
        "channel": ({"id": str(channel.id), "name": channel.name, "type": 0} if channel else None),
        "inviter": miscord_user(inviter) if inviter else None,
        "target_type": None,
        "approximate_presence_count": None,
        "approximate_member_count": None,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        "uses": int(invite.uses or 0),
        "max_uses": int(invite.max_uses or 0),
        "max_age": max_age,
        "temporary": False,
        "created_at": invite.created_at.isoformat() if invite.created_at else None,
    }


async def _new_invite_code(db: AsyncSession) -> str:
    for _ in range(10):
        code = secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:10]
        if not await db.scalar(select(Invite.id).where(Invite.code == code)):
            return code
    raise MiscordAPIError(500, 0, "Could not create invite")


@router.get("/invites/{code}")
async def get_invite(code: str, db: AsyncSession = Depends(get_db)):
    invite = await db.scalar(select(Invite).where(Invite.code == code))
    now = datetime.now(timezone.utc)
    if invite is None or (invite.expires_at and (invite.expires_at if invite.expires_at.tzinfo else invite.expires_at.replace(tzinfo=timezone.utc)) <= now):
        raise MiscordAPIError(404, 10006, "Unknown Invite")
    return await _miscord_invite_payload(db, invite)


@router.post("/channels/{channel_id}/invites", status_code=200)
async def create_channel_invite(
    channel_id: int,
    payload: dict[str, Any] = Body(default={}),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.CREATE_INSTANT_INVITE)
    max_age = max(0, min(604800, int(payload.get("max_age") or 86400)))
    max_uses = max(0, min(100, int(payload.get("max_uses") or 0)))
    unique = bool(payload.get("unique"))
    if not unique:
        now = datetime.now(timezone.utc)
        result = await db.execute(select(Invite).where(
            Invite.server_id == channel.channel_id,
            Invite.target_text_channel_id == channel_id,
            or_(Invite.expires_at.is_(None), Invite.expires_at > now),
        ).order_by(Invite.id.desc()).limit(1))
        existing = result.scalar_one_or_none()
        if existing is not None and (not existing.max_uses or existing.uses < existing.max_uses):
            return await _miscord_invite_payload(db, existing)
    invite = Invite(
        code=await _new_invite_code(db),
        server_id=channel.channel_id,
        inviter_id=principal.bot_user.id,
        target_text_channel_id=channel_id,
        max_uses=max_uses or None,
        uses=0,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=max_age) if max_age else None,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    response = await _miscord_invite_payload(db, invite)
    await bot_event_dispatcher.dispatch_guild_event(db, channel.channel_id, "INVITE_CREATE", response)
    return response


@router.get("/channels/{channel_id}/invites")
async def get_channel_invites(
    channel_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_CHANNELS)
    result = await db.execute(select(Invite).where(Invite.target_text_channel_id == channel_id).order_by(Invite.id))
    return [await _miscord_invite_payload(db, invite) for invite in result.scalars().all()]


@router.get("/guilds/{guild_id}/invites")
async def get_guild_invites(
    guild_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_GUILD)
    result = await db.execute(select(Invite).where(Invite.server_id == guild_id).order_by(Invite.id))
    return [await _miscord_invite_payload(db, invite) for invite in result.scalars().all()]


@router.delete("/invites/{code}")
async def delete_invite(
    code: str,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    invite = await db.scalar(select(Invite).where(Invite.code == code))
    if invite is None:
        raise MiscordAPIError(404, 10006, "Unknown Invite")
    await _require_guild_permission(db, principal, invite.server_id, Permission.MANAGE_GUILD)
    response = await _miscord_invite_payload(db, invite)
    guild_id = invite.server_id
    await db.delete(invite)
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "INVITE_DELETE", {"channel_id": response["channel"]["id"] if response["channel"] else None, "guild_id": str(guild_id), "code": code})
    return response
