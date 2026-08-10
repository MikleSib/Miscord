"""Routes extracted mechanically from webhooks.py; keep below 600 lines."""

from .webhooks_shared import *  # noqa: F401,F403

router = APIRouter()

@router.post("/webhooks/{webhook_id}/{token}")
async def execute_webhook(request: Request, webhook_id: int, token: str, wait: bool = Query(False), db: AsyncSession = Depends(get_db)):
    _ensure_enabled()
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > 105 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Request body exceeds 105 MiB")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid Content-Length header") from exc
    ip_result = await consume([Bucket(f"webhook-ip:{_client_ip(request)}", 300, 60, "shared")])
    if not ip_result.allowed:
        return _limited(ip_result)
    webhook = await _token_webhook(db, webhook_id, token)
    is_multipart = request.headers.get("content-type", "").lower().startswith("multipart/form-data")
    buckets = [Bucket(f"webhook:{webhook.id}", 5, 2, "user"), Bucket(f"channel:{webhook.text_channel_id}", 30, 1, "shared")]
    if is_multipart:
        buckets.extend((Bucket(f"webhook-files:{webhook.id}", 2, 60, "user"), Bucket(f"server-files:{webhook.server_id}", 10, 60, "shared")))
    result = await consume(buckets)
    if not result.allowed:
        return _limited(result)
    payload, files = await _parse_execute_request(request, require_message=False)
    message = await _persist_message(db, webhook, payload, files)
    await _broadcast(message)
    await bot_event_dispatcher.dispatch_message_create(db, message)
    if not payload.flags & 4096:
        channel = await _text_channel(db, webhook.text_channel_id)
        await enqueue_webhook_mentions(db, channel, message, payload.allowed_mentions)
    headers = rate_headers(result)
    logger.info("webhook_execute webhook_id=%s channel_id=%s files=%s", webhook.id, webhook.text_channel_id, len(files))
    return JSONResponse(_external_message_payload(message), headers=headers) if wait else Response(status_code=204, headers=headers)


async def _owned_message(db: AsyncSession, webhook: Webhook, message_id: int) -> Message:
    result = await db.execute(
        select(Message).options(selectinload(Message.author), selectinload(Message.attachments), selectinload(Message.reply_to)).where(
            Message.id == message_id, Message.webhook_id == webhook.id, Message.is_deleted.is_(False)
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Unknown Message")
    return message


@router.get("/webhooks/{webhook_id}/{token}/messages/{message_id}")
async def get_webhook_message(webhook_id: int, token: str, message_id: int, db: AsyncSession = Depends(get_db)):
    webhook = await _token_webhook(db, webhook_id, token)
    return _external_message_payload(await _owned_message(db, webhook, message_id))


@router.patch("/webhooks/{webhook_id}/{token}/messages/{message_id}")
async def edit_webhook_message(request: Request, webhook_id: int, token: str, message_id: int, db: AsyncSession = Depends(get_db)):
    webhook = await _token_webhook(db, webhook_id, token)
    message = await _owned_message(db, webhook, message_id)
    payload, files = await _parse_execute_request(request)
    if "content" in payload.model_fields_set:
        message.content = payload.content
    if "embeds" in payload.model_fields_set:
        message.embeds = [item.model_dump(mode="json", exclude_none=True) for item in payload.embeds]
    if "flags" in payload.model_fields_set:
        message.flags = payload.flags
    attachments_supplied = "attachments" in payload.model_fields_set
    retained_ids = {item.id for item in payload.attachments}
    removed_keys = (
        [item.storage_key for item in message.attachments if item.id not in retained_ids]
        if attachments_supplied
        else []
    )
    if attachments_supplied:
        message.attachments[:] = [item for item in message.attachments if item.id in retained_ids]
    new_storage_keys: list[str] = []
    if files:
        consumed = 0
        metadata = {item.id: item for item in payload.attachments}
        try:
            for index, upload in enumerate(files):
                staged = await stage_upload(upload, consumed)
                consumed += staged.size_bytes
                try:
                    await scan_file(staged.path)
                except MalwareDetected as exc:
                    staged.path.unlink(missing_ok=True)
                    raise HTTPException(status_code=422, detail="An attachment was rejected by malware scanning") from exc
                except ClamAVUnavailable as exc:
                    staged.path.unlink(missing_ok=True)
                    raise HTTPException(status_code=503, detail="Malware scanner is unavailable") from exc
                storage_key, _destination = await finalize_staged_file(staged)
                new_storage_keys.append(storage_key)
                request_meta = metadata.get(index)
                message.attachments.append(
                    Attachment(
                        file_url=None,
                        original_filename=(request_meta.filename if request_meta and request_meta.filename else staged.filename),
                        content_type=staged.content_type,
                        size_bytes=staged.size_bytes,
                        storage_key=storage_key,
                        sha256=staged.sha256,
                        description=request_meta.description if request_meta else None,
                    )
                )
        except Exception:
            for storage_key in new_storage_keys:
                await remove_storage_key(storage_key)
            raise
    message.is_edited = True
    if not message.content and not message.embeds and not message.attachments:
        raise HTTPException(status_code=400, detail="A message cannot be empty")
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        for storage_key in new_storage_keys:
            await remove_storage_key(storage_key)
        raise
    for storage_key in removed_keys:
        await remove_storage_key(storage_key)
    payload_out = serialize_channel_message(message)
    await manager.send_to_channel(message.text_channel_id, {"type": "message_updated", "data": payload_out})
    await bot_event_dispatcher.dispatch_message_update(db, message)
    return _external_message_payload(message)


@router.delete("/webhooks/{webhook_id}/{token}/messages/{message_id}", status_code=204)
async def delete_webhook_message(webhook_id: int, token: str, message_id: int, db: AsyncSession = Depends(get_db)):
    webhook = await _token_webhook(db, webhook_id, token)
    message = await _owned_message(db, webhook, message_id)
    storage_keys = [item.storage_key for item in message.attachments]
    message.attachments.clear()
    message.content = None
    message.embeds = []
    message.is_deleted = True
    await db.commit()
    for storage_key in storage_keys:
        await remove_storage_key(storage_key)
    await manager.send_to_channel(message.text_channel_id, {"type": "message_deleted", "data": {"id": message.id, "text_channel_id": message.text_channel_id}})
    await bot_event_dispatcher.dispatch_message_delete(db, message.id, message.text_channel_id)
    return Response(status_code=204)
