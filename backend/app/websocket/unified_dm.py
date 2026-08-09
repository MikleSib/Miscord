from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DirectMessage, PendingChatUpload, User
from app.services import direct_message_service
from app.services.rate_limit import enforce_message_antispam, rate_limit_payload


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

    if (not content and not attachments and not upload_ids) or not recipient_id:
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

    db_message = await direct_message_service.create_message(
        db,
        sender_id=user.id,
        recipient_id=recipient_id,
        content=content or None,
        attachments=attachments,
        reply_to_id=reply_to_id,
        client_nonce=client_nonce,
        pending_uploads=pending_uploads,
    )
    author = await db.get(User, user.id)
    message_dict = {
        "id": db_message.id,
        "client_nonce": db_message.client_nonce,
        "content": db_message.content,
        "timestamp": db_message.timestamp,
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
            "timestamp": db_message.reply_to.timestamp,
            "sender_id": db_message.reply_to.sender_id,
            "recipient_id": db_message.reply_to.recipient_id,
        },
    }
    payload = {"type": "dm", "data": message_dict}
    await manager.send_personal_message(payload, recipient_id)
    await manager.send_personal_message(payload, user.id)
