from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models import OutboxEvent
from app.core.metrics import OUTBOX_DELIVERIES, record_background_job

logger = logging.getLogger(__name__)


class OutboxPublisher:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stopping = asyncio.Event()

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stopping.clear()
        self._task = asyncio.create_task(self._run(), name="community-outbox-publisher")

    async def stop(self) -> None:
        self._stopping.set()
        task, self._task = self._task, None
        if not task:
            return
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    async def _run(self) -> None:
        interval = max(0.05, float(settings.OUTBOX_POLL_INTERVAL_SECONDS))
        while not self._stopping.is_set():
            try:
                published = await self.publish_batch()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Outbox batch failed")
                published = 0
            if published == 0:
                await asyncio.sleep(interval)

    async def publish_batch(self) -> int:
        started_at = time.perf_counter()
        job_status = "success"
        now = datetime.now(timezone.utc)
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(OutboxEvent)
                    .where(
                        OutboxEvent.published_at.is_(None),
                        OutboxEvent.available_at <= now,
                    )
                    .order_by(OutboxEvent.created_at, OutboxEvent.id)
                    .limit(max(1, int(settings.OUTBOX_BATCH_SIZE)))
                    .with_for_update(skip_locked=True)
                )
                events = list(result.scalars().all())
                for event in events:
                    try:
                        await self._publish(db, event)
                        event.published_at = datetime.now(timezone.utc)
                        event.last_error = None
                        OUTBOX_DELIVERIES.labels(status="success", topic=event.topic).inc()
                    except Exception as exc:  # noqa: BLE001
                        job_status = "partial_failure"
                        OUTBOX_DELIVERIES.labels(status="error", topic=event.topic).inc()
                        event.attempts = int(event.attempts or 0) + 1
                        delay = min(300, 2 ** min(event.attempts, 8))
                        event.available_at = datetime.now(timezone.utc) + timedelta(seconds=delay)
                        event.last_error = str(exc)[:500]
                        logger.warning("Outbox event %s failed on attempt %s", event.id, event.attempts)
                await db.commit()
                return len(events)
        except Exception:
            job_status = "error"
            raise
        finally:
            record_background_job("outbox_publish", job_status, time.perf_counter() - started_at)

    async def _publish(self, db, event: OutboxEvent) -> None:
        from app.services.server_events import get_server_member_ids
        from app.websocket.connection_manager import manager

        if event.topic == "user":
            await manager.send_personal_message(event.payload, int(event.target_id))
        elif event.topic == "channel":
            await manager.send_to_channel(int(event.target_id), event.payload)
        elif event.topic == "server":
            recipients = await get_server_member_ids(db, int(event.target_id))
            for user_id in recipients:
                await manager.send_personal_message(event.payload, user_id)
        elif event.topic == "broadcast":
            await manager.broadcast(event.payload)
        else:
            raise ValueError(f"Unsupported outbox topic: {event.topic}")


outbox_publisher = OutboxPublisher()
