from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Optional, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import Permission, has_permission
from app.models.channel import TextChannel
from app.models.message import Message
from app.models.user import User

SLOW_MODE_OPTIONS = (
    0,
    5,
    10,
    15,
    30,
    60,
    120,
    300,
    600,
    900,
    3600,
    7200,
    21600,
)


def normalize_slow_mode_seconds(value: Optional[int]) -> int:
    if value is None:
        return 0
    if value not in SLOW_MODE_OPTIONS:
        raise ValueError("Недопустимое значение медленного режима")
    return value


async def check_slow_mode(
    db: AsyncSession,
    text_channel: TextChannel,
    user: User,
) -> Tuple[bool, Optional[int]]:
    """Проверяет, может ли пользователь отправить сообщение сейчас."""
    if text_channel.slow_mode_seconds <= 0:
        return True, None

    if await has_permission(db, text_channel.channel_id, user, Permission.MANAGE_CHANNELS):
        return True, None
    if await has_permission(db, text_channel.channel_id, user, Permission.MANAGE_MESSAGES):
        return True, None

    last_result = await db.execute(
        select(Message.timestamp)
        .where(
            Message.text_channel_id == text_channel.id,
            Message.author_id == user.id,
            Message.is_deleted.is_(False),
        )
        .order_by(Message.timestamp.desc())
        .limit(1)
    )
    last_timestamp = last_result.scalar_one_or_none()
    if not last_timestamp:
        return True, None

    now = datetime.now(timezone.utc)
    if last_timestamp.tzinfo is None:
        last_timestamp = last_timestamp.replace(tzinfo=timezone.utc)

    elapsed = (now - last_timestamp).total_seconds()
    remaining = text_channel.slow_mode_seconds - elapsed
    if remaining > 0:
        return False, int(math.ceil(remaining))
    return True, None
