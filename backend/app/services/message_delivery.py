from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Message, Reaction
from app.models.community import Poll
from app.services.message_serializer import serialize_channel_message
from app.services.polls import serialize_poll
from app.services.message_media import serialize_message_media


async def load_message_for_delivery(
    db: AsyncSession,
    message_id: int,
    viewer_id: int,
) -> tuple[Message, dict]:
    result = await db.execute(
        select(Message)
        .where(Message.id == message_id)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions).selectinload(Reaction.user),
            selectinload(Message.reply_to).selectinload(Message.author),
            selectinload(Message.reply_to).selectinload(Message.attachments),
        )
    )
    message = result.scalar_one()
    payload = serialize_channel_message(message)
    poll = await db.scalar(select(Poll).where(Poll.message_id == message.id))
    if poll is not None:
        payload["poll"] = await serialize_poll(db, poll, viewer_id)
    media = await serialize_message_media(db, message_ids=[message.id])
    payload.update(media.get(message.id, {"sticker_items": [], "gif": None}))
    return message, payload


def message_ack_payload(message: dict) -> dict:
    return {
        "type": "message_ack",
        "data": {
            "id": message["id"],
            "client_nonce": message.get("client_nonce"),
            "message": message,
        },
    }
