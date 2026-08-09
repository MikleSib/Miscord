"""Полнотекстовый поиск по сообщениям сервера.

Ключевое требование безопасности: искать можно только в тех каналах, где у
пользователя есть VIEW_CHANNEL и READ_MESSAGE_HISTORY. Иначе поиск превращается
в способ прочитать закрытые каналы.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional, Sequence

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.permissions import (
    Permission,
    get_member_permissions,
    has_permission,
)
from app.models import Attachment, Message, TextChannel
from app.services.channel_permissions import (
    can_view_channel,
    get_effective_channel_permissions,
)

SEARCH_PAGE_SIZE = 25
MAX_SEARCH_RESULTS = 500
MAX_QUERY_LENGTH = 200
# Русская конфигурация покрывает и латиницу: стоп-слова разные, токенизация общая.
FTS_CONFIG = "russian"

HasFilter = Literal["link", "file", "image"]


async def list_searchable_channel_ids(
    db: AsyncSession,
    server_id: int,
    user_id: int,
    *,
    owner_id: Optional[int] = None,
) -> list[int]:
    """Каналы, в которых пользователь вправе читать историю."""
    result = await db.execute(
        select(TextChannel).where(
            TextChannel.channel_id == server_id,
            TextChannel.is_hidden.is_(False),
        )
    )
    channels = list(result.scalars().all())
    if not channels:
        return []

    base = await get_member_permissions(db, server_id, user_id, owner_id=owner_id)
    is_admin = user_id == owner_id or has_permission(base, Permission.ADMINISTRATOR)

    allowed: list[int] = []
    for channel in channels:
        if is_admin:
            allowed.append(channel.id)
            continue
        if not await can_view_channel(
            db, server_id, user_id, "text", channel.id, owner_id=owner_id
        ):
            continue
        effective = await get_effective_channel_permissions(
            db, server_id, user_id, "text", channel.id, owner_id=owner_id
        )
        if has_permission(effective, Permission.READ_MESSAGE_HISTORY):
            allowed.append(channel.id)
    return allowed


def normalize_query(raw: str) -> str:
    return raw.strip()[:MAX_QUERY_LENGTH]


def _apply_filters(
    stmt: Select,
    *,
    channel_ids: Sequence[int],
    query: str,
    author_id: Optional[int],
    has_filter: Optional[HasFilter],
    before: Optional[datetime],
    after: Optional[datetime],
) -> Select:
    # bindparam через SQLAlchemy: пользовательская строка никогда не попадает в SQL текстом
    tsquery = func.websearch_to_tsquery(FTS_CONFIG, query)
    stmt = stmt.where(
        Message.text_channel_id.in_(channel_ids),
        Message.is_deleted.is_(False),
        Message.content.isnot(None),
        func.to_tsvector(FTS_CONFIG, func.coalesce(Message.content, "")).op("@@")(tsquery),
    )

    if author_id is not None:
        stmt = stmt.where(Message.author_id == author_id)
    if before is not None:
        stmt = stmt.where(Message.timestamp < before)
    if after is not None:
        stmt = stmt.where(Message.timestamp > after)

    if has_filter == "link":
        stmt = stmt.where(Message.content.ilike("%http%"))
    elif has_filter in ("file", "image"):
        attachment_condition = Attachment.message_id == Message.id
        if has_filter == "image":
            attachment_condition = and_(
                attachment_condition,
                or_(
                    Attachment.content_type.ilike("image/%"),
                    Attachment.content_type.ilike("video/%"),
                ),
            )
        stmt = stmt.where(select(Attachment.id).where(attachment_condition).exists())

    return stmt


async def search_messages(
    db: AsyncSession,
    *,
    channel_ids: Sequence[int],
    query: str,
    author_id: Optional[int] = None,
    has_filter: Optional[HasFilter] = None,
    before: Optional[datetime] = None,
    after: Optional[datetime] = None,
    offset: int = 0,
    limit: int = SEARCH_PAGE_SIZE,
) -> tuple[list[Message], int]:
    """Возвращает страницу результатов и общее число совпадений."""
    if not channel_ids or not query:
        return [], 0

    filters = dict(
        channel_ids=channel_ids,
        query=query,
        author_id=author_id,
        has_filter=has_filter,
        before=before,
        after=after,
    )

    count_stmt = _apply_filters(select(func.count()).select_from(Message), **filters)
    total = int((await db.execute(count_stmt)).scalar() or 0)
    if total == 0:
        return [], 0

    page_stmt = _apply_filters(select(Message), **filters)
    page_stmt = (
        page_stmt.options(
            selectinload(Message.author),
            selectinload(Message.attachments),
        )
        .order_by(Message.timestamp.desc(), Message.id.desc())
        .offset(min(offset, MAX_SEARCH_RESULTS))
        .limit(limit)
    )

    result = await db.execute(page_stmt)
    return list(result.scalars().all()), min(total, MAX_SEARCH_RESULTS)
