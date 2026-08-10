from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from fastapi.encoders import jsonable_encoder
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import OutboxEvent

EventTopic = Literal["user", "channel", "server", "broadcast"]


def event_envelope(event_id: str, event_type: str, data: dict[str, Any], created_at: datetime) -> dict:
    timestamp = created_at.astimezone(timezone.utc)
    return {
        "event_id": event_id,
        "type": event_type,
        "data": jsonable_encoder(data),
        "created_at": timestamp.isoformat().replace("+00:00", "Z"),
    }


def enqueue_realtime_event(
    db: AsyncSession,
    *,
    event_type: str,
    data: dict[str, Any],
    topic: EventTopic,
    target_id: int | None = None,
) -> OutboxEvent:
    if topic != "broadcast" and target_id is None:
        raise ValueError(f"target_id is required for {topic} events")
    now = datetime.now(timezone.utc)
    event_id = str(uuid4())
    event = OutboxEvent(
        id=event_id,
        event_type=event_type,
        topic=topic,
        target_id=target_id,
        payload=event_envelope(event_id, event_type, data, now),
        created_at=now,
        available_at=now,
    )
    db.add(event)
    return event
