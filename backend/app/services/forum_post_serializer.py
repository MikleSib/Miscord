from __future__ import annotations

import re
from collections import defaultdict

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ForumPostTag, Message, TextChannel, ThreadMember, User


def _preview(content: str | None, limit: int = 240) -> str | None:
    normalized = re.sub(r"\s+", " ", content or "").strip()
    if not normalized:
        return None
    return normalized if len(normalized) <= limit else f"{normalized[:limit - 1].rstrip()}…"


async def serialize_forum_posts(
    db: AsyncSession,
    posts: list[TextChannel],
    user_id: int,
) -> list[dict]:
    if not posts:
        return []

    post_ids = [post.id for post in posts]
    owner_ids = {post.owner_id for post in posts if post.owner_id is not None}
    starter_ids = {post.starter_message_id for post in posts if post.starter_message_id is not None}

    member_rows = await db.execute(
        select(ThreadMember.thread_id, func.count(ThreadMember.id))
        .where(ThreadMember.thread_id.in_(post_ids))
        .group_by(ThreadMember.thread_id)
    )
    member_counts = {thread_id: int(count) for thread_id, count in member_rows}

    joined_rows = await db.execute(
        select(ThreadMember.thread_id).where(
            ThreadMember.thread_id.in_(post_ids),
            ThreadMember.user_id == user_id,
        )
    )
    joined = set(joined_rows.scalars().all())

    tag_rows = await db.execute(
        select(ForumPostTag.post_id, ForumPostTag.tag_id).where(ForumPostTag.post_id.in_(post_ids))
    )
    tag_ids: dict[int, list[int]] = defaultdict(list)
    for post_id, tag_id in tag_rows:
        tag_ids[post_id].append(tag_id)

    message_rows = await db.execute(
        select(Message.text_channel_id, func.count(Message.id))
        .where(Message.text_channel_id.in_(post_ids), Message.is_deleted.is_(False))
        .group_by(Message.text_channel_id)
    )
    message_counts = {channel_id: int(count) for channel_id, count in message_rows}

    starters: dict[int, str | None] = {}
    if starter_ids:
        starter_rows = await db.execute(
            select(Message.id, Message.content).where(Message.id.in_(starter_ids), Message.is_deleted.is_(False))
        )
        starters = {message_id: content for message_id, content in starter_rows}

    owners: dict[int, dict] = {}
    if owner_ids:
        owner_rows = await db.execute(select(User).where(User.id.in_(owner_ids)))
        owners = {
            owner.id: {
                "id": owner.id,
                "username": owner.username,
                "display_name": owner.display_name,
                "avatar_url": owner.avatar_url,
            }
            for owner in owner_rows.scalars().all()
        }

    return [
        {
            "id": post.id,
            "name": post.name,
            "server_id": post.channel_id,
            "parent_id": post.parent_id,
            "owner_id": post.owner_id,
            "owner": owners.get(post.owner_id),
            "kind": post.kind,
            "archived_at": post.archived_at,
            "locked": bool(post.locked),
            "auto_archive_minutes": post.auto_archive_minutes,
            "last_message_at": post.last_message_at,
            "created_at": post.created_at,
            "member_count": member_counts.get(post.id, 0),
            "message_count": message_counts.get(post.id, 0),
            "joined": post.id in joined,
            "tag_ids": tag_ids.get(post.id, []),
            "starter_message_id": post.starter_message_id,
            "preview": _preview(starters.get(post.starter_message_id)),
        }
        for post in posts
    ]
