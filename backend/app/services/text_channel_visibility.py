from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import TextChannel


def filter_visible_text_channels(channels: Iterable[TextChannel]) -> list[TextChannel]:
    return [channel for channel in channels if not channel.is_hidden]


async def get_visible_text_channel(
    db: AsyncSession,
    text_channel_id: int,
) -> Optional[TextChannel]:
    result = await db.execute(
        select(TextChannel).where(
            TextChannel.id == text_channel_id,
            TextChannel.is_hidden.is_(False),
        )
    )
    return result.scalar_one_or_none()


async def get_text_channel_any(
    db: AsyncSession,
    text_channel_id: int,
) -> Optional[TextChannel]:
    result = await db.execute(select(TextChannel).where(TextChannel.id == text_channel_id))
    return result.scalar_one_or_none()
