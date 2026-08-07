from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.services.attachment_storage import attachment_url


def serialize_author(message) -> dict[str, Any]:
    if message.webhook_id is not None:
        return {
            "id": message.webhook_id,
            "username": message.webhook_name or "Webhook",
            "display_name": None,
            "avatar_url": message.webhook_avatar_url,
            "is_webhook": True,
        }
    author = message.author
    return {
        "id": author.id,
        "username": author.display_name or author.username,
        "display_name": author.display_name,
        "avatar_url": getattr(author, "avatar_url", None),
        "is_webhook": False,
    }


def serialize_attachment(attachment) -> dict[str, Any]:
    filename = attachment.original_filename or "attachment"
    url = attachment_url(attachment.id, filename) if attachment.storage_key else attachment.file_url
    return {
        "id": attachment.id,
        "file_url": url,
        "filename": filename,
        "content_type": attachment.content_type or "application/octet-stream",
        "size_bytes": attachment.size_bytes or 0,
        "description": attachment.description,
    }


def serialize_channel_message(message, *, include_reply: bool = True) -> dict[str, Any]:
    reply = None
    if include_reply and getattr(message, "reply_to", None):
        reply = serialize_channel_message(message.reply_to, include_reply=False)
    serialized_attachments = [serialize_attachment(item) for item in (message.attachments or [])]
    attachment_urls = {item["filename"]: item["file_url"] for item in serialized_attachments}
    embeds = deepcopy(message.embeds or [])
    for embed in embeds:
        for container_name in ("image", "thumbnail", "footer", "author"):
            container = embed.get(container_name)
            if not isinstance(container, dict):
                continue
            for field_name in ("url", "icon_url"):
                value = container.get(field_name)
                if isinstance(value, str) and value.startswith("attachment://"):
                    container[field_name] = attachment_urls.get(value.removeprefix("attachment://"), value)
    return {
        "id": message.id,
        "author_id": message.author_id,
        "webhook_id": message.webhook_id,
        "text_channel_id": message.text_channel_id,
        "channelId": message.text_channel_id,
        "content": message.content,
        "timestamp": message.timestamp.isoformat() if message.timestamp else None,
        "is_edited": message.is_edited,
        "is_deleted": message.is_deleted,
        "reply_to_id": message.reply_to_id,
        "author": serialize_author(message),
        "attachments": serialized_attachments,
        "reactions": [],
        "reply_to": reply,
        "embeds": embeds,
        "flags": message.flags or 0,
    }
