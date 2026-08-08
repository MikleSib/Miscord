"""Персональные настройки уведомлений сервера."""

from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification_settings import (
    ChannelNotificationOverride,
    ServerNotificationSettings,
)

VALID_LEVELS = {"all", "mentions", "nothing"}
VALID_OVERRIDE_LEVELS = {"all", "mentions", "nothing", "muted"}

DEFAULT_SETTINGS = {
    "muted": False,
    "notification_level": "all",
    "suppress_everyone": False,
    "suppress_roles": False,
    "suppress_highlights": False,
    "mute_events": False,
    "mobile_push": True,
}


def serialize_settings(
    row: Optional[ServerNotificationSettings],
    overrides: Optional[list[ChannelNotificationOverride]] = None,
) -> dict[str, Any]:
    base = dict(DEFAULT_SETTINGS)
    if row:
        base.update(
            {
                "muted": bool(row.muted),
                "notification_level": row.notification_level
                if row.notification_level in VALID_LEVELS
                else "all",
                "suppress_everyone": bool(row.suppress_everyone),
                "suppress_roles": bool(row.suppress_roles),
                "suppress_highlights": bool(row.suppress_highlights),
                "mute_events": bool(row.mute_events),
                "mobile_push": bool(row.mobile_push),
            }
        )

    return {
        **base,
        "channel_overrides": [
            {
                "text_channel_id": item.text_channel_id,
                "level": item.level if item.level in VALID_OVERRIDE_LEVELS else "mentions",
            }
            for item in (overrides or [])
        ],
    }


async def get_settings(
    db: AsyncSession,
    server_id: int,
    user_id: int,
) -> dict[str, Any]:
    result = await db.execute(
        select(ServerNotificationSettings).where(
            ServerNotificationSettings.server_id == server_id,
            ServerNotificationSettings.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()

    overrides_result = await db.execute(
        select(ChannelNotificationOverride).where(
            ChannelNotificationOverride.server_id == server_id,
            ChannelNotificationOverride.user_id == user_id,
        )
    )
    overrides = list(overrides_result.scalars().all())
    return serialize_settings(row, overrides)


async def upsert_settings(
    db: AsyncSession,
    server_id: int,
    user_id: int,
    patch: dict[str, Any],
) -> dict[str, Any]:
    result = await db.execute(
        select(ServerNotificationSettings).where(
            ServerNotificationSettings.server_id == server_id,
            ServerNotificationSettings.user_id == user_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        row = ServerNotificationSettings(server_id=server_id, user_id=user_id)
        db.add(row)

    if "muted" in patch and patch["muted"] is not None:
        row.muted = bool(patch["muted"])
    if "notification_level" in patch and patch["notification_level"] is not None:
        level = str(patch["notification_level"])
        if level not in VALID_LEVELS:
            raise ValueError("Некорректный уровень уведомлений")
        row.notification_level = level
    if "suppress_everyone" in patch and patch["suppress_everyone"] is not None:
        row.suppress_everyone = bool(patch["suppress_everyone"])
    if "suppress_roles" in patch and patch["suppress_roles"] is not None:
        row.suppress_roles = bool(patch["suppress_roles"])
    if "suppress_highlights" in patch and patch["suppress_highlights"] is not None:
        row.suppress_highlights = bool(patch["suppress_highlights"])
    if "mute_events" in patch and patch["mute_events"] is not None:
        row.mute_events = bool(patch["mute_events"])
    if "mobile_push" in patch and patch["mobile_push"] is not None:
        row.mobile_push = bool(patch["mobile_push"])

    await db.commit()
    return await get_settings(db, server_id, user_id)


async def upsert_channel_override(
    db: AsyncSession,
    server_id: int,
    user_id: int,
    text_channel_id: int,
    level: str,
) -> dict[str, Any]:
    if level not in VALID_OVERRIDE_LEVELS:
        raise ValueError("Некорректный уровень переопределения")

    result = await db.execute(
        select(ChannelNotificationOverride).where(
            ChannelNotificationOverride.user_id == user_id,
            ChannelNotificationOverride.text_channel_id == text_channel_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        row = ChannelNotificationOverride(
            server_id=server_id,
            user_id=user_id,
            text_channel_id=text_channel_id,
            level=level,
        )
        db.add(row)
    else:
        row.server_id = server_id
        row.level = level

    await db.commit()
    return await get_settings(db, server_id, user_id)


async def delete_channel_override(
    db: AsyncSession,
    server_id: int,
    user_id: int,
    text_channel_id: int,
) -> dict[str, Any]:
    result = await db.execute(
        select(ChannelNotificationOverride).where(
            ChannelNotificationOverride.server_id == server_id,
            ChannelNotificationOverride.user_id == user_id,
            ChannelNotificationOverride.text_channel_id == text_channel_id,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
    return await get_settings(db, server_id, user_id)


def effective_channel_level(settings: dict[str, Any], text_channel_id: int) -> str:
    """Итоговый уровень для канала с учётом mute сервера и override."""
    for item in settings.get("channel_overrides") or []:
        if int(item["text_channel_id"]) == int(text_channel_id):
            return item["level"]

    if settings.get("muted"):
        # Для заглушенного сервера пропускаем только упоминания
        return "mentions"

    level = settings.get("notification_level") or "all"
    return level if level in VALID_LEVELS else "all"


def should_notify_mention(
    settings: dict[str, Any],
    *,
    text_channel_id: int,
    is_everyone: bool = False,
    is_role_mention: bool = False,
) -> bool:
    """Нужно ли показывать/отправлять уведомление об упоминании."""
    level = effective_channel_level(settings, text_channel_id)
    if level in {"nothing", "muted"}:
        return False

    if is_everyone and settings.get("suppress_everyone"):
        return False
    if is_role_mention and settings.get("suppress_roles"):
        return False

    # all / mentions — личные @упоминания всегда проходят
    return True


def should_notify_message(settings: dict[str, Any], *, text_channel_id: int) -> bool:
    """Нужно ли уведомлять о обычном сообщении (не mention)."""
    level = effective_channel_level(settings, text_channel_id)
    return level == "all"
