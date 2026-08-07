"""Уведомления о новых сообщениях по персональным настройкам («Все сообщения»)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChannelMember, TextChannel, User
from app.models.notification_settings import (
    ChannelNotificationOverride,
    ServerNotificationSettings,
)
from app.services.channel_permissions import can_view_channel
from app.services.mentions import extract_mention_ids
from app.services.notification_settings import (
    DEFAULT_SETTINGS,
    serialize_settings,
    should_notify_message,
)


async def notify_channel_message_activity(
    db: AsyncSession,
    manager,
    *,
    content: str | None,
    author: User,
    text_channel: TextChannel,
    message_id: int,
) -> None:
    """Шлёт личные уведомления участникам с уровнем «Все сообщения».

    Упомянутых пользователей пропускаем — им уже уходит событие mention.
    """
    server_id = text_channel.channel_id
    mentioned_ids = set(extract_mention_ids(content))

    members_result = await db.execute(
        select(ChannelMember.user_id).where(ChannelMember.channel_id == server_id)
    )
    member_ids = [row[0] for row in members_result.fetchall() if row[0] != author.id]
    if not member_ids:
        return

    settings_result = await db.execute(
        select(ServerNotificationSettings).where(
            ServerNotificationSettings.server_id == server_id,
            ServerNotificationSettings.user_id.in_(member_ids),
        )
    )
    settings_rows = {row.user_id: row for row in settings_result.scalars().all()}

    overrides_result = await db.execute(
        select(ChannelNotificationOverride).where(
            ChannelNotificationOverride.server_id == server_id,
            ChannelNotificationOverride.user_id.in_(member_ids),
        )
    )
    overrides_by_user: dict[int, list[ChannelNotificationOverride]] = {}
    for item in overrides_result.scalars().all():
        overrides_by_user.setdefault(item.user_id, []).append(item)

    # Быстрый отсев: если у всех уровень mentions/nothing — почти никто не получит.
    # Но default = all, поэтому всё равно проверяем каждого.
    author_name = author.display_name or author.username
    preview = (content or "")[:200]

    for user_id in member_ids:
        if user_id in mentioned_ids:
            continue

        settings = serialize_settings(
            settings_rows.get(user_id),
            overrides_by_user.get(user_id, []),
        )
        if not should_notify_message(settings, text_channel_id=text_channel.id):
            continue

        can_view = await can_view_channel(
            db,
            server_id,
            user_id,
            "text",
            text_channel.id,
        )
        if not can_view:
            continue

        await manager.send_personal_message(
            {
                "type": "channel_message",
                "data": {
                    "message_id": message_id,
                    "text_channel_id": text_channel.id,
                    "server_id": server_id,
                    "channel_name": text_channel.name,
                    "author": {
                        "id": author.id,
                        "username": author_name,
                        "display_name": author.display_name,
                        "avatar_url": getattr(author, "avatar_url", None),
                    },
                    "content": preview,
                    "mobile_push": bool(settings.get("mobile_push", DEFAULT_SETTINGS["mobile_push"])),
                },
            },
            user_id,
        )
