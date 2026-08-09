"""Закреплённые сообщения текстового канала."""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.permissions import (
    Permission,
    get_member_permissions,
    has_permission,
)
from app.models import Channel, Message, TextChannel, User
from app.services.channel_permissions import get_effective_channel_permissions

MAX_PINNED_MESSAGES = 50


async def user_can_pin_messages(
    db: AsyncSession,
    user: User,
    text_channel: TextChannel,
) -> bool:
    """PIN_MESSAGES или MANAGE_MESSAGES — обязательно с учётом overwrites канала."""
    server_result = await db.execute(
        select(Channel).where(Channel.id == text_channel.channel_id)
    )
    server = server_result.scalar_one_or_none()
    if not server:
        return False
    if user.id == server.owner_id:
        return True

    base = await get_member_permissions(db, server.id, user.id, owner_id=server.owner_id)
    if has_permission(base, Permission.ADMINISTRATOR):
        return True

    effective = await get_effective_channel_permissions(
        db,
        server.id,
        user.id,
        "text",
        text_channel.id,
        owner_id=server.owner_id,
    )
    return has_permission(effective, Permission.PIN_MESSAGES) or has_permission(
        effective, Permission.MANAGE_MESSAGES
    )


async def require_pin_permission(
    db: AsyncSession,
    user: User,
    text_channel: TextChannel,
) -> None:
    if not await user_can_pin_messages(db, user, text_channel):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав для закрепления сообщений",
        )


async def get_message_in_channel(
    db: AsyncSession,
    message_id: int,
    text_channel_id: int,
) -> Message:
    """Сообщение строго из указанного канала — иначе можно закрепить чужое."""
    result = await db.execute(
        select(Message)
        .where(
            Message.id == message_id,
            Message.text_channel_id == text_channel_id,
            Message.is_deleted.is_(False),
        )
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сообщение не найдено в этом канале",
        )
    return message


async def count_pinned(db: AsyncSession, text_channel_id: int) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(Message)
        .where(
            Message.text_channel_id == text_channel_id,
            Message.pinned.is_(True),
            Message.is_deleted.is_(False),
        )
    )
    return int(result.scalar() or 0)


async def list_pinned(db: AsyncSession, text_channel_id: int) -> list[Message]:
    result = await db.execute(
        select(Message)
        .where(
            Message.text_channel_id == text_channel_id,
            Message.pinned.is_(True),
            Message.is_deleted.is_(False),
        )
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
        )
        .order_by(Message.pinned_at.desc().nullslast(), Message.id.desc())
        .limit(MAX_PINNED_MESSAGES)
    )
    return list(result.scalars().all())


async def set_pinned(
    db: AsyncSession,
    message: Message,
    user: User,
    pinned: bool,
) -> bool:
    """Возвращает True, если состояние изменилось."""
    if bool(message.pinned) == pinned:
        return False

    if pinned:
        current = await count_pinned(db, message.text_channel_id)
        if current >= MAX_PINNED_MESSAGES:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"В канале уже {MAX_PINNED_MESSAGES} закреплённых сообщений",
            )

    message.pinned = pinned
    message.pinned_at = datetime.utcnow() if pinned else None
    message.pinned_by_id = user.id if pinned else None
    await db.commit()
    return True
