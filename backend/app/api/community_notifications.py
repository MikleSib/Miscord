from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.db.database import get_db
from app.models import User, UserNotification
from app.services.notifications import NOTIFICATION_TYPES, serialize_notification
from app.services.realtime_events import enqueue_realtime_event

router = APIRouter()


def _require_feature() -> None:
    if not settings.INBOX_ENABLED:
        raise HTTPException(status_code=404, detail="Входящие уведомления пока недоступны")


@router.get("/users/@me/notifications")
async def list_notifications(
    type: str | None = Query(default=None),
    before: int | None = Query(default=None),
    limit: int = Query(default=40, ge=1, le=100),
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    if type is not None and type not in NOTIFICATION_TYPES:
        raise HTTPException(status_code=400, detail="Неизвестный тип уведомления")
    statement = select(UserNotification).where(UserNotification.user_id == user.id)
    if type == "reply":
        statement = statement.where(UserNotification.type.in_(("reply", "thread_reply")))
    elif type:
        statement = statement.where(UserNotification.type == type)
    if before:
        statement = statement.where(UserNotification.id < before)
    rows = list((await db.execute(statement.order_by(UserNotification.id.desc()).limit(limit + 1))).scalars().all())
    has_more = len(rows) > limit
    items = rows[:limit]
    return {
        "items": [serialize_notification(item) for item in items],
        "next_cursor": items[-1].id if has_more and items else None,
    }


@router.get("/users/@me/notifications/unread-count")
async def unread_count(
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    count = await db.scalar(select(func.count(UserNotification.id)).where(UserNotification.user_id == user.id, UserNotification.read_at.is_(None)))
    return {"unread_count": int(count or 0)}


@router.patch("/users/@me/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    item = await db.scalar(select(UserNotification).where(UserNotification.id == notification_id, UserNotification.user_id == user.id))
    if not item:
        raise HTTPException(status_code=404, detail="Уведомление не найдено")
    if item.read_at is None:
        item.read_at = datetime.now(timezone.utc)
        enqueue_realtime_event(db, event_type="NOTIFICATION_UPDATE", data=serialize_notification(item), topic="user", target_id=user.id)
        await db.commit()
    return serialize_notification(item)


@router.post("/users/@me/notifications/read-all", status_code=204)
async def mark_all_read(
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    now = datetime.now(timezone.utc)
    await db.execute(update(UserNotification).where(UserNotification.user_id == user.id, UserNotification.read_at.is_(None)).values(read_at=now))
    enqueue_realtime_event(db, event_type="NOTIFICATION_READ_ALL", data={"read_at": now}, topic="user", target_id=user.id)
    await db.commit()


@router.delete("/users/@me/notifications/{notification_id}", status_code=204)
async def delete_notification(
    notification_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    deleted = await db.scalar(delete(UserNotification).where(UserNotification.id == notification_id, UserNotification.user_id == user.id).returning(UserNotification.id))
    if deleted is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Уведомление не найдено")
    enqueue_realtime_event(db, event_type="NOTIFICATION_DELETE", data={"id": notification_id}, topic="user", target_id=user.id)
    await db.commit()
