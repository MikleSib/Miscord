"""Упоминания пользователей в текстовых сообщениях (<@user_id>)."""

from __future__ import annotations

import re
from typing import Iterable, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import Permission, get_member_permissions, has_permission, is_member
from app.models import TextChannel, User
from app.services import notification_settings as notification_settings_service

MENTION_RE = re.compile(r"<@(\d+)>")


def extract_mention_ids(content: Optional[str]) -> list[int]:
    if not content:
        return []
    seen: set[int] = set()
    ids: list[int] = []
    for match in MENTION_RE.finditer(content):
        user_id = int(match.group(1))
        if user_id in seen:
            continue
        seen.add(user_id)
        ids.append(user_id)
    return ids


async def notify_message_mentions(
    db: AsyncSession,
    manager,
    *,
    content: Optional[str],
    author: User,
    text_channel: TextChannel,
    message_id: int,
) -> None:
    """Пишет персональное уведомление упомянутым участникам с доступом к каналу."""
    mentioned_ids = extract_mention_ids(content)
    if not mentioned_ids:
        return

    server_id = text_channel.channel_id
    author_name = author.display_name or author.username

    for user_id in mentioned_ids:
        if user_id == author.id:
            continue

        if not await is_member(db, server_id, user_id):
            continue

        permissions = await get_member_permissions(db, server_id, user_id)
        if not has_permission(permissions, Permission.VIEW_CHANNELS):
            continue

        settings = await notification_settings_service.get_settings(db, server_id, user_id)
        # Личные <@id> не глушатся флагами everyone/roles — только уровнем/mute канала
        if not notification_settings_service.should_notify_mention(
            settings,
            text_channel_id=text_channel.id,
            is_everyone=False,
            is_role_mention=False,
        ):
            continue

        await manager.send_personal_message(
            {
                "type": "mention",
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
                    "content": (content or "")[:200],
                    "mentioned_user_id": user_id,
                    "mobile_push": bool(settings.get("mobile_push", True)),
                },
            },
            user_id,
        )


def filter_mentionable_user_ids(
    candidate_ids: Iterable[int],
    *,
    allowed_ids: set[int],
) -> list[int]:
    return [user_id for user_id in candidate_ids if user_id in allowed_ids]
