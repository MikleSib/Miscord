from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import TextChannel, ThreadMember


async def serialize_thread(db: AsyncSession, thread: TextChannel, user_id: int) -> dict:
    member_count = await db.scalar(
        select(func.count(ThreadMember.id)).where(ThreadMember.thread_id == thread.id)
    )
    joined = await db.scalar(
        select(ThreadMember.id).where(
            ThreadMember.thread_id == thread.id,
            ThreadMember.user_id == user_id,
        )
    )
    return {
        "id": thread.id,
        "name": thread.name,
        "server_id": thread.channel_id,
        "parent_id": thread.parent_id,
        "owner_id": thread.owner_id,
        "kind": thread.kind,
        "archived_at": thread.archived_at,
        "locked": bool(thread.locked),
        "auto_archive_minutes": thread.auto_archive_minutes,
        "last_message_at": thread.last_message_at,
        "created_at": thread.created_at,
        "member_count": int(member_count or 0),
        "joined": joined is not None,
        "starter_message_id": thread.starter_message_id,
    }
