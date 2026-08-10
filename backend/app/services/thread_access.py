from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import Permission, get_member_permissions, has_permission, is_member
from app.models import Channel, TextChannel, ThreadMember, User
from app.services.channel_permissions import get_effective_channel_permissions

THREAD_KINDS = {"public_thread", "private_thread", "forum_post"}


async def get_thread(db: AsyncSession, thread_id: int) -> TextChannel | None:
    result = await db.execute(
        select(TextChannel).where(
            TextChannel.id == thread_id,
            TextChannel.kind.in_(THREAD_KINDS),
            TextChannel.is_hidden.is_(False),
        )
    )
    return result.scalar_one_or_none()


async def _context(db: AsyncSession, thread: TextChannel, user: User):
    server = await db.get(Channel, thread.channel_id)
    parent = await db.get(TextChannel, thread.parent_id) if thread.parent_id else None
    if not server or not parent:
        return None, None, 0
    if user.id != server.owner_id and not await is_member(db, server.id, user.id):
        return server, parent, 0
    permissions = await get_effective_channel_permissions(
        db,
        server.id,
        user.id,
        "text",
        parent.id,
        owner_id=server.owner_id,
    )
    return server, parent, permissions


async def can_access_thread(db: AsyncSession, thread: TextChannel, user: User) -> bool:
    server, _parent, permissions = await _context(db, thread, user)
    if not server or not has_permission(permissions, Permission.VIEW_CHANNEL):
        return False
    if thread.kind != "private_thread":
        return True
    if user.id in {server.owner_id, thread.owner_id}:
        return True
    if has_permission(permissions, Permission.MANAGE_THREADS):
        return True
    membership = await db.scalar(
        select(ThreadMember.id).where(
            ThreadMember.thread_id == thread.id,
            ThreadMember.user_id == user.id,
        )
    )
    return membership is not None


async def require_thread_access(
    db: AsyncSession,
    user: User,
    thread_id: int,
    *,
    need_send: bool = False,
) -> TextChannel:
    thread = await get_thread(db, thread_id)
    if not thread:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Обсуждение не найдено")
    if not await can_access_thread(db, thread, user):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Обсуждение не найдено")
    if need_send:
        if thread.archived_at is not None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Обсуждение находится в архиве")
        _server, _parent, permissions = await _context(db, thread, user)
        if thread.locked and not has_permission(permissions, Permission.MANAGE_THREADS):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Обсуждение заблокировано")
        if not has_permission(permissions, Permission.SEND_MESSAGES_IN_THREADS):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Нет права писать в обсуждении")
    return thread


async def thread_permissions(db: AsyncSession, thread: TextChannel, user: User) -> int:
    _server, _parent, permissions = await _context(db, thread, user)
    return permissions


async def require_thread_manager(db: AsyncSession, thread: TextChannel, user: User) -> int:
    server, _parent, permissions = await _context(db, thread, user)
    if not server:
        raise HTTPException(status_code=404, detail="Обсуждение не найдено")
    if user.id in {server.owner_id, thread.owner_id} or has_permission(permissions, Permission.MANAGE_THREADS):
        return permissions
    raise HTTPException(status_code=403, detail="Нет права управлять обсуждением")
