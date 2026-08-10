from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, delete, or_, update
from sqlalchemy.orm import selectinload
from typing import List, Optional
from app.db.database import get_db
from app.models import (
    Channel, ChannelCategory, ChannelMember, TextChannel, VoiceChannel, User, ChannelType,
    VoiceChannelUser, Message, Reaction, Role, MemberRole, ServerBan, Invite, AuditLog, Attachment,
    ChannelPermissionOverwrite, ChannelKind, Poll,
)
from app.schemas.channel import (
    ChannelCreate, Channel as ChannelSchema, ChannelUpdate,
    TextChannelCreate, TextChannel as TextChannelSchema,
    VoiceChannelCreate, VoiceChannel as VoiceChannelSchema,
    TextChannelUpdate, VoiceChannelUpdate
)
from app.schemas.user import User as UserResponse
from app.core.dependencies import get_current_active_user, get_current_user
from app.core.permissions import (
    DEFAULT_PERMISSIONS, Permission, miscord_permissions_to_legacy, ensure_default_role, get_default_role,
    get_member_permissions, has_permission, is_member as is_server_member,
    require_membership, require_permission
)
from app.websocket.connection_manager import manager
from datetime import timezone, datetime, timedelta
from app.schemas.message import MessageUpdate
from app.services.user_activity_service import user_activity_service
from app.services.audit_service import AuditAction, log_audit
from app.services.notifications import create_notification
from app.services.message_serializer import serialize_attachment
from app.services.server_membership import add_member_and_notify
from app.services.text_channel_visibility import (
    get_text_channel_any,
    get_visible_text_channel,
)
from app.services.channel_permissions import (
    filter_viewable_text_channels,
    filter_viewable_voice_channels,
)
from app.services.channel_access import (
    require_text_channel_access,
    require_voice_channel_access,
    user_can_manage_messages,
)
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.miscord_serializers import miscord_channel
from app.services.voice_presence import voice_presence
from app.core.config import settings
from app.services.polls import serialize_poll
import logging
import secrets as secrets_mod

logger = logging.getLogger(__name__)



async def _validated_category_id(
    db: AsyncSession, server_id: int, category_id: Optional[int]
) -> Optional[int]:
    """Категория обязана принадлежать тому же серверу."""
    if category_id is None:
        return None
    result = await db.execute(
        select(ChannelCategory.id).where(
            ChannelCategory.id == category_id,
            ChannelCategory.server_id == server_id,
        )
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Категория не принадлежит этому серверу",
        )
    return category_id


async def _delete_server_text_messages(db: AsyncSession, server_id: int) -> None:
    """Удаляет все сообщения текстовых каналов сервера."""
    text_channel_ids_stmt = select(TextChannel.id).where(TextChannel.channel_id == server_id)
    text_channel_ids_result = await db.execute(text_channel_ids_stmt)
    text_channel_ids = [row[0] for row in text_channel_ids_result.fetchall()]

    if not text_channel_ids:
        return

    messages_stmt = select(Message.id).where(Message.text_channel_id.in_(text_channel_ids))
    messages_result = await db.execute(messages_stmt)
    message_ids = [row[0] for row in messages_result.fetchall()]

    if message_ids:
        await db.execute(delete(Attachment).where(Attachment.message_id.in_(message_ids)))
        await db.execute(delete(Reaction).where(Reaction.message_id.in_(message_ids)))

    await db.execute(
        update(Message)
        .where(Message.text_channel_id.in_(text_channel_ids))
        .values(reply_to_id=None)
    )
    await db.execute(delete(Message).where(Message.text_channel_id.in_(text_channel_ids)))


def _serialize_server_member(user: User) -> dict:
    """Формат участника сервера — без email (PII)."""
    return {
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "is_active": user.is_active,
        "is_online": user.is_online,
        "avatar_url": user.avatar_url,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "updated_at": user.updated_at.isoformat() if user.updated_at else None,
    }


async def _get_server_member_ids(db: AsyncSession, server_id: int) -> list[int]:
    result = await db.execute(
        select(ChannelMember.user_id).where(ChannelMember.channel_id == server_id)
    )
    return [row[0] for row in result.fetchall()]


async def _notify_server_member_joined(
    db: AsyncSession,
    server_id: int,
    joined_user: User,
    *,
    exclude_user_id: int | None = None,
) -> None:
    """Уведомляет всех участников сервера о новом члене (через /ws/notifications)."""
    member_ids = await _get_server_member_ids(db, server_id)
    message = {
        "type": "user_joined_channel",
        "channel_id": server_id,
        "user_id": joined_user.id,
        "username": joined_user.display_name or joined_user.username,
        "display_name": joined_user.display_name,
        "avatar_url": joined_user.avatar_url,
        "user": _serialize_server_member(joined_user),
    }
    for member_id in member_ids:
        if exclude_user_id is not None and member_id == exclude_user_id:
            continue
        await manager.send_to_user(member_id, message)


async def _notify_server_member_left(
    db: AsyncSession,
    server_id: int,
    left_user_id: int,
    *,
    exclude_user_id: int | None = None,
) -> None:
    member_ids = await _get_server_member_ids(db, server_id)
    message = {
        "type": "user_left_channel",
        "channel_id": server_id,
        "user_id": left_user_id,
    }
    for member_id in member_ids:
        if exclude_user_id is not None and member_id == exclude_user_id:
            continue
        await manager.send_to_user(member_id, message)

__all__ = [name for name in globals() if not name.startswith('__')]
