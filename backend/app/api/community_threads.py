from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.core.permissions import Permission, has_permission, is_member
from app.db.database import get_db
from app.models import AuditLog, Channel, Message, TextChannel, ThreadMember, User
from app.schemas.thread import ThreadCreate, ThreadMemberResponse, ThreadResponse, ThreadUpdate
from app.services.bot_event_dispatcher import dispatcher as bot_dispatcher
from app.services.channel_permissions import get_effective_channel_permissions
from app.services.realtime_events import enqueue_realtime_event
from app.services.thread_access import (
    THREAD_KINDS,
    can_access_thread,
    require_thread_access,
    require_thread_manager,
    thread_permissions,
)
from app.services.thread_serializer import serialize_thread

router = APIRouter()


def _require_feature() -> None:
    if not settings.THREADS_ENABLED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Обсуждения пока недоступны")


def _bot_thread(thread: TextChannel) -> dict:
    return {
        "id": str(thread.id),
        "guild_id": str(thread.channel_id),
        "parent_id": str(thread.parent_id),
        "owner_id": str(thread.owner_id) if thread.owner_id else None,
        "name": thread.name,
        "type": thread.kind,
        "archived": thread.archived_at is not None,
        "locked": bool(thread.locked),
        "auto_archive_duration": thread.auto_archive_minutes,
    }


def _user_thread_event(thread: TextChannel) -> dict:
    return {
        "id": thread.id,
        "name": thread.name,
        "server_id": thread.channel_id,
        "parent_id": thread.parent_id,
        "owner_id": thread.owner_id,
        "kind": thread.kind,
        "archived_at": thread.archived_at.isoformat() if thread.archived_at else None,
        "locked": bool(thread.locked),
        "auto_archive_minutes": thread.auto_archive_minutes,
        "last_message_at": thread.last_message_at.isoformat() if thread.last_message_at else None,
        "created_at": thread.created_at.isoformat() if thread.created_at else None,
        "starter_message_id": thread.starter_message_id,
    }


async def _dispatch_bot(db: AsyncSession, thread: TextChannel, event: str) -> None:
    await bot_dispatcher.dispatch_guild_event(
        db,
        thread.channel_id,
        event,
        _bot_thread(thread),
    )


def _add_thread_audit(db: AsyncSession, thread: TextChannel, user: User, action: str, changes: dict | None = None) -> None:
    db.add(AuditLog(
        server_id=thread.channel_id,
        actor_id=user.id,
        action=action,
        target_type=thread.kind,
        target_id=thread.id,
        target_name=thread.name,
        changes=changes,
    ))


async def get_thread_response(db: AsyncSession, user: User, thread_id: int) -> dict | None:
    thread = await db.get(TextChannel, thread_id)
    if not thread or thread.kind not in THREAD_KINDS:
        return None
    if not await can_access_thread(db, thread, user):
        raise HTTPException(status_code=404, detail="Обсуждение не найдено")
    return await serialize_thread(db, thread, user.id)


async def delete_thread_resource(db: AsyncSession, user: User, thread_id: int) -> bool:
    thread = await db.get(TextChannel, thread_id)
    if not thread or thread.kind not in THREAD_KINDS:
        return False
    await require_thread_manager(db, thread, user)
    payload = _bot_thread(thread)
    server_id = thread.channel_id
    _add_thread_audit(db, thread, user, "forum_post_delete" if thread.kind == "forum_post" else "thread_delete")
    await db.delete(thread)
    enqueue_realtime_event(
        db,
        event_type="THREAD_DELETE",
        data={"id": thread_id, "server_id": server_id, "parent_id": thread.parent_id},
        topic="server",
        target_id=server_id,
    )
    await db.commit()
    await bot_dispatcher.dispatch_guild_event(db, server_id, "THREAD_DELETE", payload)
    return True


@router.post("/{channel_id}/threads", response_model=ThreadResponse, status_code=201)
async def create_thread(
    channel_id: int,
    payload: ThreadCreate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    parent = await db.get(TextChannel, channel_id)
    if not parent or parent.kind != "text" or parent.is_hidden:
        raise HTTPException(status_code=404, detail="Текстовый канал не найден")
    server = await db.get(Channel, parent.channel_id)
    if not server or (user.id != server.owner_id and not await is_member(db, server.id, user.id)):
        raise HTTPException(status_code=404, detail="Текстовый канал не найден")
    permissions = await get_effective_channel_permissions(
        db, server.id, user.id, "text", parent.id, owner_id=server.owner_id
    )
    required = Permission.CREATE_PRIVATE_THREADS if payload.kind == "private_thread" else Permission.CREATE_PUBLIC_THREADS
    if not has_permission(permissions, required):
        raise HTTPException(status_code=403, detail="Нет права создавать такое обсуждение")

    if payload.source_message_id is not None:
        source_message = await db.get(Message, payload.source_message_id)
        if not source_message or source_message.text_channel_id != parent.id:
            raise HTTPException(status_code=404, detail="Source message not found in this channel")

    now = datetime.now(timezone.utc)
    thread = TextChannel(
        name=payload.name,
        channel_id=parent.channel_id,
        category_id=parent.category_id,
        kind=payload.kind,
        parent_id=parent.id,
        owner_id=user.id,
        auto_archive_minutes=payload.auto_archive_minutes,
        last_message_at=now,
        position=0,
        starter_message_id=payload.source_message_id,
    )
    db.add(thread)
    await db.flush()
    db.add(ThreadMember(thread_id=thread.id, user_id=user.id))
    _add_thread_audit(db, thread, user, "thread_create")
    enqueue_realtime_event(
        db,
        event_type="THREAD_CREATE",
        data=_user_thread_event(thread),
        topic="server",
        target_id=server.id,
    )
    await db.commit()
    await db.refresh(thread)
    await _dispatch_bot(db, thread, "THREAD_CREATE")
    return await serialize_thread(db, thread, user.id)


@router.get("/{channel_id}/threads", response_model=list[ThreadResponse])
async def list_threads(
    channel_id: int,
    include_archived: bool = Query(False),
    limit: int = Query(50, ge=1, le=100),
    before: int | None = Query(None),
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    parent = await db.get(TextChannel, channel_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Канал не найден")
    server = await db.get(Channel, parent.channel_id)
    if not server or (user.id != server.owner_id and not await is_member(db, server.id, user.id)):
        raise HTTPException(status_code=404, detail="Канал не найден")
    statement = select(TextChannel).where(
        TextChannel.parent_id == parent.id,
        TextChannel.kind.in_(THREAD_KINDS),
        TextChannel.is_hidden.is_(False),
    )
    if not include_archived:
        statement = statement.where(TextChannel.archived_at.is_(None))
    if before is not None:
        statement = statement.where(TextChannel.id < before)
    result = await db.execute(statement.order_by(TextChannel.last_message_at.desc().nullslast(), TextChannel.id.desc()).limit(limit))
    visible = []
    for thread in result.scalars().all():
        if await can_access_thread(db, thread, user):
            visible.append(await serialize_thread(db, thread, user.id))
    return visible


@router.patch("/{thread_id}", response_model=ThreadResponse)
async def update_thread(
    thread_id: int,
    payload: ThreadUpdate,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    thread = await require_thread_access(db, user, thread_id)
    permissions = await require_thread_manager(db, thread, user)
    values = payload.model_dump(exclude_unset=True)
    if "locked" in values and not has_permission(permissions, Permission.MANAGE_THREADS):
        raise HTTPException(status_code=403, detail="Только модератор может блокировать обсуждение")
    if "name" in values:
        thread.name = values["name"]
    if "auto_archive_minutes" in values:
        thread.auto_archive_minutes = values["auto_archive_minutes"]
    if "archived" in values:
        if not values["archived"] and thread.locked and not has_permission(permissions, Permission.MANAGE_THREADS):
            raise HTTPException(status_code=403, detail="Заблокированное обсуждение открывает только модератор")
        thread.archived_at = datetime.now(timezone.utc) if values["archived"] else None
    if "locked" in values:
        thread.locked = values["locked"]
    audit_action = "forum_post_update" if thread.kind == "forum_post" else "thread_update"
    _add_thread_audit(db, thread, user, audit_action, changes=values)
    enqueue_realtime_event(
        db,
        event_type="THREAD_UPDATE",
        data=_user_thread_event(thread),
        topic="server",
        target_id=thread.channel_id,
    )
    await db.commit()
    await db.refresh(thread)
    await _dispatch_bot(db, thread, "THREAD_UPDATE")
    return await serialize_thread(db, thread, user.id)


@router.post("/{thread_id}/thread-members/@me", status_code=204)
async def join_thread(
    thread_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    thread = await require_thread_access(db, user, thread_id)
    if thread.kind == "private_thread":
        raise HTTPException(status_code=403, detail="В приватное обсуждение добавляет владелец или модератор")
    existing = await db.scalar(select(ThreadMember.id).where(ThreadMember.thread_id == thread.id, ThreadMember.user_id == user.id))
    if existing is None:
        db.add(ThreadMember(thread_id=thread.id, user_id=user.id))
        enqueue_realtime_event(db, event_type="THREAD_MEMBER_UPDATE", data={"thread_id": thread.id, "user_id": user.id, "joined": True}, topic="server", target_id=thread.channel_id)
        await db.commit()


@router.put("/{thread_id}/thread-members/{user_id}", status_code=204)
async def add_thread_member(
    thread_id: int,
    user_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    thread = await require_thread_access(db, user, thread_id)
    await require_thread_manager(db, thread, user)
    if not await is_member(db, thread.channel_id, user_id):
        raise HTTPException(status_code=404, detail="Участник сервера не найден")
    existing = await db.scalar(select(ThreadMember.id).where(ThreadMember.thread_id == thread.id, ThreadMember.user_id == user_id))
    if existing is None:
        db.add(ThreadMember(thread_id=thread.id, user_id=user_id))
        enqueue_realtime_event(db, event_type="THREAD_MEMBER_UPDATE", data={"thread_id": thread.id, "user_id": user_id, "joined": True}, topic="user", target_id=user_id)
        await db.commit()


@router.delete("/{thread_id}/thread-members/@me", status_code=204)
async def leave_thread(
    thread_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    thread = await require_thread_access(db, user, thread_id)
    await db.execute(delete(ThreadMember).where(ThreadMember.thread_id == thread.id, ThreadMember.user_id == user.id))
    enqueue_realtime_event(db, event_type="THREAD_MEMBER_UPDATE", data={"thread_id": thread.id, "user_id": user.id, "joined": False}, topic="server", target_id=thread.channel_id)
    await db.commit()


@router.get("/{thread_id}/thread-members", response_model=list[ThreadMemberResponse])
async def list_thread_members(
    thread_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    thread = await require_thread_access(db, user, thread_id)
    result = await db.execute(
        select(ThreadMember, User)
        .join(User, User.id == ThreadMember.user_id)
        .where(ThreadMember.thread_id == thread.id)
        .order_by(ThreadMember.joined_at)
    )
    return [
        {
            "user_id": member.user_id,
            "username": member_user.username,
            "display_name": member_user.display_name,
            "avatar_url": member_user.avatar_url,
            "joined_at": member.joined_at,
            "notification_level": member.notification_level,
        }
        for member, member_user in result.all()
    ]
