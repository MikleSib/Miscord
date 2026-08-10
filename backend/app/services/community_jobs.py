from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models import Message, Poll, TextChannel
from app.services.realtime_events import enqueue_realtime_event

logger = logging.getLogger(__name__)


class CommunityJobs:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run(), name="community-scheduler")

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
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Community scheduled jobs failed")
            await asyncio.sleep(30)

    async def run_once(self) -> tuple[int, int]:
        now = datetime.now(timezone.utc)
        polls_closed = 0
        threads_archived = 0
        async with AsyncSessionLocal() as db:
            if settings.POLLS_ENABLED:
                polls = list((await db.execute(
                    select(Poll)
                    .where(Poll.closed_at.is_(None), Poll.expires_at <= now)
                    .limit(200)
                    .with_for_update(skip_locked=True)
                )).scalars().all())
                for poll in polls:
                    poll.closed_at = now
                    message_channel_id = await db.scalar(
                        select(Message.text_channel_id).where(Message.id == poll.message_id)
                    )
                    if message_channel_id is None:
                        continue
                    enqueue_realtime_event(
                        db,
                        event_type="POLL_STATE_UPDATE",
                        data={"poll_id": poll.id, "closed": True},
                        topic="channel",
                        target_id=message_channel_id,
                    )
                polls_closed = len(polls)

            if settings.THREADS_ENABLED or settings.FORUMS_ENABLED:
                candidates = list((await db.execute(
                    select(TextChannel)
                    .where(
                        TextChannel.kind.in_(("public_thread", "private_thread", "forum_post")),
                        TextChannel.archived_at.is_(None),
                        TextChannel.last_message_at.is_not(None),
                        TextChannel.last_message_at <= now - timedelta(minutes=60),
                    )
                    .limit(200)
                    .with_for_update(skip_locked=True)
                )).scalars().all())
                for thread in candidates:
                    deadline = thread.last_message_at + timedelta(minutes=thread.auto_archive_minutes)
                    if deadline > now:
                        continue
                    thread.archived_at = now
                    enqueue_realtime_event(
                        db,
                        event_type="THREAD_UPDATE",
                        data={"id": thread.id, "server_id": thread.channel_id, "parent_id": thread.parent_id, "archived": True},
                        topic="server",
                        target_id=thread.channel_id,
                    )
                    threads_archived += 1
            await db.commit()
        return polls_closed, threads_archived


community_jobs = CommunityJobs()
