"""Authoritative voice-member moderation routes for Miscord Voice v1."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_active_user
from app.core.permissions import Permission, has_permission, is_member, require_hierarchy
from app.db.database import get_db
from app.models import User, VoiceChannel, VoiceChannelUser
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.channel_permissions import get_effective_channel_permissions
from app.services.miscord_serializers import miscord_voice_state
from app.services.voice_presence import voice_presence
from app.websocket.connection_manager import manager
from app.websocket.group_voice import broadcast_voice, public_participant

router = APIRouter()


class VoiceMemberModeration(BaseModel):
    server_muted: Optional[bool] = None
    server_deafened: Optional[bool] = None


class VoiceMemberMove(BaseModel):
    target_channel_id: int


async def _active_target(
    db: AsyncSession,
    voice_channel_id: int,
    user_id: int,
) -> tuple[VoiceChannel, User, dict]:
    channel = await db.get(VoiceChannel, voice_channel_id)
    if channel is None:
        raise HTTPException(status_code=404, detail="Голосовой канал не найден")
    target = await db.get(User, user_id)
    if target is None or not await is_member(db, int(channel.channel_id), user_id):
        raise HTTPException(status_code=404, detail="Участник сервера не найден")
    presence = await voice_presence.get_for_user(user_id)
    if not presence or int(presence.get("channel_id", 0)) != voice_channel_id:
        raise HTTPException(status_code=409, detail="Участник уже не находится в этом канале")
    return channel, target, presence


async def _authorize(
    db: AsyncSession,
    channel: VoiceChannel,
    actor: User,
    target_user_id: int,
    permission: Permission,
) -> None:
    server_id = int(channel.channel_id)
    if actor.id == target_user_id:
        raise HTTPException(status_code=400, detail="Серверная модерация самого себя недоступна")
    permissions = await get_effective_channel_permissions(
        db, server_id, actor.id, "voice", channel.id,
    )
    if not has_permission(permissions, permission):
        raise HTTPException(status_code=403, detail="Недостаточно прав для этого действия")
    await require_hierarchy(db, server_id, actor, target_user_id)


def _effective_state(presence: dict) -> tuple[bool, bool]:
    self_muted = bool(presence.get("self_muted", presence.get("is_muted", False)))
    self_deafened = bool(presence.get("self_deafened", presence.get("is_deafened", False)))
    return (
        self_muted or bool(presence.get("server_muted", False)),
        self_deafened or bool(presence.get("server_deafened", False)),
    )


def _can_connect(permissions: int) -> bool:
    return (
        has_permission(permissions, Permission.VIEW_CHANNEL)
        and has_permission(permissions, Permission.CONNECT)
    )


async def _publish_media_command(session_id: str, **fields: object) -> None:
    client = await voice_presence.client()
    await client.publish(
        "voice:v1:human:moderate",
        json.dumps({"session_id": session_id, **fields}),
    )


async def _dispatch_state(
    db: AsyncSession,
    channel: VoiceChannel,
    target: User,
    presence: dict,
) -> None:
    await bot_event_dispatcher.dispatch_voice_state_update(
        db,
        int(channel.channel_id),
        miscord_voice_state(
            guild_id=int(channel.channel_id),
            channel_id=channel.id,
            user_id=target.id,
            session_id=str(presence["session_id"]),
            self_mute=bool(presence.get("self_muted", False)),
            self_deaf=bool(presence.get("self_deafened", False)),
            mute=bool(presence.get("server_muted", False)),
            deaf=bool(presence.get("server_deafened", False)),
        ),
    )


@router.get("/voice/{voice_channel_id}/permissions/@me")
async def get_my_voice_permissions(
    voice_channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await db.get(VoiceChannel, voice_channel_id)
    if channel is None or not await is_member(db, int(channel.channel_id), current_user.id):
        raise HTTPException(status_code=404, detail="Голосовой канал не найден")
    permissions = await get_effective_channel_permissions(
        db, int(channel.channel_id), current_user.id, "voice", channel.id,
    )
    if not has_permission(permissions, Permission.VIEW_CHANNEL):
        raise HTTPException(status_code=404, detail="Голосовой канал не найден")
    return {"permissions": permissions}


@router.patch("/voice/{voice_channel_id}/members/{user_id}")
async def moderate_voice_member(
    voice_channel_id: int,
    user_id: int,
    payload: VoiceMemberModeration,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.server_muted is None and payload.server_deafened is None:
        raise HTTPException(status_code=400, detail="Не указано изменение голосового состояния")
    channel, target, presence = await _active_target(db, voice_channel_id, user_id)
    if payload.server_muted is not None:
        await _authorize(db, channel, current_user, user_id, Permission.MUTE_MEMBERS)
        presence["server_muted"] = payload.server_muted
    if payload.server_deafened is not None:
        await _authorize(db, channel, current_user, user_id, Permission.DEAFEN_MEMBERS)
        presence["server_deafened"] = payload.server_deafened

    effective_muted, effective_deafened = _effective_state(presence)
    presence["is_muted"] = effective_muted
    presence["is_deafened"] = effective_deafened
    await voice_presence.register(presence)
    row = await db.scalar(select(VoiceChannelUser).where(
        VoiceChannelUser.voice_channel_id == voice_channel_id,
        VoiceChannelUser.user_id == user_id,
    ))
    if row:
        row.is_muted = effective_muted
        row.is_deafened = effective_deafened
        await db.commit()

    media_fields = {}
    if payload.server_muted is not None:
        media_fields["server_muted"] = payload.server_muted
    if payload.server_deafened is not None:
        media_fields["server_deafened"] = payload.server_deafened
    await _publish_media_command(str(presence["session_id"]), **media_fields)
    event = {
        "type": "voice_moderation_update",
        "voice_channel_id": voice_channel_id,
        "server_muted": bool(presence.get("server_muted", False)),
        "server_deafened": bool(presence.get("server_deafened", False)),
        "is_muted": effective_muted,
        "is_deafened": effective_deafened,
        "moderator_id": current_user.id,
    }
    await manager.send_personal_message(event, user_id)
    if payload.server_muted is not None:
        await broadcast_voice(manager, voice_channel_id, {
            "type": "user_muted", "user_id": user_id,
            "is_muted": effective_muted, "server_muted": payload.server_muted,
        })
    if payload.server_deafened is not None:
        await broadcast_voice(manager, voice_channel_id, {
            "type": "user_deafened", "user_id": user_id,
            "is_deafened": effective_deafened, "server_deafened": payload.server_deafened,
        })
    await _dispatch_state(db, channel, target, presence)
    return public_participant(presence)


async def _remove_voice_presence(
    db: AsyncSession,
    channel: VoiceChannel,
    target: User,
    presence: dict,
    *,
    event: dict,
) -> None:
    await _publish_media_command(str(presence["session_id"]), disconnect=True)
    await voice_presence.remove(str(presence["session_id"]))
    await db.execute(delete(VoiceChannelUser).where(and_(
        VoiceChannelUser.voice_channel_id == channel.id,
        VoiceChannelUser.user_id == target.id,
    )))
    await db.commit()
    await manager.send_personal_message(event, target.id)
    await broadcast_voice(manager, channel.id, {
        "type": "user_left_voice", "user_id": target.id, "voice_channel_id": channel.id,
    })
    await manager.broadcast({
        "type": "voice_channel_leave", "user_id": target.id,
        "username": target.display_name or target.username, "voice_channel_id": channel.id,
    })
    await bot_event_dispatcher.dispatch_voice_state_update(
        db,
        int(channel.channel_id),
        miscord_voice_state(
            guild_id=int(channel.channel_id), channel_id=None, user_id=target.id,
            session_id=str(presence["session_id"]),
        ),
    )


@router.post("/voice/{voice_channel_id}/members/{user_id}/move")
async def move_voice_member(
    voice_channel_id: int,
    user_id: int,
    payload: VoiceMemberMove,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel, target, presence = await _active_target(db, voice_channel_id, user_id)
    await _authorize(db, channel, current_user, user_id, Permission.MOVE_MEMBERS)
    target_channel = await db.get(VoiceChannel, payload.target_channel_id)
    if target_channel is None or int(target_channel.channel_id) != int(channel.channel_id):
        raise HTTPException(status_code=400, detail="Канал назначения не принадлежит этому серверу")
    if target_channel.id == channel.id:
        return {"moved": False, "channel_id": channel.id}
    target_permissions = await get_effective_channel_permissions(
        db, int(channel.channel_id), target.id, "voice", target_channel.id,
    )
    if not _can_connect(target_permissions):
        raise HTTPException(status_code=403, detail="Участник не может подключиться к каналу назначения")
    active_count = await db.scalar(select(func.count(VoiceChannelUser.id)).where(
        VoiceChannelUser.voice_channel_id == target_channel.id,
    ))
    if int(target_channel.max_users or 0) > 0 and int(active_count or 0) >= int(target_channel.max_users):
        raise HTTPException(status_code=409, detail="Канал назначения заполнен")
    await _remove_voice_presence(
        db, channel, target, presence,
        event={
            "type": "voice_moderation_move", "from_channel_id": channel.id,
            "target_channel_id": target_channel.id, "moderator_id": current_user.id,
        },
    )
    return {"moved": True, "channel_id": target_channel.id}


@router.delete("/voice/{voice_channel_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_voice_member(
    voice_channel_id: int,
    user_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel, target, presence = await _active_target(db, voice_channel_id, user_id)
    await _authorize(db, channel, current_user, user_id, Permission.MOVE_MEMBERS)
    await _remove_voice_presence(
        db, channel, target, presence,
        event={
            "type": "voice_moderation_disconnect", "voice_channel_id": channel.id,
            "moderator_id": current_user.id,
        },
    )
