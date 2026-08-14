from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChannelMember, MessageMedia, ServerExpression
from app.schemas.expressions import GifSelection


def serialize_expression(item: ServerExpression) -> dict:
    return {
        "id": item.id,
        "server_id": item.server_id,
        "kind": item.kind,
        "name": item.name,
        "description": item.description,
        "file_url": item.file_url,
        "content_type": item.content_type,
        "width": item.width,
        "height": item.height,
        "duration_ms": item.duration_ms,
        "animated": bool(item.animated),
        "available": bool(item.available),
    }


async def attach_message_media(
    db: AsyncSession,
    *,
    message_id: int | None = None,
    dm_message_id: int | None = None,
    sticker_ids: list[int] | None = None,
    gif: GifSelection | None = None,
    server_id: int | None = None,
    sender_id: int | None = None,
    recipient_id: int | None = None,
) -> None:
    unique_stickers = list(dict.fromkeys(sticker_ids or []))
    if unique_stickers:
        query = select(ServerExpression).where(
            ServerExpression.id.in_(unique_stickers),
            ServerExpression.kind == "sticker",
            ServerExpression.available.is_(True),
        )
        if server_id is not None:
            query = query.where(ServerExpression.server_id == server_id)
        elif sender_id is not None and recipient_id is not None:
            shared_servers = select(ChannelMember.channel_id).where(
                ChannelMember.user_id == sender_id,
                ChannelMember.channel_id.in_(
                    select(ChannelMember.channel_id).where(ChannelMember.user_id == recipient_id)
                ),
            )
            query = query.where(ServerExpression.server_id.in_(shared_servers))
        found = {item.id for item in (await db.execute(query)).scalars().all()}
        if found != set(unique_stickers):
            raise ValueError("Один из стикеров недоступен")
        for position, expression_id in enumerate(unique_stickers):
            db.add(MessageMedia(
                message_id=message_id,
                dm_message_id=dm_message_id,
                expression_id=expression_id,
                media_type="sticker",
                position=position,
            ))
    if gif is not None:
        db.add(MessageMedia(
            message_id=message_id,
            dm_message_id=dm_message_id,
            media_type="gif",
            provider=gif.provider,
            provider_id=gif.id,
            metadata_json=gif.model_dump(exclude={"provider", "id"}, exclude_none=True),
        ))


async def serialize_message_media(
    db: AsyncSession,
    *,
    message_ids: list[int] | None = None,
    dm_message_ids: list[int] | None = None,
) -> dict[int, dict]:
    if message_ids:
        key_column = MessageMedia.message_id
        query = select(MessageMedia, ServerExpression).outerjoin(
            ServerExpression, MessageMedia.expression_id == ServerExpression.id
        ).where(MessageMedia.message_id.in_(message_ids))
    elif dm_message_ids:
        key_column = MessageMedia.dm_message_id
        query = select(MessageMedia, ServerExpression).outerjoin(
            ServerExpression, MessageMedia.expression_id == ServerExpression.id
        ).where(MessageMedia.dm_message_id.in_(dm_message_ids))
    else:
        return {}
    rows = (await db.execute(query.order_by(key_column, MessageMedia.position))).all()
    result: dict[int, dict] = {}
    for media, expression in rows:
        target_id = media.message_id or media.dm_message_id
        entry = result.setdefault(int(target_id), {"sticker_items": [], "gif": None})
        if media.media_type == "sticker" and expression is not None:
            entry["sticker_items"].append(serialize_expression(expression))
        elif media.media_type == "gif":
            entry["gif"] = {
                "provider": media.provider,
                "id": media.provider_id,
                **dict(media.metadata_json or {}),
            }
    return result
