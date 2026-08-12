from __future__ import annotations

import json
import secrets
from typing import Any, Optional

from fastapi import WebSocket
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, VoiceChannel, VoiceChannelUser
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.channel_access import get_voice_channel_capabilities, user_can_access_voice_channel
from app.services.media_ticket import create_media_ticket, media_ws_url
from app.services.miscord_serializers import miscord_voice_state
from app.services.voice_presence import voice_presence


def new_connection_id() -> str:
    return secrets.token_urlsafe(24)


def register_connection(
    connections: dict,
    channel_id: int,
    user_id: int,
    connection_id: str,
    websocket: WebSocket,
    **state: Any,
) -> dict[str, Any]:
    payload = {"connection_id": connection_id, "websocket": websocket, **state}
    connections.setdefault(channel_id, {})[user_id] = payload
    return payload


def is_active_connection(
    connections: dict, channel_id: int, user_id: int, connection_id: str,
) -> bool:
    current = connections.get(channel_id, {}).get(user_id)
    return bool(current and current.get("connection_id") == connection_id)


def pop_connection_if_current(
    connections: dict, channel_id: int, user_id: int, connection_id: str,
) -> Optional[dict[str, Any]]:
    if not is_active_connection(connections, channel_id, user_id, connection_id):
        return None
    removed = connections[channel_id].pop(user_id)
    if not connections[channel_id]:
        connections.pop(channel_id, None)
    return removed


def normalize_channel_id(message: dict[str, Any]) -> Optional[int]:
    value = message.get("voice_channel_id") or message.get("channel_id") or message.get("channelId")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


async def broadcast_voice(manager: Any, channel_id: int, message: dict[str, Any]) -> None:
    await manager.send_to_voice_channel(channel_id, message)


async def dispatch_voice_state(
    db: AsyncSession,
    *,
    guild_id: int,
    channel_id: Optional[int],
    user_id: int,
    session_id: str,
    self_mute: bool = False,
    self_deaf: bool = False,
) -> None:
    await bot_event_dispatcher.dispatch_voice_state_update(
        db,
        guild_id,
        miscord_voice_state(
            guild_id=guild_id,
            channel_id=channel_id,
            user_id=user_id,
            session_id=session_id,
            self_mute=self_mute,
            self_deaf=self_deaf,
        ),
    )


def public_participant(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "user_id": int(payload["user_id"]),
        "username": payload.get("username"),
        "display_name": payload.get("display_name"),
        "avatar_url": payload.get("avatar_url"),
        "is_muted": bool(payload.get("is_muted")),
        "is_deafened": bool(payload.get("is_deafened")),
        "server_muted": bool(payload.get("server_muted")),
        "server_deafened": bool(payload.get("server_deafened")),
        "is_sharing_screen": bool(payload.get("is_sharing_screen")),
        "is_bot": bool(payload.get("is_bot")),
        "connection_id": payload.get("session_id"),
    }


async def join_voice(
    *,
    user: User,
    message: dict[str, Any],
    db: AsyncSession,
    websocket: WebSocket,
    manager: Any,
    local_connections: dict[int, dict[int, dict]],
    request_id: Optional[str],
) -> tuple[Optional[int], Optional[str]]:
    channel_id = normalize_channel_id(message)
    if not channel_id:
        await websocket.send_text(json.dumps({"type": "error", "code": "invalid_voice_channel"}))
        return None, None

    channel = await db.get(VoiceChannel, channel_id)
    if channel is None:
        await websocket.send_text(json.dumps({"type": "error", "code": "voice_channel_not_found"}))
        return None, None
    permissions, can_speak, can_stream = await get_voice_channel_capabilities(db, user, channel)
    if not await user_can_access_voice_channel(db, user, channel):
        await websocket.send_text(json.dumps({"type": "error", "code": "voice_channel_forbidden"}))
        return None, None

    existing = await voice_presence.get_for_user(user.id)
    if existing:
        await leave_voice(
            user=user,
            channel_id=int(existing["channel_id"]),
            session_id=str(existing["session_id"]),
            db=db,
            manager=manager,
            local_connections=local_connections,
            silent=int(existing["channel_id"]) == channel_id,
        )

    active_count = await db.scalar(
        select(func.count(VoiceChannelUser.id)).where(VoiceChannelUser.voice_channel_id == channel_id)
    )
    if int(channel.max_users or 0) > 0 and int(active_count or 0) >= int(channel.max_users):
        await websocket.send_text(json.dumps({"type": "error", "code": "voice_channel_full"}))
        return None, None

    session_id = new_connection_id()
    room_epoch = await voice_presence.room_epoch(channel_id)
    is_muted = bool(message.get("is_muted", False))
    is_deafened = bool(message.get("is_deafened", False))
    await db.execute(delete(VoiceChannelUser).where(VoiceChannelUser.user_id == user.id))
    db.add(VoiceChannelUser(
        voice_channel_id=channel_id,
        user_id=user.id,
        is_muted=is_muted,
        is_deafened=is_deafened,
    ))
    await db.commit()

    old = local_connections.get(channel_id, {}).get(user.id)
    if old and old.get("websocket") is not websocket:
        try:
            await old["websocket"].close(code=4000, reason="Voice session replaced")
        except Exception:
            pass
    register_connection(
        local_connections,
        channel_id,
        user.id,
        websocket=websocket,
        username=user.display_name or user.username,
        connection_id=session_id,
        is_muted=is_muted,
        is_deafened=is_deafened,
        gateway="unified-v1",
    )
    await manager.register_voice(websocket, user.id, channel_id)

    presence = {
        "protocol_version": 1,
        "session_id": session_id,
        "room_epoch": room_epoch,
        "channel_id": channel_id,
        "guild_id": int(channel.channel_id),
        "user_id": user.id,
        "username": user.display_name or user.username,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "is_muted": is_muted,
        "is_deafened": is_deafened,
        "self_muted": is_muted,
        "self_deafened": is_deafened,
        "server_muted": False,
        "server_deafened": False,
        "is_sharing_screen": False,
        "is_bot": False,
        "permissions": permissions,
        "can_speak": can_speak,
        "can_stream": can_stream,
    }
    await voice_presence.register(presence)
    participants = [
        public_participant(item)
        for item in await voice_presence.participants(channel_id)
        if int(item["user_id"]) != user.id
    ]
    ticket, _ = create_media_ticket(
        user_id=user.id,
        channel_id=channel_id,
        session_id=session_id,
        room_epoch=room_epoch,
        username=user.display_name or user.username,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        self_mute=is_muted,
        self_deaf=is_deafened,
        server_mute=False,
        server_deaf=False,
        can_speak=can_speak,
        can_stream=can_stream,
    )
    await websocket.send_text(json.dumps({
        "type": "voice_joined",
        "request_id": request_id,
        "protocol_version": 1,
        "channel_id": channel_id,
        "session_id": session_id,
        "room_epoch": room_epoch,
        "participants": participants,
        "self": {"user_id": user.id, "is_muted": is_muted, "is_deafened": is_deafened},
        "transport": {"mode": "sfu", "ws_url": media_ws_url(), "ticket": ticket},
    }))
    await broadcast_voice(manager, channel_id, {
        "type": "user_joined_voice",
        **public_participant(presence),
        "voice_channel_id": channel_id,
    })
    await manager.broadcast({
        "type": "voice_channel_join",
        "user_id": user.id,
        "username": user.display_name or user.username,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "voice_channel_id": channel_id,
        "voice_channel_name": channel.name,
        "request_id": request_id,
    })
    await dispatch_voice_state(
        db,
        guild_id=int(channel.channel_id),
        channel_id=channel_id,
        user_id=user.id,
        session_id=session_id,
        self_mute=is_muted,
        self_deaf=is_deafened,
    )
    return channel_id, session_id


async def leave_voice(
    *,
    user: User,
    channel_id: int,
    session_id: Optional[str],
    db: AsyncSession,
    manager: Any,
    local_connections: dict[int, dict[int, dict]],
    silent: bool = False,
) -> None:
    if session_id and not is_active_connection(local_connections, channel_id, user.id, session_id):
        redis_session = await voice_presence.get_for_user(user.id)
        if not redis_session or redis_session.get("session_id") != session_id:
            return
    removed = (
        pop_connection_if_current(local_connections, channel_id, user.id, session_id)
        if session_id
        else local_connections.get(channel_id, {}).pop(user.id, None)
    )
    if channel_id in local_connections and not local_connections[channel_id]:
        local_connections.pop(channel_id, None)
    resolved_session = str((removed or {}).get("connection_id") or session_id or "")
    if removed and removed.get("websocket"):
        await manager.unregister_voice(removed["websocket"], user.id, channel_id)
    if resolved_session:
        await voice_presence.remove(resolved_session)
    await db.execute(delete(VoiceChannelUser).where(
        and_(VoiceChannelUser.voice_channel_id == channel_id, VoiceChannelUser.user_id == user.id)
    ))
    channel = await db.get(VoiceChannel, channel_id)
    await db.commit()
    if channel:
        await dispatch_voice_state(
            db,
            guild_id=int(channel.channel_id),
            channel_id=None,
            user_id=user.id,
            session_id=resolved_session,
        )
    if not silent:
        await broadcast_voice(manager, channel_id, {
            "type": "user_left_voice",
            "user_id": user.id,
            "voice_channel_id": channel_id,
        })
        await manager.broadcast({
            "type": "voice_channel_leave",
            "user_id": user.id,
            "username": user.display_name or user.username,
            "voice_channel_id": channel_id,
        })


async def update_voice_state(
    *,
    user: User,
    channel_id: Optional[int],
    session_id: Optional[str],
    field: str,
    value: bool,
    db: AsyncSession,
    manager: Any,
    local_connections: dict[int, dict[int, dict]],
) -> None:
    if not channel_id or field not in {"is_muted", "is_deafened", "is_sharing_screen"}:
        return
    connection = local_connections.get(channel_id, {}).get(user.id)
    if connection:
        connection[field] = value
    effective_value = value
    presence = await voice_presence.get_for_user(user.id) if session_id else None
    if field == "is_muted" and presence:
        effective_value = value or bool(presence.get("server_muted", False))
        await voice_presence.update(session_id, self_muted=value, is_muted=effective_value)
    elif field == "is_deafened" and presence:
        effective_value = value or bool(presence.get("server_deafened", False))
        await voice_presence.update(session_id, self_deafened=value, is_deafened=effective_value)
    elif field == "is_sharing_screen" and value and presence and not bool(presence.get("can_stream")):
        return
    elif session_id:
        await voice_presence.update(session_id, **{field: value})
    if field in {"is_muted", "is_deafened"}:
        row = await db.scalar(select(VoiceChannelUser).where(
            and_(VoiceChannelUser.voice_channel_id == channel_id, VoiceChannelUser.user_id == user.id)
        ))
        if row:
            setattr(row, field, effective_value)
            await db.commit()
    event = {
        "is_muted": "user_muted",
        "is_deafened": "user_deafened",
        "is_sharing_screen": "screen_share_started" if value else "screen_share_stopped",
    }[field]
    payload: dict[str, Any] = {"type": event, "user_id": user.id, field: effective_value}
    if presence and field == "is_muted":
        payload["server_muted"] = bool(presence.get("server_muted", False))
    if presence and field == "is_deafened":
        payload["server_deafened"] = bool(presence.get("server_deafened", False))
    if field == "is_sharing_screen":
        payload["username"] = user.display_name or user.username
        payload["voice_channel_id"] = channel_id
    await broadcast_voice(manager, channel_id, payload)
    # Sidebar / notifications WS слушают глобальный broadcast, не voice:*
    if field == "is_sharing_screen":
        await manager.broadcast(payload)


async def notify_screen_share_viewer_joined(
    *, user: User, channel_id: Optional[int], streamer_id: int, manager: Any,
) -> bool:
    if not channel_id or streamer_id == user.id:
        return False
    streamer = await voice_presence.get_for_user(streamer_id)
    if not streamer or int(streamer.get("channel_id", 0)) != channel_id:
        return False
    if not bool(streamer.get("is_sharing_screen")):
        return False
    await manager.send_personal_message({
        "type": "screen_share_viewer_joined",
        "streamer_id": streamer_id,
        "viewer_id": user.id,
        "viewer_username": user.display_name or user.username,
    }, streamer_id)
    return True


async def refresh_ticket(
    *,
    user: User,
    channel_id: Optional[int],
    session_id: Optional[str],
    websocket: WebSocket,
    request_id: Optional[str],
    db: AsyncSession,
) -> None:
    if not channel_id or not session_id:
        return
    presence = await voice_presence.get_for_user(user.id)
    if not presence or presence.get("session_id") != session_id:
        return
    channel = await db.get(VoiceChannel, channel_id)
    if channel is None:
        return
    permissions, can_speak, can_stream = await get_voice_channel_capabilities(db, user, channel)
    if not permissions:
        return
    await voice_presence.update(
        session_id, permissions=permissions, can_speak=can_speak, can_stream=can_stream,
    )
    ticket, _ = create_media_ticket(
        user_id=user.id,
        channel_id=channel_id,
        session_id=session_id,
        room_epoch=str(presence["room_epoch"]),
        username=user.display_name or user.username,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        self_mute=bool(presence.get("self_muted", presence.get("is_muted", False))),
        self_deaf=bool(presence.get("self_deafened", presence.get("is_deafened", False))),
        server_mute=bool(presence.get("server_muted", False)),
        server_deaf=bool(presence.get("server_deafened", False)),
        can_speak=can_speak,
        can_stream=can_stream,
    )
    await websocket.send_text(json.dumps({
        "type": "voice_media_ticket_refresh",
        "request_id": request_id,
        "ticket": ticket,
        "ws_url": media_ws_url(),
    }))
