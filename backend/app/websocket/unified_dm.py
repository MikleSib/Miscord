from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DirectMessage, PendingChatUpload, User
from app.services import direct_message_service
from app.services.rate_limit import enforce_message_antispam, rate_limit_payload
from app.services.communication_safety import can_send_dm
from app.services.datetime_serializer import utc_isoformat
from app.schemas.expressions import GifSelection
from app.services.message_media import serialize_message_media


async def send_message_failure(
    user_id: int,
    client_nonce: Optional[str],
    code: str,
    message: str,
    retryable: bool = False,
    retry_after_seconds: Optional[float] = None,
) -> None:
    if not client_nonce:
        return
    from app.websocket.connection_manager import manager

    await manager.send_to_user(user_id, {
        "type": "message_send_failed",
        "data": {
            "client_nonce": client_nonce,
            "code": code,
            "message": message,
            "retryable": retryable,
            "retry_after_seconds": retry_after_seconds,
        },
    })


async def handle_dm_message(
    user: User,
    message_data: dict,
    db: AsyncSession,
    manager,
) -> None:
    recipient_id = message_data.get("recipient_id")
    content = message_data.get("content", "").strip()
    attachments = list(message_data.get("attachments", []) or [])
    upload_ids = list(dict.fromkeys(
        str(item) for item in (message_data.get("attachment_upload_ids") or [])
    ))
    client_nonce = message_data.get("client_nonce")
    reply_to_id = message_data.get("reply_to_id")
    sticker_ids = list(dict.fromkeys(int(item) for item in (message_data.get("sticker_ids") or [])))
    gif_data = message_data.get("gif")
    try:
        gif_selection = GifSelection.model_validate(gif_data) if gif_data else None
    except Exception:
        await send_message_failure(user.id, client_nonce, "invalid_gif", "Выбранный GIF недоступен.")
        return

    if (not content and not attachments and not upload_ids and not sticker_ids and gif_selection is None) or not recipient_id:
        await send_message_failure(
            user.id, client_nonce, "invalid_message",
            "Получатель или содержимое сообщения не указаны.",
        )
        return
    if len(content) > 5000 or len(attachments) + len(upload_ids) > 10:
        await send_message_failure(
            user.id, client_nonce, "validation_error",
            "Превышен лимит текста или вложений.",
        )
        return
    if client_nonce is not None and (
        not isinstance(client_nonce, str) or len(client_nonce) > 64
    ):
        return

    allowed_dm, dm_error = await can_send_dm(db, user.id, int(recipient_id))
    if not allowed_dm:
        await send_message_failure(
            user.id, client_nonce, "dm_forbidden", dm_error or "Личные сообщения недоступны.",
        )
        return

    if client_nonce:
        existing = (await db.execute(select(DirectMessage).where(
            DirectMessage.sender_id == user.id,
            DirectMessage.client_nonce == client_nonce,
        ))).scalar_one_or_none()
        if existing is not None:
            if existing.recipient_id != recipient_id or (existing.content or "") != content:
                await send_message_failure(
                    user.id, client_nonce, "nonce_conflict",
                    "client_nonce уже использован для другого сообщения.",
                )
                return
            await manager.send_to_user(user.id, {
                "type": "message_ack",
                "data": {"id": existing.id, "client_nonce": existing.client_nonce},
            })
            return

    pending_uploads = []
    if upload_ids:
        pending_uploads = (await db.execute(select(PendingChatUpload).where(
            PendingChatUpload.id.in_(upload_ids),
            PendingChatUpload.owner_id == user.id,
        ))).scalars().all()
        if len(pending_uploads) != len(upload_ids):
            await send_message_failure(
                user.id, client_nonce, "upload_expired",
                "Загрузка файла не найдена или истекла.", True,
            )
            return

    allowed, retry_after, limit_message = enforce_message_antispam(
        user.id,
        dest_key=f"dm:{min(user.id, int(recipient_id))}:{max(user.id, int(recipient_id))}",
        content=content,
    )
    if not allowed:
        await send_message_failure(
            user.id, client_nonce, "rate_limited", limit_message, True, retry_after,
        )
        await manager.send_to_user(user.id, rate_limit_payload(
            message=limit_message,
            retry_after_seconds=retry_after,
            scope="dm",
            recipient_id=int(recipient_id),
        ))
        return

    try:
        db_message = await direct_message_service.create_message(
            db,
            sender_id=user.id,
            recipient_id=recipient_id,
            content=content or None,
            attachments=attachments,
            reply_to_id=reply_to_id,
            client_nonce=client_nonce,
            pending_uploads=pending_uploads,
            sticker_ids=sticker_ids,
            gif=gif_selection,
        )
    except direct_message_service.DirectMessageReplyError:
        await send_message_failure(
            user.id, client_nonce, "invalid_reply", "Сообщение для ответа не найдено в этом диалоге.",
        )
        return
    except ValueError as exc:
        await db.rollback()
        await send_message_failure(user.id, client_nonce, "invalid_sticker", str(exc))
        return
    author = await db.get(User, user.id)
    message_dict = {
        "id": db_message.id,
        "client_nonce": db_message.client_nonce,
        "content": db_message.content,
        "timestamp": utc_isoformat(db_message.timestamp),
        "sender_id": db_message.sender_id,
        "recipient_id": db_message.recipient_id,
        "author": {
            "id": author.id,
            "username": author.username,
            "email": "",
            "display_name": author.display_name,
            "avatar_url": author.avatar_url,
            "is_active": author.is_active,
            "is_online": author.is_online,
            "created_at": author.created_at,
            "updated_at": author.updated_at,
        },
        "attachments": [{
            "id": attachment.id,
            "file_url": attachment.file_url,
            "message_id": attachment.dm_message_id,
        } for attachment in (db_message.attachments or [])],
        "reactions": [],
        "reply_to": None if not db_message.reply_to else {
            "id": db_message.reply_to.id,
            "content": db_message.reply_to.content,
            "timestamp": utc_isoformat(db_message.reply_to.timestamp),
            "sender_id": db_message.reply_to.sender_id,
            "recipient_id": db_message.reply_to.recipient_id,
        },
    }
    media = await serialize_message_media(db, dm_message_ids=[db_message.id])
    message_dict.update(media.get(db_message.id, {"sticker_items": [], "gif": None}))
    payload = {"type": "dm", "data": message_dict}
    await manager.send_personal_message(payload, recipient_id)
    await manager.send_personal_message(payload, user.id)
