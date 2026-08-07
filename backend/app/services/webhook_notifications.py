from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChannelMember, Message, TextChannel
from app.schemas.webhook import AllowedMentions
from app.services.mentions import extract_mention_ids
from app.websocket.connection_manager import manager


@dataclass(frozen=True)
class NotificationJob:
    user_id: int
    payload: dict


class WebhookNotificationDispatcher:
    def __init__(self, maxsize: int = 2000, workers: int = 2):
        self.queue: asyncio.Queue[NotificationJob] = asyncio.Queue(maxsize=maxsize)
        self.worker_count = workers
        self.tasks: list[asyncio.Task] = []

    async def start(self) -> None:
        if not self.tasks:
            self.tasks = [asyncio.create_task(self._worker()) for _ in range(self.worker_count)]

    async def stop(self) -> None:
        for task in self.tasks:
            task.cancel()
        for task in self.tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self.tasks.clear()

    def enqueue(self, job: NotificationJob) -> bool:
        try:
            self.queue.put_nowait(job)
            return True
        except asyncio.QueueFull:
            return False

    async def _worker(self) -> None:
        while True:
            job = await self.queue.get()
            try:
                await manager.send_personal_message(job.payload, job.user_id)
            finally:
                self.queue.task_done()


dispatcher = WebhookNotificationDispatcher()


async def enqueue_webhook_mentions(
    db: AsyncSession,
    text_channel: TextChannel,
    message: Message,
    allowed_mentions: AllowedMentions,
) -> None:
    candidates = extract_mention_ids(message.content)
    if not candidates:
        return
    permitted = set(candidates) if "users" in allowed_mentions.parse else set(allowed_mentions.users)
    requested = list(dict.fromkeys(user_id for user_id in candidates if user_id in permitted))[:100]
    if not requested:
        return
    rows = await db.execute(
        select(ChannelMember.user_id).where(
            ChannelMember.channel_id == text_channel.channel_id,
            ChannelMember.user_id.in_(requested),
        )
    )
    members = set(rows.scalars().all())
    for user_id in requested:
        if user_id not in members:
            continue
        dispatcher.enqueue(
            NotificationJob(
                user_id=user_id,
                payload={
                    "type": "mention",
                    "data": {
                        "message_id": message.id,
                        "text_channel_id": message.text_channel_id,
                        "server_id": text_channel.channel_id,
                        "channel_name": text_channel.name,
                        "author": {
                            "id": message.webhook_id,
                            "username": message.webhook_name,
                            "display_name": None,
                            "avatar_url": message.webhook_avatar_url,
                            "is_webhook": True,
                        },
                        "content": (message.content or "")[:200],
                        "mentioned_user_id": user_id,
                        "mobile_push": True,
                    },
                },
            )
        )

