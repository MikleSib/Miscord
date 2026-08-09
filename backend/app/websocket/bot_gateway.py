from __future__ import annotations

import asyncio
import json
import secrets
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models import (
    BotApplication,
    BotInstall,
    BotSession,
    Channel,
    ChannelKind,
    ChannelMember,
    ChannelPermissionOverwrite,
    MemberRole,
    Role,
    TextChannel,
    User,
    VoiceChannel,
    VoiceChannelUser,
)
from app.schemas.bot_protocol import BotProtocolError, GatewayOpCode, validate_gateway_query
from app.services.bot_event_dispatcher import (
    HEARTBEAT_INTERVAL_MS,
    VALID_INTENTS_MASK,
    dispatcher as bot_event_dispatcher,
)
from app.services.bot_security import BotPrincipal, get_bot_principal_by_token
from app.services.bot_presence import set_bot_online
from app.services.miscord_serializers import miscord_channel, miscord_role, miscord_user, miscord_voice_state
from app.websocket.bot_voice_control import handle_voice_state_update


OP_HEARTBEAT = int(GatewayOpCode.HEARTBEAT)
OP_IDENTIFY = int(GatewayOpCode.IDENTIFY)
OP_PRESENCE_UPDATE = int(GatewayOpCode.PRESENCE_UPDATE)
OP_VOICE_STATE_UPDATE = int(GatewayOpCode.VOICE_STATE_UPDATE)
OP_RESUME = int(GatewayOpCode.RESUME)
OP_RECONNECT = int(GatewayOpCode.RECONNECT)
OP_REQUEST_GUILD_MEMBERS = int(GatewayOpCode.REQUEST_GUILD_MEMBERS)
OP_INVALID_SESSION = int(GatewayOpCode.INVALID_SESSION)

MAX_GATEWAY_PAYLOAD_BYTES = 4096
MAX_CLIENT_EVENTS = 120
CLIENT_EVENT_WINDOW_SECONDS = 60
PRIVILEGED_INTENT_FLAGS = {
    1 << 1: (1 << 14) | (1 << 15),
    1 << 8: (1 << 12) | (1 << 13),
    1 << 15: (1 << 18) | (1 << 19),
}


def _coerce_dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _coerce_int(value: Any, default: int | None = 0) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _clean_token(value: str | None) -> str:
    token = str(value or "").strip()
    return token[4:].strip() if token.startswith("Bot ") else token


async def _close(websocket: WebSocket, code: int) -> None:
    try:
        await websocket.close(code=code)
    except Exception:
        pass


async def _send_invalid_session(websocket: WebSocket, resumable: bool) -> None:
    await bot_event_dispatcher._send(websocket, {"op": OP_INVALID_SESSION, "d": resumable})


async def _load_bot_session(db: AsyncSession, application_id: int, session_id: str) -> BotSession | None:
    result = await db.execute(select(BotSession).where(
        BotSession.application_id == application_id,
        BotSession.session_id == session_id,
    ))
    return result.scalar_one_or_none()


async def _touch_session(db: AsyncSession, session_id: str, sequence: int | None = None) -> None:
    values: dict[str, Any] = {"last_heartbeat_at": datetime.now(timezone.utc), "is_active": True}
    if sequence is not None:
        values["sequence"] = sequence
    await db.execute(update(BotSession).where(BotSession.session_id == session_id).values(**values))
    await db.commit()


async def _mark_session_inactive(db: AsyncSession, session_id: str, *, resumable: bool = True) -> None:
    await db.execute(update(BotSession).where(BotSession.session_id == session_id).values(
        is_active=False,
        is_resumable=resumable,
    ))
    await db.commit()


def _validate_intents(application: BotApplication, intents: Any) -> int:
    if intents is None:
        raise BotProtocolError("invalid_intents", "The intents field is required")
    requested = _coerce_int(intents, -1)
    if requested is None or requested < 0 or requested & ~VALID_INTENTS_MASK:
        raise BotProtocolError("invalid_intents", "Invalid Gateway intents")
    for intent, flags in PRIVILEGED_INTENT_FLAGS.items():
        if requested & intent and not (int(application.flags or 0) & flags):
            raise BotProtocolError("disallowed_intents", "Disallowed privileged Gateway intents")
    return requested


async def _guild_create_payload(db: AsyncSession, principal: BotPrincipal, guild_id: int) -> dict[str, Any]:
    guild_result = await db.execute(
        select(Channel)
        .options(selectinload(Channel.text_channels), selectinload(Channel.voice_channels), selectinload(Channel.roles))
        .where(Channel.id == guild_id)
    )
    guild = guild_result.scalar_one_or_none()
    if guild is None:
        return {"id": str(guild_id), "unavailable": True}
    membership_result = await db.execute(select(ChannelMember).where(
        ChannelMember.channel_id == guild_id,
        ChannelMember.user_id == principal.bot_user.id,
    ))
    membership = membership_result.scalar_one_or_none()
    role_ids_result = await db.execute(select(MemberRole.role_id).where(
        MemberRole.server_id == guild_id,
        MemberRole.user_id == principal.bot_user.id,
    ))
    member_count_result = await db.execute(select(ChannelMember.id).where(ChannelMember.channel_id == guild_id))
    overwrite_result = await db.execute(select(ChannelPermissionOverwrite).where(
        ChannelPermissionOverwrite.server_id == guild_id
    ))
    voice_state_result = await db.execute(
        select(VoiceChannelUser, VoiceChannel)
        .join(VoiceChannel, VoiceChannel.id == VoiceChannelUser.voice_channel_id)
        .where(VoiceChannel.channel_id == guild_id)
    )
    voice_states = [
        miscord_voice_state(
            guild_id=guild_id,
            channel_id=voice_channel.id,
            user_id=voice_user.user_id,
            session_id=f"voice-{voice_user.id}",
            self_mute=bool(voice_user.is_muted),
            self_deaf=bool(voice_user.is_deafened),
        )
        for voice_user, voice_channel in voice_state_result.all()
    ]
    overwrites: dict[tuple[ChannelKind, int], list[ChannelPermissionOverwrite]] = {}
    for overwrite in overwrite_result.scalars().all():
        overwrites.setdefault((overwrite.channel_kind, int(overwrite.channel_id)), []).append(overwrite)
    channels = [
        miscord_channel(
            item,
            guild_id=guild_id,
            overwrites=overwrites.get((ChannelKind.TEXT, item.id), []),
        )
        for item in guild.text_channels
        if not item.is_hidden
    ]
    channels.extend(
        miscord_channel(
            item,
            guild_id=guild_id,
            overwrites=overwrites.get((ChannelKind.VOICE, item.id), []),
        )
        for item in guild.voice_channels
    )
    return {
        "id": str(guild.id),
        "name": guild.name,
        "icon": guild.icon,
        "description": guild.description,
        "splash": None,
        "discovery_splash": None,
        "owner": guild.owner_id == principal.bot_user.id,
        "owner_id": str(guild.owner_id),
        "permissions": str(await _bot_permissions(db, principal, guild_id)),
        "afk_channel_id": None,
        "afk_timeout": 300,
        "widget_enabled": False,
        "verification_level": 0,
        "default_message_notifications": 0,
        "explicit_content_filter": 0,
        "roles": [miscord_role(item, guild_id=guild_id) for item in guild.roles],
        "emojis": [],
        "features": [],
        "mfa_level": 0,
        "application_id": None,
        "system_channel_id": None,
        "system_channel_flags": 0,
        "rules_channel_id": None,
        "max_members": 250000,
        "vanity_url_code": None,
        "banner": guild.banner,
        "premium_tier": 0,
        "premium_subscription_count": 0,
        "preferred_locale": "ru",
        "public_updates_channel_id": None,
        "nsfw_level": 0,
        "stickers": [],
        "premium_progress_bar_enabled": False,
        "joined_at": membership.joined_at.isoformat() if membership and membership.joined_at else datetime.now(timezone.utc).isoformat(),
        "large": False,
        "unavailable": False,
        "member_count": len(member_count_result.scalars().all()),
        "voice_states": voice_states,
        "members": [{
            "user": miscord_user(principal.bot_user),
            "nick": membership.nickname if membership else None,
            "avatar": None,
            "roles": [str(item) for item in role_ids_result.scalars().all()],
            "joined_at": membership.joined_at.isoformat() if membership and membership.joined_at else datetime.now(timezone.utc).isoformat(),
            "deaf": False,
            "mute": False,
            "flags": 0,
            "pending": False,
            "communication_disabled_until": None,
        }],
        "channels": channels,
        "threads": [],
        "presences": [],
        "stage_instances": [],
        "guild_scheduled_events": [],
    }


async def _bot_permissions(db: AsyncSession, principal: BotPrincipal, guild_id: int) -> int:
    from app.core.permissions import get_member_permissions
    return await get_member_permissions(db, guild_id, principal.bot_user.id)


async def _identify_session(websocket: WebSocket, db: AsyncSession, token: str, data: dict[str, Any]):
    if not token:
        await _close(websocket, 4004)
        return None
    principal = await get_bot_principal_by_token(token, db)
    try:
        intents = _validate_intents(principal.application, data.get("intents"))
    except BotProtocolError as exc:
        await _close(websocket, 4014 if exc.code == "disallowed_intents" else 4013)
        return None
    shard = data.get("shard")
    if shard is not None and (not isinstance(shard, list) or len(shard) != 2 or shard != [0, 1]):
        await _close(websocket, 4010)
        return None
    if not await bot_event_dispatcher.consume_identify(principal.application.id):
        await _close(websocket, 4008)
        return None
    session_id = secrets.token_urlsafe(24)
    session = BotSession(
        application_id=principal.application.id,
        session_id=session_id,
        intents=intents,
        sequence=0,
        is_active=True,
        is_resumable=True,
        last_heartbeat_at=datetime.now(timezone.utc),
    )
    db.add(session)
    await db.commit()
    state, _ = await bot_event_dispatcher.register(
        principal.application.id,
        principal.application.client_id,
        websocket,
        session_id=session_id,
        intents=intents,
    )
    installs_result = await db.execute(select(BotInstall.server_id).where(
        BotInstall.application_id == principal.application.id,
        BotInstall.status == "active",
    ))
    guild_ids = [int(item) for item in installs_result.scalars().all()]
    if not await bot_event_dispatcher.send_ready(state, principal.application, principal.bot_user, guild_ids):
        return None
    for guild_id in guild_ids:
        await bot_event_dispatcher.send_to_session(state, "GUILD_CREATE", await _guild_create_payload(db, principal, guild_id))
    return principal, state


async def _resume_session(websocket: WebSocket, db: AsyncSession, token: str, data: dict[str, Any]):
    session_id = str(data.get("session_id") or "")
    requested_sequence = _coerce_int(data.get("seq"), -1)
    if not token or not session_id or requested_sequence is None or requested_sequence < 0:
        await _send_invalid_session(websocket, False)
        return None
    principal = await get_bot_principal_by_token(token, db)
    existing = await _load_bot_session(db, principal.application.id, session_id)
    if existing is None or not existing.is_resumable or requested_sequence > int(existing.sequence or 0):
        await _send_invalid_session(websocket, False)
        return None
    state, replay = await bot_event_dispatcher.register(
        principal.application.id,
        principal.application.client_id,
        websocket,
        session_id=session_id,
        intents=int(existing.intents),
        sequence=int(existing.sequence or 0),
        resume_after=requested_sequence,
    )
    existing.is_active = True
    existing.last_heartbeat_at = datetime.now(timezone.utc)
    await db.commit()
    if not await bot_event_dispatcher.send_resumed(state, replay):
        return None
    return principal, state


async def _receive_payload(websocket: WebSocket) -> tuple[dict[str, Any] | None, int]:
    message = await asyncio.wait_for(websocket.receive(), timeout=(HEARTBEAT_INTERVAL_MS / 1000) * 2)
    if message.get("type") == "websocket.disconnect":
        raise WebSocketDisconnect(message.get("code", 1000))
    raw: str | bytes | None = message.get("text") if message.get("text") is not None else message.get("bytes")
    if raw is None:
        return None, 0
    encoded = raw.encode("utf-8") if isinstance(raw, str) else raw
    if len(encoded) > MAX_GATEWAY_PAYLOAD_BYTES:
        return None, len(encoded)
    try:
        payload = json.loads(encoded.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, -1
    return payload if isinstance(payload, dict) else None, len(encoded)


async def websocket_gateway_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    if not settings.BOT_PLATFORM_ENABLED:
        await _close(websocket, 4004)
        return
    try:
        validate_gateway_query(
            _coerce_int(websocket.query_params.get("v"), None),
            websocket.query_params.get("encoding"),
            websocket.query_params.get("compress"),
        )
    except BotProtocolError:
        await _close(websocket, 4012)
        return
    websocket.scope["gateway_compress"] = websocket.query_params.get("compress")
    await bot_event_dispatcher.hello(websocket)

    db = AsyncSessionLocal()
    state = None
    principal = None
    incoming_events: deque[float] = deque()
    try:
        while True:
            try:
                payload, size = await _receive_payload(websocket)
            except asyncio.TimeoutError:
                await _close(websocket, 4009)
                return
            if size > MAX_GATEWAY_PAYLOAD_BYTES:
                await _close(websocket, 4002)
                return
            if payload is None:
                await _close(websocket, 4002)
                return
            if state is not None and datetime.now(timezone.utc) - state.last_heartbeat > timedelta(
                milliseconds=HEARTBEAT_INTERVAL_MS * 2
            ):
                await _close(websocket, 4009)
                return
            now = time.monotonic()
            while incoming_events and incoming_events[0] < now - CLIENT_EVENT_WINDOW_SECONDS:
                incoming_events.popleft()
            if len(incoming_events) >= MAX_CLIENT_EVENTS:
                await _close(websocket, 4008)
                return
            incoming_events.append(now)

            op = _coerce_int(payload.get("op"), -1)
            data = _coerce_dict(payload.get("d"))

            if op == OP_HEARTBEAT:
                await bot_event_dispatcher.heartbeat_ack(websocket)
                if state is not None:
                    sequence = _coerce_int(payload.get("d"), None)
                    await bot_event_dispatcher.touch(state.session_id)
                    await _touch_session(db, state.session_id, sequence)
                continue
            if op == OP_IDENTIFY:
                if state is not None:
                    await _close(websocket, 4005)
                    return
                try:
                    result = await _identify_session(websocket, db, _clean_token(data.get("token")), data)
                except HTTPException:
                    await _close(websocket, 4004)
                    return
                if result is None:
                    return
                principal, state = result
                await set_bot_online(db, principal.bot_user.id, True)
                continue
            if op == OP_RESUME:
                if state is not None:
                    await _close(websocket, 4005)
                    return
                try:
                    result = await _resume_session(websocket, db, _clean_token(data.get("token")), data)
                except HTTPException:
                    await _close(websocket, 4004)
                    return
                if result is None:
                    continue
                principal, state = result
                await set_bot_online(db, principal.bot_user.id, True)
                continue
            if op == OP_RECONNECT:
                await _close(websocket, 4000)
                return
            if state is None or principal is None:
                await _close(websocket, 4003)
                return
            if op == OP_PRESENCE_UPDATE:
                continue
            if op == OP_VOICE_STATE_UPDATE:
                await handle_voice_state_update(db, principal, state, data)
                continue
            if op == OP_REQUEST_GUILD_MEMBERS:
                if not (state.intents & (1 << 1)):
                    await _close(websocket, 4014)
                    return
                guild_id = _coerce_int(data.get("guild_id"), 0) or 0
                installed = await db.scalar(select(BotInstall.id).where(
                    BotInstall.application_id == principal.application.id,
                    BotInstall.server_id == guild_id,
                    BotInstall.status == "active",
                ))
                if installed is None:
                    continue
                users_result = await db.execute(
                    select(User, ChannelMember)
                    .join(ChannelMember, ChannelMember.user_id == User.id)
                    .where(ChannelMember.channel_id == guild_id)
                    .limit(1000)
                )
                role_rows = await db.execute(
                    select(MemberRole.user_id, MemberRole.role_id).where(MemberRole.server_id == guild_id)
                )
                roles_by_user: dict[int, list[str]] = {}
                for user_id, role_id in role_rows.all():
                    roles_by_user.setdefault(int(user_id), []).append(str(role_id))
                members = []
                for user, membership in users_result.all():
                    members.append({
                        "user": miscord_user(user),
                        "nick": membership.nickname,
                        "roles": roles_by_user.get(user.id, []),
                        "joined_at": membership.joined_at.isoformat() if membership.joined_at else None,
                        "deaf": False,
                        "mute": False,
                        "flags": 0,
                        "pending": False,
                    })
                await bot_event_dispatcher.send_to_session(state, "GUILD_MEMBERS_CHUNK", {
                    "guild_id": str(guild_id),
                    "members": members,
                    "chunk_index": 0,
                    "chunk_count": 1,
                    "not_found": [],
                    "presences": [],
                    "nonce": data.get("nonce"),
                })
                continue
            await _close(websocket, 4001)
            return
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        print(f"[BotGateway] error: {type(exc).__name__}")
        await _close(websocket, 1011)
    finally:
        if state is not None:
            await bot_event_dispatcher.unregister(state.session_id, resumable=True)
            try:
                await _mark_session_inactive(db, state.session_id, resumable=True)
            except Exception:
                pass
        if principal is not None and not await bot_event_dispatcher.has_active_sessions(
            principal.application.id
        ):
            try:
                await set_bot_online(db, principal.bot_user.id, False)
            except Exception:
                pass
        await db.close()
