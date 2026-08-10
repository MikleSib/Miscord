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
from app.services.object_storage import ObjectStorageError, delete_object, delete_public_media, store_public_image
from app.services.rate_limit import rate_limit_user
from app.services.webhook_rate_limit import Bucket, consume, rate_headers
from app.services.webhook_security import (
    generate_webhook_token,
    hash_webhook_token,
    verify_webhook_token,
    webhook_execution_url,
)
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.webhook_notifications import enqueue_webhook_mentions
from app.websocket.connection_manager import manager


logger = logging.getLogger(__name__)
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


def _management_payload(webhook: Webhook) -> dict[str, Any]:
    return {
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


def _public_webhook_payload(webhook: Webhook) -> dict[str, Any]:
    return {
        "application_id": None,
        "avatar": webhook.avatar_url,
        "channel_id": str(webhook.text_channel_id),
        "guild_id": str(webhook.server_id),
        "id": str(webhook.id),
        "name": webhook.name,
        "type": 1,
    }


_NO_STORE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
}


def _one_time_secret_response(payload: dict[str, Any]) -> JSONResponse:
    return JSONResponse(content=payload, headers=_NO_STORE_HEADERS)


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
            storage_key, _destination = await finalize_staged_file(item)
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
            await remove_storage_key(storage_key)
        raise


async def _broadcast(message: Message) -> dict[str, Any]:
    payload = serialize_channel_message(message)
    await manager.send_to_channel(message.text_channel_id, {"type": "new_message", "data": payload})
    return payload

__all__ = [name for name in globals() if not name.startswith('__')]
