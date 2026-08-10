"""Routes extracted mechanically from webhooks.py; keep below 600 lines."""

from .webhooks_shared import *  # noqa: F401,F403

router = APIRouter()

@router.post("/channels/text/{channel_id}/webhooks", status_code=201)
async def create_webhook(
    payload: WebhookCreate,
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    audit_reason: str | None = Header(default=None, alias="X-Audit-Log-Reason"),
):
    _ensure_enabled()
    channel = await _require_manage(db, current_user.id, channel_id)
    channel_count = await db.scalar(select(func.count(Webhook.id)).where(Webhook.text_channel_id == channel_id))
    server_count = await db.scalar(select(func.count(Webhook.id)).where(Webhook.server_id == channel.channel_id))
    if (channel_count or 0) >= 15 or (server_count or 0) >= 1000:
        raise HTTPException(status_code=400, detail="Maximum number of webhooks reached")
    token = generate_webhook_token()
    webhook = Webhook(
        server_id=channel.channel_id,
        text_channel_id=channel.id,
        name=_validate_name(payload.name),
        avatar_url=payload.avatar_url,
        token_hash=hash_webhook_token(token),
        token_ciphertext="",
        created_by_id=current_user.id,
    )
    db.add(webhook)
    await db.flush()
    await log_audit(
        db,
        server_id=channel.channel_id,
        actor=current_user,
        action=AuditAction.WEBHOOK_CREATE,
        target_type="webhook",
        target_id=webhook.id,
        changes={"name": webhook.name, "channel_id": webhook.text_channel_id},
        reason=_audit_reason(audit_reason),
    )
    await db.commit()
    await db.refresh(webhook)
    webhook.creator = current_user
    await _broadcast_webhooks_updated(webhook.text_channel_id)
    response = _management_payload(webhook)
    response["execution_url"] = webhook_execution_url(webhook.id, token)
    return _one_time_secret_response(response)


@router.get("/channels/text/{channel_id}/webhooks")
async def list_channel_webhooks(channel_id: int, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    _ensure_enabled()
    await _require_manage(db, current_user.id, channel_id)
    rows = await db.execute(select(Webhook).options(selectinload(Webhook.creator)).where(Webhook.text_channel_id == channel_id).order_by(Webhook.created_at))
    return [_management_payload(item) for item in rows.scalars().all()]


@router.get("/webhooks/{webhook_id}")
async def get_managed_webhook(webhook_id: int, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    webhook = await _managed_webhook(db, webhook_id, current_user.id)
    return _management_payload(webhook)


@router.patch("/webhooks/{webhook_id}")
async def update_managed_webhook(
    payload: WebhookUpdate,
    webhook_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    audit_reason: str | None = Header(default=None, alias="X-Audit-Log-Reason"),
):
    webhook = await _managed_webhook(db, webhook_id, current_user.id)
    source_channel_id = webhook.text_channel_id
    if payload.channel_id is not None and payload.channel_id != webhook.text_channel_id:
        target = await _require_manage(db, current_user.id, payload.channel_id)
        if target.channel_id != webhook.server_id:
            raise HTTPException(status_code=400, detail="A webhook cannot be moved to another server")
        webhook.text_channel_id = target.id
    if payload.name is not None:
        webhook.name = _validate_name(payload.name)
    if "avatar_url" in payload.model_fields_set:
        webhook.avatar_url = payload.avatar_url
    await log_audit(
        db,
        server_id=webhook.server_id,
        actor=current_user,
        action=AuditAction.WEBHOOK_UPDATE,
        target_type="webhook",
        target_id=webhook.id,
        changes={"name": webhook.name, "channel_id": webhook.text_channel_id, "avatar_changed": "avatar_url" in payload.model_fields_set},
        reason=_audit_reason(audit_reason),
    )
    await db.commit()
    await db.refresh(webhook)
    await _broadcast_webhooks_updated(source_channel_id, webhook.text_channel_id)
    return _management_payload(webhook)


@router.delete("/webhooks/{webhook_id}", status_code=204)
async def delete_managed_webhook(
    webhook_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    audit_reason: str | None = Header(default=None, alias="X-Audit-Log-Reason"),
):
    webhook = await _managed_webhook(db, webhook_id, current_user.id)
    channel_id = webhook.text_channel_id
    avatar_url = webhook.avatar_url
    await log_audit(
        db,
        server_id=webhook.server_id,
        actor=current_user,
        action=AuditAction.WEBHOOK_DELETE,
        target_type="webhook",
        target_id=webhook.id,
        changes={"name": webhook.name, "channel_id": webhook.text_channel_id},
        reason=_audit_reason(audit_reason),
    )
    await db.delete(webhook)
    await db.commit()
    await delete_public_media(avatar_url)
    await _broadcast_webhooks_updated(channel_id)
    return Response(status_code=204)


@router.post("/webhooks/{webhook_id}/avatar")
async def upload_webhook_avatar(
    request: Request,
    webhook_id: int,
    avatar: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    webhook = await _managed_webhook(db, webhook_id, current_user.id)
    rate_limit_user(current_user.id, "webhook-avatar", limit=10, window=60, request=request)
    old_avatar_url = webhook.avatar_url
    new_key = None
    try:
        data, extension, content_type = await read_and_validate_image(avatar)
        avatar_url, new_key = await store_public_image("webhook-avatars", data, extension, content_type)
    except ObjectStorageError as exc:
        raise HTTPException(status_code=503, detail="Media storage is unavailable") from exc
    finally:
        await avatar.close()
    webhook.avatar_url = avatar_url
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        if new_key and not new_key.startswith("/"):
            await delete_object(new_key)
        raise
    await db.refresh(webhook)
    if old_avatar_url != avatar_url:
        await delete_public_media(old_avatar_url)
    await _broadcast_webhooks_updated(webhook.text_channel_id)
    return _management_payload(webhook)


@router.post("/webhooks/{webhook_id}/reset-token")
async def reset_webhook_token(
    webhook_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
    audit_reason: str | None = Header(default=None, alias="X-Audit-Log-Reason"),
):
    webhook = await _managed_webhook(db, webhook_id, current_user.id)
    token = generate_webhook_token()
    webhook.token_hash = hash_webhook_token(token)
    webhook.token_ciphertext = ""
    await log_audit(
        db,
        server_id=webhook.server_id,
        actor=current_user,
        action=AuditAction.WEBHOOK_TOKEN_RESET,
        target_type="webhook",
        target_id=webhook.id,
        changes={"token_reset": True},
        reason=_audit_reason(audit_reason),
    )
    await db.commit()
    await _broadcast_webhooks_updated(webhook.text_channel_id)
    return _one_time_secret_response({"execution_url": webhook_execution_url(webhook.id, token)})


@router.post("/webhooks/{webhook_id}/test")
async def test_webhook(webhook_id: int, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    webhook = await _managed_webhook(db, webhook_id, current_user.id)
    message = await _persist_message(db, webhook, WebhookExecute(content="Miscord webhook test", flags=4096), [])
    payload = await _broadcast(message)
    await bot_event_dispatcher.dispatch_message_create(db, message)
    return payload


@router.get("/webhooks/{webhook_id}/{token}")
async def get_webhook_with_token(webhook_id: int, token: str, db: AsyncSession = Depends(get_db)):
    webhook = await _token_webhook(db, webhook_id, token)
    return JSONResponse(content=_public_webhook_payload(webhook), headers=_NO_STORE_HEADERS)


@router.patch("/webhooks/{webhook_id}/{token}")
async def update_webhook_with_token(payload: WebhookTokenUpdate, webhook_id: int, token: str, db: AsyncSession = Depends(get_db)):
    webhook = await _token_webhook(db, webhook_id, token)
    if payload.name is not None:
        webhook.name = _validate_name(payload.name)
    if "avatar_url" in payload.model_fields_set:
        webhook.avatar_url = payload.avatar_url
    await db.commit()
    await db.refresh(webhook)
    await _broadcast_webhooks_updated(webhook.text_channel_id)
    return JSONResponse(content=_public_webhook_payload(webhook), headers=_NO_STORE_HEADERS)


@router.delete("/webhooks/{webhook_id}/{token}", status_code=204)
async def delete_webhook_with_token(webhook_id: int, token: str, db: AsyncSession = Depends(get_db)):
    webhook = await _token_webhook(db, webhook_id, token)
    channel_id = webhook.text_channel_id
    avatar_url = webhook.avatar_url
    await db.delete(webhook)
    await db.commit()
    await delete_public_media(avatar_url)
    await _broadcast_webhooks_updated(channel_id)
    return Response(status_code=204)
