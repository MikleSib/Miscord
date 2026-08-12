"""Поиск сообщений по серверу."""

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.core.permissions import is_member
from app.db.database import get_db
from app.models import Channel, TextChannel, User
from app.services.message_search import (
    MAX_QUERY_LENGTH,
    SEARCH_PAGE_SIZE,
    list_searchable_channel_ids,
    normalize_query,
    search_messages,
)
from app.services.message_serializer import serialize_channel_message
from app.services.rate_limit import rate_limit_user

router = APIRouter()

SEARCH_LIMIT_PER_MINUTE = 30


@router.get("/{server_id}/messages/search")
async def search_server_messages(
    server_id: int,
    request: Request,
    q: str = Query(default="", max_length=MAX_QUERY_LENGTH),
    channel_id: Optional[int] = Query(None),
    author_id: Optional[int] = Query(None),
    has: Optional[Literal["link", "file", "image", "video", "audio", "poll", "embed"]] = Query(None),
    pinned: Optional[bool] = Query(None),
    sort: Literal["newest", "oldest"] = Query("newest"),
    before: Optional[datetime] = Query(None),
    after: Optional[datetime] = Query(None),
    offset: int = Query(0, ge=0, le=500),
    limit: int = Query(SEARCH_PAGE_SIZE, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Полнотекстовый поиск в каналах, доступных пользователю."""
    rate_limit_user(
        current_user.id,
        "message_search",
        limit=SEARCH_LIMIT_PER_MINUTE,
        request=request,
    )

    server_result = await db.execute(select(Channel).where(Channel.id == server_id))
    server = server_result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Сервер не найден")

    if current_user.id != server.owner_id and not await is_member(db, server_id, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Вы не участник этого сервера",
        )

    query = normalize_query(q)
    if query and len(query) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Запрос слишком короткий",
        )
    if not (query or author_id or has or before or after or pinned is not None):
        raise HTTPException(status_code=400, detail="Добавьте текст или хотя бы один фильтр")

    channel_ids = await list_searchable_channel_ids(
        db, server_id, current_user.id, owner_id=server.owner_id
    )

    if channel_id is not None:
        # Сужение до одного канала не должно расширять доступ
        channel_ids = [item for item in channel_ids if item == channel_id]

    messages, total = await search_messages(
        db,
        channel_ids=channel_ids,
        query=query,
        author_id=author_id,
        has_filter=has,
        before=before,
        after=after,
        pinned=pinned,
        sort=sort,
        offset=offset,
        limit=limit,
    )

    channel_names: dict[int, str] = {}
    if messages:
        names_result = await db.execute(
            select(TextChannel.id, TextChannel.name).where(
                TextChannel.id.in_({message.text_channel_id for message in messages})
            )
        )
        channel_names = {row[0]: row[1] for row in names_result.all()}

    return {
        "query": query,
        "total": total,
        "offset": offset,
        "limit": limit,
        "messages": [
            {
                **serialize_channel_message(message, include_reply=False),
                "channel_name": channel_names.get(message.text_channel_id),
            }
            for message in messages
        ],
    }
