from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import and_, delete, select

from app.core.config import settings
from app.core.permissions import Permission, has_permission
from app.db.database import AsyncSessionLocal
from app.models import ChannelMember, User, VoiceChannel, VoiceChannelUser
from app.schemas.bot_protocol import VoiceGatewayOpCode
from app.services.bot_voice_sessions import BotVoiceSession, registry as bot_voice_sessions
from app.services.channel_permissions import get_effective_channel_permissions
from app.services.voice_session import (
    new_connection_id,
    participant_payload,
    register_connection,
)
from app.websocket.connection_manager import manager
from app.websocket.voice import (
    _broadcast_voice,
    _cleanup_voice_session,
    _force_leave_other_channels,
    _handle_deafen,
    _handle_join,
    _handle_mute,
    _relay_request_offer,
    _relay_signal,
    _replace_same_channel_connection,
    voice_connections,
)


VOICE_GATEWAY_VERSION = 8
VOICE_HEARTBEAT_INTERVAL_MS = 15_000
VOICE_MAX_PAYLOAD_BYTES = 64 * 1024


class _BotVoiceSocketAdapter:
    """Expose Miscord voice presence as standard voice gateway opcodes.

    SDP/ICE messages remain JSON signaling extensions because the current
    Miscord media plane is WebRTC/DTLS-SRTP rather than raw UDP.
    """

    def __init__(self, websocket: WebSocket) -> None:
        self.websocket = websocket

    async def send_json(self, payload: dict[str, Any]) -> None:
        event_type = payload.get("type")
        if event_type == "user_joined_voice":
            user_id = int(payload.get("user_id") or 0)
            await _send(
                self.websocket,
                int(VoiceGatewayOpCode.CLIENT_CONNECT),
                {
                    "user_id": str(user_id),
                    "audio_ssrc": user_id,
                    "video_ssrc": 0,
                    "rtx_ssrc": 0,
                    "connection_id": payload.get("connection_id"),
                    "username": payload.get("username"),
                    "display_name": payload.get("display_name"),
                    "avatar_url": payload.get("avatar_url"),
                },
            )
            return
        if event_type == "user_left_voice":
            await _send(
                self.websocket,
                int(VoiceGatewayOpCode.CLIENT_DISCONNECT),
                {"user_id": str(payload.get("user_id"))},
            )
            return
        if event_type == "user_speaking":
            user_id = int(payload.get("user_id") or 0)
            await _send(
                self.websocket,
                int(VoiceGatewayOpCode.SPEAKING),
                {
                    "speaking": 1 if payload.get("is_speaking") else 0,
                    "delay": 0,
                    "ssrc": user_id,
                    "user_id": str(user_id),
                },
            )
            return
        await self.websocket.send_json(payload)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        await self.websocket.close(code=code, reason=reason)


async def _close(websocket: WebSocket, code: int, reason: str = "") -> None:
    try:
        await websocket.close(code=code, reason=reason)
    except Exception:
        pass


async def _send(websocket: WebSocket, op: int, data: Any, *, seq: int | None = None) -> None:
    payload: dict[str, Any] = {"op": op, "d": data}
    if seq is not None:
        payload["seq"] = seq
    await websocket.send_json(payload)


async def _receive_json(websocket: WebSocket, timeout_seconds: float) -> dict[str, Any]:
    message = await asyncio.wait_for(websocket.receive(), timeout=timeout_seconds)
    if message.get("type") == "websocket.disconnect":
        raise WebSocketDisconnect(message.get("code", 1000))
    raw: str | bytes | None = (
        message.get("text") if message.get("text") is not None else message.get("bytes")
    )
    if raw is None:
        raise ValueError("invalid_payload")
    encoded = raw.encode("utf-8") if isinstance(raw, str) else raw
    if len(encoded) > VOICE_MAX_PAYLOAD_BYTES:
        raise ValueError("payload_too_large")
    data = json.loads(encoded.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError("invalid_payload")
    return data


async def _load_and_validate_session(
    data: dict[str, Any],
) -> BotVoiceSession | None:
    try:
        guild_id = int(data.get("server_id") or data.get("guild_id") or 0)
        user_id = int(data.get("user_id") or 0) or None
    except (TypeError, ValueError):
        return None
    session_id = str(data.get("session_id") or "")
    token = str(data.get("token") or "")
    if not session_id or not token or guild_id <= 0:
        return None
    return await bot_voice_sessions.validate(
        session_id=session_id,
        token=token,
        bot_user_id=user_id,
        guild_id=guild_id,
    )


async def _participants(db, channel_id: int, self_user_id: int) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for user_id, connection in list(voice_connections.get(channel_id, {}).items()):
        if user_id == self_user_id:
            continue
        user = await db.get(User, user_id)
        output.append(
            participant_payload(
                user_id,
                connection,
                display_name=user.display_name if user else None,
                avatar_url=user.avatar_url if user else None,
            )
        )
    return output


async def _prepare_connection(
    websocket: WebSocket,
    db,
    session: BotVoiceSession,
) -> tuple[User, VoiceChannel, str] | None:
    user = await db.get(User, session.bot_user_id)
    voice_channel = await db.get(VoiceChannel, session.channel_id)
    if user is None or voice_channel is None or int(voice_channel.channel_id) != session.guild_id:
        return None
    membership = await db.scalar(
        select(ChannelMember.id).where(
            ChannelMember.channel_id == session.guild_id,
            ChannelMember.user_id == user.id,
        )
    )
    if membership is None:
        return None
    permissions = await get_effective_channel_permissions(
        db, session.guild_id, user.id, "voice", session.channel_id
    )
    if not has_permission(permissions, Permission.CONNECT) or not has_permission(
        permissions, Permission.SPEAK
    ):
        return None

    connection_id = new_connection_id()
    await _force_leave_other_channels(user, session.channel_id, db)
    await _replace_same_channel_connection(session.channel_id, user.id)
    await db.execute(
        delete(VoiceChannelUser).where(
            and_(
                VoiceChannelUser.voice_channel_id == session.channel_id,
                VoiceChannelUser.user_id == user.id,
            )
        )
    )
    db.add(
        VoiceChannelUser(
            voice_channel_id=session.channel_id,
            user_id=user.id,
            is_muted=session.self_mute,
            is_deafened=session.self_deaf,
        )
    )
    await db.commit()

    await manager.connect(websocket, user.id, -session.channel_id)
    register_connection(
        voice_connections,
        session.channel_id,
        user.id,
        websocket=_BotVoiceSocketAdapter(websocket),
        username=user.display_name or user.username,
        connection_id=connection_id,
        is_muted=session.self_mute,
        is_deafened=session.self_deaf,
    )
    await bot_voice_sessions.attach(session.session_id, websocket)
    return user, voice_channel, connection_id


async def websocket_bot_voice_gateway_endpoint(websocket: WebSocket) -> None:
    version = websocket.query_params.get("v")
    if version is not None and version != str(VOICE_GATEWAY_VERSION):
        await websocket.accept()
        await _close(websocket, 4012, "Unsupported voice gateway version")
        return

    await websocket.accept()
    await _send(
        websocket,
        int(VoiceGatewayOpCode.HELLO),
        {
            "heartbeat_interval": VOICE_HEARTBEAT_INTERVAL_MS,
            "_trace": ["miscord-voice-gateway-v8"],
        },
    )

    session: BotVoiceSession | None = None
    user: User | None = None
    voice_channel: VoiceChannel | None = None
    connection_id = ""
    joined_presence = False
    db = AsyncSessionLocal()
    try:
        first = await _receive_json(websocket, 15)
        op = first.get("op")
        if op not in {
            int(VoiceGatewayOpCode.IDENTIFY),
            int(VoiceGatewayOpCode.RESUME),
        } or not isinstance(first.get("d"), dict):
            await _close(websocket, 4003, "Identify or Resume required")
            return
        session = await _load_and_validate_session(first["d"])
        if session is None:
            await _close(websocket, 4004, "Authentication failed")
            return
        prepared = await _prepare_connection(websocket, db, session)
        if prepared is None:
            await _close(websocket, 4006, "Voice session is no longer valid")
            return
        user, voice_channel, connection_id = prepared
        joined_presence = True

        participants = await _participants(db, session.channel_id, user.id)
        if op == int(VoiceGatewayOpCode.RESUME):
            await _send(
                websocket,
                int(VoiceGatewayOpCode.RESUMED),
                {
                    "transport": "webrtc",
                    "participants": participants,
                    "ice_servers": settings.ICE_SERVERS,
                },
            )
        else:
            await _send(
                websocket,
                int(VoiceGatewayOpCode.READY),
                {
                    "ssrc": user.id,
                    "ip": None,
                    "port": 0,
                    "modes": ["webrtc_dtls_srtp"],
                    "heartbeat_interval": VOICE_HEARTBEAT_INTERVAL_MS,
                    "transport": "webrtc",
                    "channel_id": str(session.channel_id),
                    "ice_servers": settings.ICE_SERVERS,
                    "participants": participants,
                },
            )

        for participant in participants:
            participant_user_id = int(participant["user_id"])
            await _send(
                websocket,
                int(VoiceGatewayOpCode.CLIENT_CONNECT),
                {
                    "user_id": str(participant_user_id),
                    "audio_ssrc": participant_user_id,
                    "video_ssrc": 0,
                    "rtx_ssrc": 0,
                    "connection_id": participant.get("connection_id"),
                    "username": participant.get("username"),
                    "display_name": participant.get("display_name"),
                    "avatar_url": participant.get("avatar_url"),
                },
            )

        await _handle_join(
            websocket=websocket,
            db=db,
            user=user,
            channel_id=session.channel_id,
            voice_channel=voice_channel,
            data={"is_muted": session.self_mute, "is_deafened": session.self_deaf},
            send_participants=False,
            source_application_id=session.application_id,
        )

        while True:
            payload = await _receive_json(
                websocket, (VOICE_HEARTBEAT_INTERVAL_MS / 1000) * 2
            )
            message_type = payload.get("type")
            if message_type == "offer":
                await _relay_signal(session.channel_id, user.id, payload, "offer", "offer")
                continue
            if message_type == "answer":
                await _relay_signal(session.channel_id, user.id, payload, "answer", "answer")
                continue
            if message_type == "ice_candidate":
                await _relay_signal(
                    session.channel_id, user.id, payload, "ice_candidate", "candidate"
                )
                continue
            if message_type == "request_offer":
                await _relay_request_offer(
                    session.channel_id, user.id, payload.get("target_id")
                )
                continue

            op = payload.get("op")
            data = payload.get("d") if isinstance(payload.get("d"), dict) else {}
            if op == int(VoiceGatewayOpCode.SELECT_PROTOCOL):
                if data.get("protocol") not in {None, "webrtc"}:
                    await _close(websocket, 4011, "Unsupported voice protocol")
                    return
                await _send(
                    websocket,
                    int(VoiceGatewayOpCode.SESSION_DESCRIPTION),
                    {
                        "mode": "webrtc_dtls_srtp",
                        "secret_key": [],
                        "dave_protocol_version": 0,
                    },
                )
                continue
            if op == int(VoiceGatewayOpCode.HEARTBEAT):
                await bot_voice_sessions.touch(session.session_id)
                await _send(
                    websocket,
                    int(VoiceGatewayOpCode.HEARTBEAT_ACK),
                    payload.get("d"),
                )
                continue
            if op == int(VoiceGatewayOpCode.SPEAKING):
                speaking = bool(int(data.get("speaking") or 0))
                await _broadcast_voice(
                    session.channel_id,
                    {"type": "user_speaking", "user_id": user.id, "is_speaking": speaking},
                    exclude_user_id=user.id,
                )
                continue
            if message_type == "mute":
                await _handle_mute(db, session.channel_id, user.id, payload.get("is_muted", False))
                continue
            if message_type == "deafen":
                await _handle_deafen(
                    db, session.channel_id, user.id, payload.get("is_deafened", False)
                )
                continue
            await _close(websocket, 4001, "Unknown voice opcode")
            return
    except (asyncio.TimeoutError, WebSocketDisconnect):
        pass
    except (ValueError, TypeError):
        await _close(websocket, 4002, "Failed to decode payload")
    except Exception as exc:
        print(f"[BotVoiceGateway] error: {type(exc).__name__}")
        await _close(websocket, 1011, "Internal voice error")
    finally:
        if session is not None and user is not None and voice_channel is not None and connection_id:
            await _cleanup_voice_session(
                websocket=websocket,
                db=db,
                user=user,
                channel_id=session.channel_id,
                connection_id=connection_id,
                manager_channel_id=-session.channel_id,
                joined_presence=joined_presence,
                source_application_id=session.application_id,
            )
            await bot_voice_sessions.detach(session.session_id, websocket)
        await db.close()
