"""
Проверки доступа к текстовым/голосовым каналам.
Закрывает IDOR: «залогинен» ≠ «участник сервера / видит канал».
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import (
    Permission,
    get_member_permissions,
    has_permission,
    is_member,
)
from app.models.channel import Channel, TextChannel, VoiceChannel
from app.models.user import User
from app.services.channel_permissions import (
    can_view_channel,
    get_effective_channel_permissions,
)
from app.services.text_channel_visibility import get_visible_text_channel


async def _get_server(db: AsyncSession, server_id: int) -> Optional[Channel]:
    result = await db.execute(select(Channel).where(Channel.id == server_id))
    return result.scalar_one_or_none()


async def user_can_access_text_channel(
    db: AsyncSession,
    user: User,
    text_channel: TextChannel,
    *,
    need_send: bool = False,
) -> bool:
    if getattr(text_channel, "kind", "text") in {"public_thread", "private_thread", "forum_post"}:
        from app.services.thread_access import can_access_thread, thread_permissions
        from app.services.communication_safety import is_timed_out

        if not await can_access_thread(db, text_channel, user):
            return False
        if need_send:
            if await is_timed_out(db, int(text_channel.channel_id), user.id):
                return False
            if text_channel.archived_at is not None:
                return False
            permissions = await thread_permissions(db, text_channel, user)
            return has_permission(permissions, Permission.SEND_MESSAGES_IN_THREADS)
        return True
    server = await _get_server(db, text_channel.channel_id)
    if not server:
        return False
    if user.id != server.owner_id and not await is_member(db, server.id, user.id):
        return False
    if not await can_view_channel(
        db, server.id, user.id, "text", text_channel.id, owner_id=server.owner_id
    ):
        return False
    if need_send:
        from app.services.communication_safety import is_timed_out
        if user.id != server.owner_id and await is_timed_out(db, server.id, user.id):
            return False
        base = await get_member_permissions(
            db, server.id, user.id, owner_id=server.owner_id
        )
        if has_permission(base, Permission.ADMINISTRATOR):
            return True
        if user.id == server.owner_id:
            return True
        eff = await get_effective_channel_permissions(
            db,
            server.id,
            user.id,
            "text",
            text_channel.id,
            owner_id=server.owner_id,
        )
        if not has_permission(eff, Permission.SEND_MESSAGES):
            return False
    return True


async def require_text_channel_access(
    db: AsyncSession,
    user: User,
    text_channel_id: int,
    *,
    need_send: bool = False,
) -> TextChannel:
    text_channel = await get_visible_text_channel(db, text_channel_id)
    if not text_channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Текстовый канал не найден",
        )
    if not await user_can_access_text_channel(
        db, user, text_channel, need_send=need_send
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет доступа к этому каналу",
        )
    if need_send and getattr(text_channel, "kind", "text") in {"public_thread", "private_thread", "forum_post"}:
        if text_channel.archived_at is not None:
            raise HTTPException(status_code=403, detail="Обсуждение находится в архиве")
    return text_channel


async def user_can_access_voice_channel(
    db: AsyncSession,
    user: User,
    voice_channel: VoiceChannel,
) -> bool:
    server = await _get_server(db, voice_channel.channel_id)
    if not server:
        return False
    if user.id != server.owner_id and not await is_member(db, server.id, user.id):
        return False
    if user.id != server.owner_id:
        from app.services.communication_safety import is_timed_out
        if await is_timed_out(db, server.id, user.id):
            return False
    permissions = await get_effective_channel_permissions(
        db, server.id, user.id, "voice", voice_channel.id,
    )
    return (
        has_permission(permissions, Permission.VIEW_CHANNEL)
        and has_permission(permissions, Permission.CONNECT)
    )


async def get_voice_channel_capabilities(
    db: AsyncSession,
    user: User,
    voice_channel: VoiceChannel,
) -> tuple[int, bool, bool]:
    server = await _get_server(db, voice_channel.channel_id)
    if not server or (user.id != server.owner_id and not await is_member(db, server.id, user.id)):
        return 0, False, False
    permissions = await get_effective_channel_permissions(
        db, server.id, user.id, "voice", voice_channel.id,
    )
    can_connect = (
        has_permission(permissions, Permission.VIEW_CHANNEL)
        and has_permission(permissions, Permission.CONNECT)
    )
    if user.id != server.owner_id:
        from app.services.communication_safety import is_timed_out
        if await is_timed_out(db, server.id, user.id):
            return permissions, False, False
    return (
        permissions,
        can_connect and has_permission(permissions, Permission.SPEAK),
        can_connect and has_permission(permissions, Permission.STREAM),
    )


async def require_voice_channel_access(
    db: AsyncSession,
    user: User,
    voice_channel_id: int,
) -> VoiceChannel:
    result = await db.execute(
        select(VoiceChannel).where(VoiceChannel.id == voice_channel_id)
    )
    voice_channel = result.scalar_one_or_none()
    if not voice_channel:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Голосовой канал не найден",
        )
    if not await user_can_access_voice_channel(db, user, voice_channel):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нет доступа к этому голосовому каналу",
        )
    return voice_channel


async def user_can_manage_messages(
    db: AsyncSession,
    user: User,
    text_channel: TextChannel,
) -> bool:
    server = await _get_server(db, text_channel.channel_id)
    if not server:
        return False
    if user.id == server.owner_id:
        return True
    perms = await get_member_permissions(
        db, server.id, user.id, owner_id=server.owner_id
    )
    if has_permission(perms, Permission.ADMINISTRATOR):
        return True
    eff = await get_effective_channel_permissions(
        db,
        server.id,
        user.id,
        "text",
        text_channel.id,
        owner_id=server.owner_id,
    )
    return has_permission(eff, Permission.MANAGE_MESSAGES)
