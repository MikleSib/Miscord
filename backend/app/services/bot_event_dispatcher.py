from __future__ import annotations

import asyncio
import json
import time
import zlib
from collections import defaultdict, deque
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import BotApplication, BotInstall, BotUserInstall, TextChannel
from app.schemas.bot_protocol import GatewayOpCode, GATEWAY_API_VERSION
from app.services.miscord_serializers import miscord_message, miscord_user
from app.services.message_serializer import serialize_channel_message


INTENT_GUILDS = 1 << 0
INTENT_GUILD_MEMBERS = 1 << 1
INTENT_GUILD_MODERATION = 1 << 2
INTENT_GUILD_EXPRESSIONS = 1 << 3
INTENT_GUILD_INTEGRATIONS = 1 << 4
INTENT_GUILD_WEBHOOKS = 1 << 5
INTENT_GUILD_INVITES = 1 << 6
INTENT_GUILD_VOICE_STATES = 1 << 7
INTENT_GUILD_PRESENCES = 1 << 8
INTENT_GUILD_MESSAGES = 1 << 9
INTENT_GUILD_MESSAGE_REACTIONS = 1 << 10
INTENT_GUILD_MESSAGE_TYPING = 1 << 11
INTENT_DIRECT_MESSAGES = 1 << 12
INTENT_DIRECT_MESSAGE_REACTIONS = 1 << 13
INTENT_DIRECT_MESSAGE_TYPING = 1 << 14
INTENT_MESSAGE_CONTENT = 1 << 15
INTENT_GUILD_SCHEDULED_EVENTS = 1 << 16
INTENT_AUTO_MODERATION_CONFIGURATION = 1 << 20
INTENT_AUTO_MODERATION_EXECUTION = 1 << 21
INTENT_GUILD_MESSAGE_POLLS = 1 << 24
INTENT_DIRECT_MESSAGE_POLLS = 1 << 25
INTENT_DEFAULTS = INTENT_GUILDS | INTENT_GUILD_MESSAGES
VALID_INTENTS_MASK = (
    INTENT_GUILDS
    | INTENT_GUILD_MEMBERS
    | INTENT_GUILD_MODERATION
    | INTENT_GUILD_EXPRESSIONS
    | INTENT_GUILD_INTEGRATIONS
    | INTENT_GUILD_WEBHOOKS
    | INTENT_GUILD_INVITES
    | INTENT_GUILD_VOICE_STATES
    | INTENT_GUILD_PRESENCES
    | INTENT_GUILD_MESSAGES
    | INTENT_GUILD_MESSAGE_REACTIONS
    | INTENT_GUILD_MESSAGE_TYPING
    | INTENT_DIRECT_MESSAGES
    | INTENT_DIRECT_MESSAGE_REACTIONS
    | INTENT_DIRECT_MESSAGE_TYPING
    | INTENT_MESSAGE_CONTENT
    | INTENT_GUILD_SCHEDULED_EVENTS
    | INTENT_AUTO_MODERATION_CONFIGURATION
    | INTENT_AUTO_MODERATION_EXECUTION
    | INTENT_GUILD_MESSAGE_POLLS
    | INTENT_DIRECT_MESSAGE_POLLS
)

OP_DISPATCH = GatewayOpCode.DISPATCH
OP_HELLO = GatewayOpCode.HELLO
OP_HEARTBEAT_ACK = GatewayOpCode.HEARTBEAT_ACK
HEARTBEAT_INTERVAL_MS = 45_000
RESUME_TTL_SECONDS = 120
EVENT_BUFFER_SIZE = 100
IDENTIFY_LIMIT = 1000
IDENTIFY_WINDOW_SECONDS = 60


@dataclass
class _GatewaySessionState:
    application_id: int
    application_client_id: str
    session_id: str
    websocket: WebSocket
    intents: int
    sequence: int = 0
    last_heartbeat: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    buffer: deque[dict[str, Any]] = field(default_factory=lambda: deque(maxlen=EVENT_BUFFER_SIZE))


@dataclass
class _ResumeState:
    application_id: int
    intents: int
    sequence: int
    buffer: deque[dict[str, Any]]
    expires_at: datetime


class BotEventDispatcher:
    def __init__(self) -> None:
        self._sessions_by_app: dict[int, set[str]] = {}
        self._sessions: dict[str, _GatewaySessionState] = {}
        self._resume_states: dict[str, _ResumeState] = {}
        self._identify_hits: dict[int, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    @staticmethod
    def _coerce_id(value: Any) -> str | None:
        return None if value is None else str(value)

    @staticmethod
    def internal_message_payload(message) -> dict[str, Any]:
        return serialize_channel_message(message)

    @staticmethod
    def _mask_message_payload_for_intent(
        payload: dict[str, Any],
        intents: int,
        application_client_id: str,
    ) -> dict[str, Any]:
        if intents & INTENT_MESSAGE_CONTENT or str(payload.get("application_id") or "") == application_client_id:
            return payload
        output = deepcopy(payload)
        output["content"] = ""
        output["embeds"] = []
        output["attachments"] = []
        output["components"] = []
        output["poll"] = None
        return output

    @staticmethod
    def _dispatch_payload(event_name: str, data: dict[str, Any], sequence: int) -> dict[str, Any]:
        return {"op": int(OP_DISPATCH), "t": event_name, "s": sequence, "d": data}

    @staticmethod
    def _ready_data(application: BotApplication, bot_user, session_id: str, guild_ids: list[int]) -> dict[str, Any]:
        gateway_host = settings.SERVER_HOST.rstrip("/")
        gateway_host = gateway_host.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
        return {
            "v": GATEWAY_API_VERSION,
            "user": miscord_user(bot_user),
            "guilds": [{"id": str(guild_id), "unavailable": True} for guild_id in guild_ids],
            "session_id": session_id,
            "resume_gateway_url": f"{gateway_host}/gateway",
            "shard": [0, 1],
            "application": {
                "id": application.client_id,
                "flags": int(application.flags or 0),
            },
        }

    async def _send(self, websocket: WebSocket, payload: dict[str, Any]) -> bool:
        try:
            encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            if websocket.scope.get("gateway_compress") == "zlib-stream":
                compressor = websocket.scope.get("gateway_compressor")
                if compressor is None:
                    compressor = zlib.compressobj()
                    websocket.scope["gateway_compressor"] = compressor
                await websocket.send_bytes(compressor.compress(encoded) + compressor.flush(zlib.Z_SYNC_FLUSH))
            else:
                await websocket.send_text(encoded.decode("utf-8"))
            return True
        except Exception:
            return False

    async def consume_identify(self, application_id: int) -> bool:
        now = time.monotonic()
        async with self._lock:
            hits = self._identify_hits[application_id]
            cutoff = now - IDENTIFY_WINDOW_SECONDS
            while hits and hits[0] < cutoff:
                hits.popleft()
            if len(hits) >= IDENTIFY_LIMIT:
                return False
            hits.append(now)
            return True

    async def identify_remaining(self, application_id: int) -> int:
        now = time.monotonic()
        async with self._lock:
            hits = self._identify_hits[application_id]
            cutoff = now - IDENTIFY_WINDOW_SECONDS
            while hits and hits[0] < cutoff:
                hits.popleft()
            return max(0, IDENTIFY_LIMIT - len(hits))

    async def register(
        self,
        application_id: int,
        application_client_id: str,
        websocket: WebSocket,
        *,
        session_id: str,
        intents: int,
        sequence: int = 0,
        resume_after: int | None = None,
    ) -> tuple[_GatewaySessionState, list[dict[str, Any]]]:
        now = datetime.now(timezone.utc)
        async with self._lock:
            self._prune_resume_states(now)
            previous = self._resume_states.pop(session_id, None) if resume_after is not None else None
            buffer = deque(maxlen=EVENT_BUFFER_SIZE)
            replay: list[dict[str, Any]] = []
            if previous and previous.application_id == application_id:
                buffer.extend(previous.buffer)
                sequence = max(sequence, previous.sequence)
                replay = [dict(item) for item in previous.buffer if int(item.get("s") or 0) > resume_after]
            state = _GatewaySessionState(
                application_id=application_id,
                application_client_id=application_client_id,
                session_id=session_id,
                websocket=websocket,
                intents=intents,
                sequence=sequence,
                buffer=buffer,
            )
            self._sessions[session_id] = state
            self._sessions_by_app.setdefault(application_id, set()).add(session_id)
            return state, replay

    def _prune_resume_states(self, now: datetime) -> None:
        expired = [session_id for session_id, state in self._resume_states.items() if state.expires_at <= now]
        for session_id in expired:
            self._resume_states.pop(session_id, None)

    async def unregister(self, session_id: str, *, resumable: bool = True) -> None:
        async with self._lock:
            state = self._sessions.pop(session_id, None)
            if state is None:
                return
            app_sessions = self._sessions_by_app.get(state.application_id, set())
            app_sessions.discard(session_id)
            if not app_sessions:
                self._sessions_by_app.pop(state.application_id, None)
            if resumable:
                self._resume_states[session_id] = _ResumeState(
                    application_id=state.application_id,
                    intents=state.intents,
                    sequence=state.sequence,
                    buffer=deque(state.buffer, maxlen=EVENT_BUFFER_SIZE),
                    expires_at=datetime.now(timezone.utc) + timedelta(seconds=RESUME_TTL_SECONDS),
                )
            else:
                self._resume_states.pop(session_id, None)

    async def disconnect_application(self, application_id: int, *, code: int = 4004) -> None:
        async with self._lock:
            session_ids = list(self._sessions_by_app.get(application_id, set()))
            states = [self._sessions.get(item) for item in session_ids]
        for state in states:
            if state is None:
                continue
            try:
                await state.websocket.close(code=code)
            except Exception:
                pass
            await self.unregister(state.session_id, resumable=False)

    async def touch(self, session_id: str) -> None:
        async with self._lock:
            state = self._sessions.get(session_id)
            if state:
                state.last_heartbeat = datetime.now(timezone.utc)

    async def has_active_sessions(self, application_id: int) -> bool:
        async with self._lock:
            return bool(self._sessions_by_app.get(application_id))

    async def hello(self, websocket: WebSocket) -> None:
        await self._send(websocket, {
            "op": int(OP_HELLO),
            "d": {"heartbeat_interval": HEARTBEAT_INTERVAL_MS, "_trace": ["miscord-gateway-v10"]},
        })

    async def heartbeat_ack(self, websocket: WebSocket) -> None:
        await self._send(websocket, {"op": int(OP_HEARTBEAT_ACK), "d": None})

    async def send_ready(
        self,
        state: _GatewaySessionState,
        application: BotApplication,
        bot_user,
        guild_ids: list[int],
    ) -> bool:
        return await self._send_event_to_state(
            state,
            "READY",
            self._ready_data(application, bot_user, state.session_id, guild_ids),
        )

    async def send_resumed(self, state: _GatewaySessionState, replay: list[dict[str, Any]]) -> bool:
        for payload in replay:
            if not await self._send(state.websocket, payload):
                return False
        return await self._send_event_to_state(state, "RESUMED", {})

    async def send_to_session(self, state: _GatewaySessionState, event_name: str, data: dict[str, Any]) -> bool:
        return await self._send_event_to_state(state, event_name, data)

    async def _send_event_to_state(
        self,
        state: _GatewaySessionState,
        event_name: str,
        data: dict[str, Any],
        *,
        message_payload_filter: bool = False,
    ) -> bool:
        if message_payload_filter:
            data = self._mask_message_payload_for_intent(data, state.intents, state.application_client_id)
        state.sequence += 1
        payload = self._dispatch_payload(event_name, data, state.sequence)
        state.buffer.append(deepcopy(payload))
        ok = await self._send(state.websocket, payload)
        if not ok:
            await self.unregister(state.session_id)
        return ok

    async def _iter_session_states(self, application_id: int):
        async with self._lock:
            session_ids = list(self._sessions_by_app.get(application_id, set()))
        for session_id in session_ids:
            state = self._sessions.get(session_id)
            if state is not None:
                yield state

    async def _dispatch_to_application(
        self,
        application_id: int,
        data: dict[str, Any],
        *,
        required_intent: int = 0,
        event_name: str,
        message_payload_filter: bool = False,
    ) -> int:
        delivered = 0
        async for state in self._iter_session_states(application_id):
            if required_intent and not (state.intents & required_intent):
                continue
            if await self._send_event_to_state(
                state,
                event_name,
                dict(data),
                message_payload_filter=message_payload_filter,
            ):
                delivered += 1
        return delivered

    async def dispatch_install_create(
        self,
        application_id: int,
        server_id: int,
        *,
        permissions: int,
        intents: int,
        scopes: list[str] | None = None,
    ) -> None:
        await self._dispatch_to_application(
            application_id,
            {"id": str(server_id), "unavailable": True},
            required_intent=INTENT_GUILDS,
            event_name="GUILD_CREATE",
        )

    async def dispatch_install_update(self, application_id: int, server_id: int, **_: Any) -> None:
        await self._dispatch_to_application(
            application_id,
            {"id": str(server_id), "unavailable": False},
            required_intent=INTENT_GUILDS,
            event_name="GUILD_UPDATE",
        )

    async def dispatch_install_delete(self, application_id: int, server_id: int, **_: Any) -> None:
        await self._dispatch_to_application(
            application_id,
            {"id": str(server_id), "unavailable": False},
            required_intent=INTENT_GUILDS,
            event_name="GUILD_DELETE",
        )

    async def dispatch_voice_state_update(
        self,
        db: AsyncSession,
        guild_id: int,
        payload: dict[str, Any],
        *,
        exclude_application_id: int | None = None,
    ) -> None:
        result = await db.execute(
            select(BotInstall.application_id)
            .join(BotApplication, BotApplication.id == BotInstall.application_id)
            .where(
                BotInstall.server_id == guild_id,
                BotInstall.status == "active",
                BotApplication.status == "active",
            )
        )
        for (application_id,) in result.all():
            application_id = int(application_id)
            if exclude_application_id is not None and application_id == exclude_application_id:
                continue
            await self._dispatch_to_application(
                application_id,
                payload,
                required_intent=INTENT_GUILD_VOICE_STATES,
                event_name="VOICE_STATE_UPDATE",
            )

    async def _installed_apps_for_channel(self, db: AsyncSession, channel_id: int) -> list[int]:
        channel = await db.get(TextChannel, channel_id)
        if channel is None:
            return []
        result = await db.execute(
            select(BotInstall.application_id)
            .join(BotApplication, BotApplication.id == BotInstall.application_id)
            .where(
                BotInstall.server_id == channel.channel_id,
                BotInstall.status == "active",
                BotApplication.status == "active",
            )
        )
        # Gateway intents belong to the active session, not to the OAuth
        # installation. _dispatch_to_application applies the requested intent
        # for every connected session.
        return [int(app_id) for (app_id,) in result.all()]

    async def dispatch_message_create(self, db: AsyncSession, message) -> None:
        channel = await db.get(TextChannel, message.text_channel_id)
        if channel is None:
            return
        payload = miscord_message(message, guild_id=channel.channel_id)
        for application_id in await self._installed_apps_for_channel(db, message.text_channel_id):
            await self._dispatch_to_application(
                application_id,
                payload,
                required_intent=INTENT_GUILD_MESSAGES,
                event_name="MESSAGE_CREATE",
                message_payload_filter=True,
            )

    async def dispatch_message_update(self, db: AsyncSession, message) -> None:
        channel = await db.get(TextChannel, message.text_channel_id)
        if channel is None:
            return
        payload = miscord_message(message, guild_id=channel.channel_id)
        for application_id in await self._installed_apps_for_channel(db, message.text_channel_id):
            await self._dispatch_to_application(
                application_id,
                payload,
                required_intent=INTENT_GUILD_MESSAGES,
                event_name="MESSAGE_UPDATE",
                message_payload_filter=True,
            )

    async def dispatch_message_delete(self, db: AsyncSession, message_id: int, channel_id: int) -> None:
        channel = await db.get(TextChannel, channel_id)
        if channel is None:
            return
        payload = {"id": str(message_id), "channel_id": str(channel_id), "guild_id": str(channel.channel_id)}
        for application_id in await self._installed_apps_for_channel(db, channel_id):
            await self._dispatch_to_application(
                application_id,
                payload,
                required_intent=INTENT_GUILD_MESSAGES,
                event_name="MESSAGE_DELETE",
            )

    async def dispatch_message_reaction_add(self, db: AsyncSession, message, user, emoji: str) -> None:
        channel = await db.get(TextChannel, message.text_channel_id)
        if channel is None:
            return
        payload = {
            "user_id": str(user.id),
            "channel_id": str(message.text_channel_id),
            "message_id": str(message.id),
            "guild_id": str(channel.channel_id),
            "member": None,
            "emoji": {"id": None, "name": emoji},
            "message_author_id": str(message.author_id) if message.author_id else None,
            "burst": False,
            "burst_colors": [],
            "type": 0,
        }
        for application_id in await self._installed_apps_for_channel(db, message.text_channel_id):
            await self._dispatch_to_application(application_id, payload, required_intent=INTENT_GUILD_MESSAGE_REACTIONS, event_name="MESSAGE_REACTION_ADD")

    async def dispatch_message_reaction_remove(self, db: AsyncSession, message, user, emoji: str) -> None:
        channel = await db.get(TextChannel, message.text_channel_id)
        if channel is None:
            return
        payload = {
            "user_id": str(user.id),
            "channel_id": str(message.text_channel_id),
            "message_id": str(message.id),
            "guild_id": str(channel.channel_id),
            "emoji": {"id": None, "name": emoji},
            "burst": False,
            "type": 0,
        }
        for application_id in await self._installed_apps_for_channel(db, message.text_channel_id):
            await self._dispatch_to_application(application_id, payload, required_intent=INTENT_GUILD_MESSAGE_REACTIONS, event_name="MESSAGE_REACTION_REMOVE")

    async def dispatch_typing_start(self, db: AsyncSession, channel_id: int, user_id: int) -> None:
        channel = await db.get(TextChannel, channel_id)
        if channel is None:
            return
        payload = {
            "channel_id": str(channel_id),
            "guild_id": str(channel.channel_id),
            "user_id": str(user_id),
            "timestamp": int(time.time()),
            "member": None,
        }
        for application_id in await self._installed_apps_for_channel(db, channel_id):
            await self._dispatch_to_application(application_id, payload, required_intent=INTENT_GUILD_MESSAGE_TYPING, event_name="TYPING_START")

    async def dispatch_guild_event(
        self,
        db: AsyncSession,
        guild_id: int,
        event_name: str,
        payload: dict[str, Any],
        *,
        required_intent: int = INTENT_GUILDS,
    ) -> None:
        result = await db.execute(
            select(BotInstall.application_id).where(
                BotInstall.server_id == guild_id,
                BotInstall.status == "active",
            )
        )
        for (application_id,) in result.all():
            await self._dispatch_to_application(int(application_id), payload, required_intent=required_intent, event_name=event_name)

    async def dispatch_interaction_create(self, db: AsyncSession, interaction) -> int:
        application = await db.get(BotApplication, interaction.application_id)
        if application is None or application.status != "active":
            return 0
        if interaction.guild_id is not None:
            install = await db.scalar(select(BotInstall.id).where(
                BotInstall.application_id == interaction.application_id,
                BotInstall.server_id == int(interaction.guild_id),
                BotInstall.status == "active",
            ))
            if install is None:
                user_install = await db.scalar(select(BotUserInstall.id).where(
                    BotUserInstall.application_id == interaction.application_id,
                    BotUserInstall.user_id == interaction.author_user_id,
                    BotUserInstall.status == "active",
                ))
                if user_install is None:
                    return 0
        payload = dict(interaction.request_payload or {})
        if not payload:
            payload = {
                "id": interaction.interaction_id,
                "application_id": application.client_id,
                "type": int(interaction.interaction_type or 2),
                "token": interaction.interaction_token,
                "version": 1,
                "guild_id": str(interaction.guild_id) if interaction.guild_id else None,
                "channel_id": str(interaction.channel_id) if interaction.channel_id else None,
                "data": {"id": str(interaction.command_id)} if interaction.command_id else {},
            }
        return await self._dispatch_to_application(
            int(interaction.application_id),
            payload,
            required_intent=0,
            event_name="INTERACTION_CREATE",
        )


dispatcher = BotEventDispatcher()
