from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models import UserBlock, UserNotification
from app.models.friendship import FriendshipStatus
from app.services.realtime_events import enqueue_realtime_event

NOTIFICATION_TYPES = {
    "mention",
    "reply",
    "thread_reply",
    "reaction",
    "friend_request",
    "server_invite",
    "application_response",
}


def serialize_notification(item: UserNotification) -> dict:
    return {
        "id": item.id,
        "type": item.type,
        "actor_user_id": item.actor_user_id,
        "server_id": item.server_id,
        "channel_id": item.channel_id,
        "message_id": item.message_id,
        "payload": dict(item.payload or {}),
        "created_at": item.created_at,
        "read_at": item.read_at,
    }


async def create_notification(
    db: AsyncSession,
    *,
    user_id: int,
    type: str,
    actor_user_id: int | None = None,
    server_id: int | None = None,
    channel_id: int | None = None,
    message_id: int | None = None,
    dedupe_key: str | None = None,
    payload: dict[str, Any] | None = None,
) -> UserNotification | None:
    if not settings.INBOX_ENABLED or type not in NOTIFICATION_TYPES or user_id == actor_user_id:
        return None
    if actor_user_id is not None:
        blocked = await db.scalar(
            select(UserBlock.id).where(
                or_(
                    and_(UserBlock.blocker_id == user_id, UserBlock.blocked_id == actor_user_id),
                    and_(UserBlock.blocker_id == actor_user_id, UserBlock.blocked_id == user_id),
                ),
            )
        )
        if blocked is not None:
            return None
    values = {
        "user_id": user_id,
        "type": type,
        "actor_user_id": actor_user_id,
        "server_id": server_id,
        "channel_id": channel_id,
        "message_id": message_id,
        "dedupe_key": dedupe_key,
        "payload": payload or {},
        "created_at": datetime.now(timezone.utc),
        "read_at": None,
    }
    statement = insert(UserNotification).values(**values)
    if dedupe_key:
        statement = statement.on_conflict_do_update(
            constraint="uq_user_notifications_dedupe",
            set_={
                "actor_user_id": actor_user_id,
                "payload": payload or {},
                "created_at": values["created_at"],
                "read_at": None,
            },
        )
    notification_id = await db.scalar(statement.returning(UserNotification.id))
    item = await db.get(UserNotification, notification_id)
    await db.flush()
    enqueue_realtime_event(
        db,
        event_type="NOTIFICATION_CREATE",
        data=serialize_notification(item),
        topic="user",
        target_id=user_id,
    )
    return item


class NotificationRetention:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(), name="notification-retention")

    async def stop(self) -> None:
        task, self._task = self._task, None
        if not task:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def _run(self) -> None:
        while True:
            await asyncio.sleep(3600)
            async with AsyncSessionLocal() as db:
                cutoff = datetime.now(timezone.utc) - timedelta(days=90)
                await db.execute(delete(UserNotification).where(UserNotification.created_at < cutoff))
                await db.commit()


notification_retention = NotificationRetention()
