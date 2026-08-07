"""
Логика голосовых сессий (Discord-like mesh).

Сервер — только сигнализация + presence.
Медиа (аудио) идёт peer-to-peer между клиентами.
"""
from __future__ import annotations

from typing import Any, Dict, Optional
import uuid


# channel_id -> { user_id -> connection_info }
VoiceConnections = Dict[int, Dict[int, dict]]


def new_connection_id() -> str:
    return uuid.uuid4().hex


def is_active_connection(
    voice_connections: VoiceConnections,
    channel_id: int,
    user_id: int,
    connection_id: str,
) -> bool:
    """True, если connection_id всё ещё текущая сессия пользователя в канале."""
    info = voice_connections.get(channel_id, {}).get(user_id)
    if not info:
        return False
    return info.get("connection_id") == connection_id


def register_connection(
    voice_connections: VoiceConnections,
    channel_id: int,
    user_id: int,
    *,
    websocket: Any,
    username: str,
    connection_id: str,
    is_muted: bool = False,
    is_deafened: bool = False,
    is_sharing_screen: bool = False,
) -> dict:
    if channel_id not in voice_connections:
        voice_connections[channel_id] = {}
    info = {
        "websocket": websocket,
        "user_id": user_id,
        "username": username,
        "connection_id": connection_id,
        "is_muted": is_muted,
        "is_deafened": is_deafened,
        "is_sharing_screen": is_sharing_screen,
    }
    voice_connections[channel_id][user_id] = info
    return info


def pop_connection_if_current(
    voice_connections: VoiceConnections,
    channel_id: int,
    user_id: int,
    connection_id: str,
) -> Optional[dict]:
    """Удаляет сессию только если она всё ещё текущая. Иначе None."""
    channel = voice_connections.get(channel_id)
    if not channel:
        return None
    info = channel.get(user_id)
    if not info or info.get("connection_id") != connection_id:
        return None
    removed = channel.pop(user_id)
    if not channel:
        del voice_connections[channel_id]
    return removed


def find_user_channels(voice_connections: VoiceConnections, user_id: int) -> list[int]:
    return [
        channel_id
        for channel_id, users in voice_connections.items()
        if user_id in users
    ]


def should_create_offer(local_user_id: int, remote_user_id: int) -> bool:
    """
    Оба пира не шлют offer одновременно (glare).
    Меньший user_id создаёт offer — как в текущем клиенте Miscord.
    """
    return local_user_id < remote_user_id


def participant_payload(
    user_id: int,
    conn_info: dict,
    *,
    display_name: Optional[str] = None,
    avatar_url: Optional[str] = None,
) -> dict:
    return {
        "user_id": user_id,
        "username": conn_info.get("username"),
        "display_name": display_name,
        "avatar_url": avatar_url,
        "is_muted": bool(conn_info.get("is_muted")),
        "is_deafened": bool(conn_info.get("is_deafened")),
        "is_sharing_screen": bool(conn_info.get("is_sharing_screen")),
        # Клиент сравнивает epoch: новый connection_id = нужно пересобрать WebRTC
        "connection_id": conn_info.get("connection_id"),
    }
