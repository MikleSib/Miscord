from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models import (
    Message, Poll, StageInstance, StageSpeakerGrant,
    StageSpeakerRequest, TextChannel, VoiceChannelUser,
)
from app.services.realtime_events import enqueue_realtime_event
from app.core.metrics import record_background_job
from app.services.stage_runtime import disconnect_stage_participants

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
            started_at = time.perf_counter()
            try:
                await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                record_background_job("community_scheduler", "error", time.perf_counter() - started_at)
                logger.exception("Community scheduled jobs failed")
            else:
                record_background_job("community_scheduler", "success", time.perf_counter() - started_at)
            await asyncio.sleep(30)

    async def run_once(self) -> tuple[int, int]:
        now = datetime.now(timezone.utc)
        polls_closed = 0
        threads_archived = 0
        ended_stage_channels: list[int] = []
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

            if settings.STAGE_CHANNELS_ENABLED:
                stages = list((await db.execute(
                    select(StageInstance).where(
                        StageInstance.status == "active",
                        StageInstance.empty_since.is_not(None),
                        StageInstance.empty_since <= now - timedelta(seconds=settings.STAGE_EMPTY_TIMEOUT_SECONDS),
                    ).limit(100).with_for_update(skip_locked=True)
                )).scalars().all())
                for stage in stages:
                    members = await db.scalar(select(func.count(VoiceChannelUser.id)).where(
                        VoiceChannelUser.voice_channel_id == stage.channel_id
                    ))
                    if int(members or 0) > 0:
                        stage.empty_since = None
                        continue
                    stage.status = "ended"
                    stage.ended_at = now
                    stage.empty_since = None
                    await db.execute(delete(StageSpeakerRequest).where(
                        StageSpeakerRequest.stage_instance_id == stage.id
                    ))
                    await db.execute(delete(StageSpeakerGrant).where(
                        StageSpeakerGrant.stage_instance_id == stage.id
                    ))
                    enqueue_realtime_event(
                        db, event_type="STAGE_INSTANCE_DELETE",
                        data={"id": stage.id, "channel_id": stage.channel_id, "server_id": stage.server_id},
                        topic="server", target_id=stage.server_id,
                    )
                    ended_stage_channels.append(stage.channel_id)
            await db.commit()
        for channel_id in ended_stage_channels:
            await disconnect_stage_participants(channel_id)
        return polls_closed, threads_archived


community_jobs = CommunityJobs()
