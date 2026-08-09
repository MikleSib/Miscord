"""Закреплённые сообщения текстовых каналов."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.db.database import get_db
from app.models import User
from app.services.audit_service import AuditAction, log_audit
from app.services.channel_access import require_text_channel_access
from app.services.message_pins import (
    MAX_PINNED_MESSAGES,
    get_message_in_channel,
    list_pinned,
    require_pin_permission,
    set_pinned,
    user_can_pin_messages,
)
from app.services.message_serializer import serialize_channel_message
from app.websocket.connection_manager import manager
from app.websocket.events import CHANNEL_PINS_UPDATED

router = APIRouter()


async def _notify_pins_updated(text_channel_id: int) -> None:
    await manager.send_to_channel(
        text_channel_id,
        {
            "type": CHANNEL_PINS_UPDATED,
            "data": {"text_channel_id": text_channel_id},
        },
    )


@router.get("/text/{channel_id}/pins")
async def get_pinned_messages(
    channel_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Закреплённые сообщения канала (не более 50)."""
    text_channel = await require_text_channel_access(db, current_user, channel_id)
    messages = await list_pinned(db, text_channel.id)

    return {
        "text_channel_id": text_channel.id,
        "limit": MAX_PINNED_MESSAGES,
        "can_manage": await user_can_pin_messages(db, current_user, text_channel),
        "messages": [
            serialize_channel_message(message, include_reply=False) for message in messages
        ],
    }


@router.put("/text/{channel_id}/pins/{message_id}")
async def pin_message(
    channel_id: int,
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    text_channel = await require_text_channel_access(db, current_user, channel_id)
    await require_pin_permission(db, current_user, text_channel)

    message = await get_message_in_channel(db, message_id, text_channel.id)
    changed = await set_pinned(db, message, current_user, True)

    if changed:
        await log_audit(
            db,
            text_channel.channel_id,
            current_user,
            AuditAction.MESSAGE_PIN,
            target_type="message",
            target_id=message.id,
            target_name=text_channel.name,
        )
        await _notify_pins_updated(text_channel.id)

    return {"message_id": message.id, "pinned": True}


@router.delete("/text/{channel_id}/pins/{message_id}")
async def unpin_message(
    channel_id: int,
    message_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    text_channel = await require_text_channel_access(db, current_user, channel_id)
    await require_pin_permission(db, current_user, text_channel)

    message = await get_message_in_channel(db, message_id, text_channel.id)
    changed = await set_pinned(db, message, current_user, False)

    if changed:
        await log_audit(
            db,
            text_channel.channel_id,
            current_user,
            AuditAction.MESSAGE_UNPIN,
            target_type="message",
            target_id=message.id,
            target_name=text_channel.name,
        )
        await _notify_pins_updated(text_channel.id)

    return {"message_id": message.id, "pinned": False}
