from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import JSONResponse, Response
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.core.media import to_public_media_path
from app.core.permissions import Permission, get_member_permissions, has_permission
from app.db.database import get_db
from app.models import Attachment, Message, TextChannel, User, Webhook
from app.schemas.webhook import WebhookCreate, WebhookExecute, WebhookTokenUpdate, WebhookUpdate
from app.services.attachment_storage import finalize_staged_file, remove_storage_key, stage_upload
from app.services.audit_service import AuditAction, log_audit
from app.services.clamav import ClamAVUnavailable, MalwareDetected, scan_file
from app.services.channel_permissions import get_effective_channel_permissions
from app.services.image_upload import read_and_validate_image, save_image_bytes
from app.services.message_serializer import serialize_channel_message
from app.services.rate_limit import rate_limit_user
from app.services.webhook_rate_limit import Bucket, consume, rate_headers
from app.services.webhook_security import (
    decrypt_webhook_token,
    encrypt_webhook_token,
    generate_webhook_token,
    hash_webhook_token,
    verify_webhook_token,
    webhook_execution_url,
)
from app.services.webhook_notifications import enqueue_webhook_mentions
from app.websocket.connection_manager import manager


logger = logging.getLogger(__name__)
router = APIRouter()
WEBHOOK_AVATARS_DIR = Path.cwd() / "static" / "uploads" / "webhook-avatars"
WEBHOOK_AVATARS_DIR.mkdir(parents=True, exist_ok=True)


def _ensure_enabled() -> None:
    if not settings.WEBHOOKS_ENABLED:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Webhooks are disabled")


def _validate_name(name: str) -> str:
    value = name.strip()
    if not value or any(reserved in value.casefold() for reserved in ("miscord", "system", "official")):
        raise HTTPException(status_code=400, detail="Invalid webhook name")
    return value


async def _text_channel(db: AsyncSession, channel_id: int) -> TextChannel:
    channel = await db.get(TextChannel, channel_id)
    if not channel:
        raise HTTPException(status_code=404, detail="Text channel not found")
    return channel


async def _require_manage(db: AsyncSession, user_id: int, channel_id: int) -> TextChannel:
    channel = await _text_channel(db, channel_id)
    permissions = await get_effective_channel_permissions(
        db,
        channel.channel_id,
        user_id,
        "text",
        channel.id,
    )
    if not has_permission(permissions, Permission.MANAGE_WEBHOOKS):
        raise HTTPException(status_code=403, detail="Missing MANAGE_WEBHOOKS permission")
    return channel


async def _managed_webhook(db: AsyncSession, webhook_id: int, user_id: int) -> Webhook:
    webhook = await db.get(Webhook, webhook_id)
    if not webhook:
        raise HTTPException(status_code=404, detail="Webhook not found")
    await _require_manage(db, user_id, webhook.text_channel_id)
    return webhook


async def _token_webhook(db: AsyncSession, webhook_id: int, token: str) -> Webhook:
    if len(token) != 43:
        raise HTTPException(status_code=404, detail="Unknown Webhook")
    webhook = await db.get(Webhook, webhook_id)
    if not webhook or not verify_webhook_token(token, webhook.token_hash):
        raise HTTPException(status_code=404, detail="Unknown Webhook")
    return webhook


def _creator_payload(webhook: Webhook) -> dict[str, Any] | None:
    creator = webhook.creator
    if not creator:
        return None
    return {
        "id": creator.id,
        "username": creator.username,
        "display_name": creator.display_name,
        "avatar_url": creator.avatar_url,
    }


def _management_payload(webhook: Webhook, *, token: str | None = None) -> dict[str, Any]:
    payload = {
        "id": webhook.id,
        "type": 1,
        "server_id": webhook.server_id,
        "channel_id": webhook.text_channel_id,
        "name": webhook.name,
        "avatar_url": webhook.avatar_url,
        "creator": _creator_payload(webhook),
        "created_at": webhook.created_at.isoformat(),
        "updated_at": webhook.updated_at.isoformat(),
    }
    if token:
        payload["token"] = token
        payload["execution_url"] = webhook_execution_url(webhook.id, token)
    return payload


def _public_webhook_payload(webhook: Webhook, token: str) -> dict[str, Any]:
    return {
        "application_id": None,
        "avatar": webhook.avatar_url,
        "channel_id": str(webhook.text_channel_id),
        "guild_id": str(webhook.server_id),
        "id": str(webhook.id),
        "name": webhook.name,
        "token": token,
        "type": 1,
        "url": webhook_execution_url(webhook.id, token),
    }


def _audit_reason(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if len(value) > 512:
        raise HTTPException(status_code=400, detail="X-Audit-Log-Reason cannot exceed 512 characters")
    return value or None


def _webhook_avatar_path(avatar_url: str | None) -> Path | None:
    if not avatar_url:
        return None
    marker = "/static/uploads/webhook-avatars/"
    clean_url = avatar_url.split("?", 1)[0]
    if marker not in clean_url:
        return None
    filename = Path(clean_url.rsplit(marker, 1)[1]).name
    return WEBHOOK_AVATARS_DIR / filename if filename else None


async def _broadcast_webhooks_updated(*channel_ids: int) -> None:
    for channel_id in set(channel_ids):
        await manager.send_to_channel(
            channel_id,
            {"type": "webhooks_updated", "data": {"channel_id": channel_id}},
        )


def _external_message_payload(message: Message) -> dict[str, Any]:
    payload = serialize_channel_message(message)
    payload["channel_id"] = payload.pop("text_channel_id")
    payload.pop("channelId", None)
    for key in ("id", "channel_id", "webhook_id"):
        if payload.get(key) is not None:
            payload[key] = str(payload[key])
    if payload.get("author"):
        payload["author"]["id"] = str(payload["author"]["id"])
    for attachment in payload.get("attachments", []):
        file_url = attachment.get("file_url")
        if isinstance(file_url, str) and file_url.startswith("/"):
            attachment["file_url"] = f"{settings.SERVER_HOST.rstrip('/')}{file_url}"
    return payload


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def _limited(result) -> JSONResponse:
    headers = rate_headers(result)
    headers["Retry-After"] = f"{result.retry_after:.3f}"
    return JSONResponse(
        status_code=429,
        headers=headers,
        content={"message": "You are being rate limited.", "retry_after": result.retry_after, "global": False},
    )


async def _parse_execute_request(
    request: Request,
    *,
    require_message: bool = True,
) -> tuple[WebhookExecute, list[StarletteUploadFile]]:
    content_type = request.headers.get("content-type", "").lower()
    files: list[StarletteUploadFile] = []
    try:
        if content_type.startswith("multipart/form-data"):
            if not settings.WEBHOOK_FILES_ENABLED:
                raise HTTPException(status_code=503, detail="Webhook file uploads are disabled")
            form = await request.form()
            payload_json = form.get("payload_json")
            if not isinstance(payload_json, str):
                raise HTTPException(status_code=400, detail="multipart requests require payload_json")
            raw = json.loads(payload_json)
            for key, value in form.multi_items():
                if key == "payload_json":
                    continue
                if not key.startswith("files[") or not isinstance(value, StarletteUploadFile):
                    raise HTTPException(status_code=400, detail=f"Unsupported multipart field: {key}")
                files.append(value)
        elif content_type.startswith("application/json"):
            raw = await request.json()
        else:
            raise HTTPException(status_code=415, detail="Use application/json or multipart/form-data")
        payload = WebhookExecute.model_validate(raw)
    except HTTPException:
        raise
    except (ValidationError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if len(files) > 10:
        raise HTTPException(status_code=413, detail="A maximum of 10 files is allowed")
    if require_message and not payload.content and not payload.embeds and not files:
        raise HTTPException(status_code=400, detail="Provide content, embeds, or files")
    return payload, files


async def _persist_message(
    db: AsyncSession,
    webhook: Webhook,
    payload: WebhookExecute,
    files: list[StarletteUploadFile],
) -> Message:
    staged = []
    finalized: list[str] = []
    consumed = 0
    try:
        for upload in files:
            item = await stage_upload(upload, consumed)
            consumed += item.size_bytes
            staged.append(item)
        for item in staged:
            try:
                await scan_file(item.path)
            except MalwareDetected as exc:
                raise HTTPException(status_code=422, detail="An attachment was rejected by malware scanning") from exc
            except ClamAVUnavailable as exc:
                raise HTTPException(status_code=503, detail="Malware scanner is unavailable") from exc

        message = Message(
            author_id=None,
            webhook_id=webhook.id,
            webhook_name=payload.username or webhook.name,
            webhook_avatar_url=payload.avatar_url or webhook.avatar_url,
            text_channel_id=webhook.text_channel_id,
            content=payload.content,
            embeds=[] if payload.flags & 4 else [item.model_dump(mode="json", exclude_none=True) for item in payload.embeds],
            flags=payload.flags,
        )
        metadata = {item.id: item for item in payload.attachments}
        for index, item in enumerate(staged):
            storage_key, _destination = finalize_staged_file(item)
            finalized.append(storage_key)
            request_meta = metadata.get(index)
            message.attachments.append(
                Attachment(
                    file_url=None,
                    original_filename=(request_meta.filename if request_meta and request_meta.filename else item.filename),
                    content_type=item.content_type,
                    size_bytes=item.size_bytes,
                    storage_key=storage_key,
                    sha256=item.sha256,
                    description=request_meta.description if request_meta else None,
                )
            )
        db.add(message)
        await db.commit()
        await db.refresh(message)
        await db.refresh(message, attribute_names=["attachments"])
        return message
    except Exception:
        await db.rollback()
        for item in staged:
            item.path.unlink(missing_ok=True)
        for storage_key in finalized:
            remove_storage_key(storage_key)
        raise


async def _broadcast(message: Message) -> dict[str, Any]:
    payload = serialize_channel_message(message)
    await manager.send_to_channel(message.text_channel_id, {"type": "new_message", "data": payload})
    return payload


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
        token_ciphertext=encrypt_webhook_token(token),
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
    return _management_payload(webhook, token=token)


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
    avatar_path = _webhook_avatar_path(webhook.avatar_url)
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
    if avatar_path:
        avatar_path.unlink(missing_ok=True)
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
    old_path = _webhook_avatar_path(webhook.avatar_url)
    try:
        data, extension, _content_type = await read_and_validate_image(avatar)
        filename = save_image_bytes(data, WEBHOOK_AVATARS_DIR, extension)
    finally:
        await avatar.close()
    webhook.avatar_url = to_public_media_path(f"/static/uploads/webhook-avatars/{filename}")
    await db.commit()
    await db.refresh(webhook)
    if old_path and old_path != WEBHOOK_AVATARS_DIR / filename:
        old_path.unlink(missing_ok=True)
    await _broadcast_webhooks_updated(webhook.text_channel_id)
    return _management_payload(webhook)


@router.get("/webhooks/{webhook_id}/execution-url")
async def get_execution_url(webhook_id: int, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    webhook = await _managed_webhook(db, webhook_id, current_user.id)
    token = decrypt_webhook_token(webhook.token_ciphertext)
    return {"execution_url": webhook_execution_url(webhook.id, token)}


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
    webhook.token_ciphertext = encrypt_webhook_token(token)
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
    return {"execution_url": webhook_execution_url(webhook.id, token)}


@router.post("/webhooks/{webhook_id}/test")
async def test_webhook(webhook_id: int, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    webhook = await _managed_webhook(db, webhook_id, current_user.id)
    message = await _persist_message(db, webhook, WebhookExecute(content="Miscord webhook test", flags=4096), [])
    return await _broadcast(message)


@router.get("/webhooks/{webhook_id}/{token}")
async def get_webhook_with_token(webhook_id: int, token: str, db: AsyncSession = Depends(get_db)):
    return _public_webhook_payload(await _token_webhook(db, webhook_id, token), token)


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
    return _public_webhook_payload(webhook, token)


@router.delete("/webhooks/{webhook_id}/{token}", status_code=204)
async def delete_webhook_with_token(webhook_id: int, token: str, db: AsyncSession = Depends(get_db)):
    webhook = await _token_webhook(db, webhook_id, token)
    channel_id = webhook.text_channel_id
    avatar_path = _webhook_avatar_path(webhook.avatar_url)
    await db.delete(webhook)
    await db.commit()
    if avatar_path:
        avatar_path.unlink(missing_ok=True)
    await _broadcast_webhooks_updated(channel_id)
    return Response(status_code=204)


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
    internal = await _broadcast(message)
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
                storage_key, _destination = finalize_staged_file(staged)
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
                remove_storage_key(storage_key)
            raise
    message.is_edited = True
    if not message.content and not message.embeds and not message.attachments:
        raise HTTPException(status_code=400, detail="A message cannot be empty")
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        for storage_key in new_storage_keys:
            remove_storage_key(storage_key)
        raise
    for storage_key in removed_keys:
        remove_storage_key(storage_key)
    payload_out = serialize_channel_message(message)
    await manager.send_to_channel(message.text_channel_id, {"type": "message_updated", "data": payload_out})
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
        remove_storage_key(storage_key)
    await manager.send_to_channel(message.text_channel_id, {"type": "message_deleted", "data": {"id": message.id, "text_channel_id": message.text_channel_id}})
    return Response(status_code=204)
