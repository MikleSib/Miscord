from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from copy import deepcopy
from typing import Any, Optional

from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import BotApplication, BotInstall, TextChannel
from app.schemas.bot_protocol import GatewayOpCode, GATEWAY_API_VERSION
from app.services.message_serializer import serialize_channel_message


INTENT_GUILD_MESSAGES = 1 << 9
INTENT_MESSAGE_CONTENT = 1 << 15
INTENT_DEFAULTS = INTENT_GUILD_MESSAGES | INTENT_MESSAGE_CONTENT

OP_DISPATCH = GatewayOpCode.DISPATCH
OP_HELLO = GatewayOpCode.HELLO
OP_HEARTBEAT_ACK = GatewayOpCode.HEARTBEAT_ACK
OP_HELLO_PAYLOAD = {"v": GATEWAY_API_VERSION, "properties": {}}


@dataclass
class _GatewaySessionState:
    application_id: int
    session_id: str
    websocket: WebSocket
    intents: int = INTENT_DEFAULTS
    sequence: int = 0
    last_heartbeat: datetime | None = None


class BotEventDispatcher:
    def __init__(self) -> None:
        self._sessions_by_app: dict[int, set[str]] = {}
        self._sessions: dict[str, _GatewaySessionState] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _coerce_id(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            return value
        return str(value)

    @staticmethod
    def _coerce_payload_ids(payload: dict[str, Any], *, keys: tuple[str, ...]) -> dict[str, Any]:
        for key in keys:
            if key in payload:
                payload[key] = BotEventDispatcher._coerce_id(payload[key])
        return payload

    @staticmethod
    def _coerce_message_payload(message) -> dict[str, Any]:
        payload = serialize_channel_message(message)
        payload["id"] = BotEventDispatcher._coerce_id(payload.get("id"))
        payload["author_id"] = BotEventDispatcher._coerce_id(payload.get("author_id"))
        payload["webhook_id"] = BotEventDispatcher._coerce_id(payload.get("webhook_id"))
        payload["text_channel_id"] = BotEventDispatcher._coerce_id(payload.get("text_channel_id"))
        payload["channelId"] = BotEventDispatcher._coerce_id(payload.get("channelId"))
        payload["reply_to_id"] = BotEventDispatcher._coerce_id(payload.get("reply_to_id"))
        author = payload.get("author")
        if isinstance(author, dict) and author.get("id") is not None:
            author["id"] = BotEventDispatcher._coerce_id(author["id"])
        for attachment in payload.get("attachments", []):
            if attachment.get("id") is not None:
                attachment["id"] = BotEventDispatcher._coerce_id(attachment["id"])
        return payload

    @staticmethod
    def _coerce_delete_payload(payload: dict[str, Any]) -> dict[str, Any]:
        return {key: BotEventDispatcher._coerce_id(value) if isinstance(value, int) else value for key, value in payload.items()}

    @staticmethod
    def _mask_message_payload_for_intent(payload: dict[str, Any], intents: int) -> dict[str, Any]:
        if intents & INTENT_MESSAGE_CONTENT:
            return payload
        output = deepcopy(payload)
        output["content"] = None
        if "embeds" in output:
            output["embeds"] = []
        if output.get("reply_to") and isinstance(output["reply_to"], dict):
            output["reply_to"] = {
                "id": output["reply_to"].get("id"),
                "content": None,
                "is_deleted": output["reply_to"].get("is_deleted"),
                "author": output["reply_to"].get("author"),
            }
        return output

    @staticmethod
    def _ready_payload(session_id: str) -> dict[str, Any]:
        return {
            "op": OP_DISPATCH,
            "t": "READY",
            "s": None,
            "d": {
                "v": 10,
                "session_id": session_id,
                "resume_gateway_url": "/gateway",
            },
        }

    @staticmethod
    def _resumed_payload() -> dict[str, Any]:
        return {
            "op": OP_DISPATCH,
            "t": "RESUMED",
            "s": None,
            "d": {"status": "resumed"},
        }

    @staticmethod
    def _dispatch_payload(event_name: str, data: dict[str, Any], sequence: int) -> dict[str, Any]:
        return {
            "op": OP_DISPATCH,
            "t": event_name,
            "s": sequence,
            "d": data,
        }

    async def _send(self, ws: WebSocket, payload: dict[str, Any]) -> bool:
        try:
            await ws.send_text(json.dumps(payload))
            return True
        except Exception:
            return False

    async def register(
        self,
        application_id: int,
        websocket: WebSocket,
        *,
        session_id: str,
        intents: int,
        sequence: int = 0,
    ) -> _GatewaySessionState:
        state = _GatewaySessionState(
            application_id=application_id,
            session_id=session_id,
            websocket=websocket,
            intents=intents,
            sequence=sequence,
            last_heartbeat=datetime.now(timezone.utc),
        )
        async with self._lock:
            self._sessions[session_id] = state
            self._sessions_by_app.setdefault(application_id, set()).add(session_id)
        return state

    async def unregister(self, session_id: str) -> None:
        async with self._lock:
            state = self._sessions.pop(session_id, None)
            if state is None:
                return
            app_sessions = self._sessions_by_app.get(state.application_id, set())
            app_sessions.discard(session_id)
            if not app_sessions:
                self._sessions_by_app.pop(state.application_id, None)

    async def touch(self, session_id: str) -> None:
        async with self._lock:
            state = self._sessions.get(session_id)
            if state:
                state.last_heartbeat = datetime.now(timezone.utc)

    async def hello(self, websocket: WebSocket) -> None:
        await websocket.send_text(
            json.dumps({
                "op": OP_HELLO,
                "d": {**OP_HELLO_PAYLOAD, "heartbeat_interval": 45000},
            })
        )

    async def heartbeat_ack(self, websocket: WebSocket) -> None:
        await websocket.send_text(json.dumps({"op": OP_HEARTBEAT_ACK, "d": None}))

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
        required_intent: int,
        event_name: str,
        message_payload_filter: bool = False,
    ) -> None:
        if not data:
            return
        payload = None
        async for state in self._iter_session_states(application_id):
            if required_intent and not (state.intents & required_intent):
                continue
            state.sequence += 1
            session_payload = data
            if message_payload_filter:
                session_payload = self._mask_message_payload_for_intent(dict(data), state.intents)
            if payload is None:
                payload = self._dispatch_payload(event_name, session_payload, state.sequence)
            else:
                payload = dict(payload)
                payload["s"] = state.sequence
                payload["d"] = session_payload
            ok = await self._send(state.websocket, payload)
            if not ok:
                await self.unregister(state.session_id)

    async def dispatch_install_create(
        self,
        application_id: int,
        server_id: int,
        *,
        permissions: int,
        intents: int,
        scopes: list[str] | None = None,
    ) -> None:
        event_data = {
            "application_id": str(application_id),
            "guild_id": str(server_id),
            "permissions": str(int(permissions)),
            "intents": str(int(intents)),
            "scopes": scopes or [],
            "status": "active",
        }
        await self._dispatch_to_application(
            application_id,
            event_data,
            required_intent=0,
            event_name="APP_INSTALL_CREATE",
        )

    async def dispatch_install_update(
        self,
        application_id: int,
        server_id: int,
        *,
        permissions: int,
        intents: int,
        scopes: list[str] | None = None,
        status: str = "active",
    ) -> None:
        event_data = {
            "application_id": str(application_id),
            "guild_id": str(server_id),
            "permissions": str(int(permissions)),
            "intents": str(int(intents)),
            "scopes": scopes or [],
            "status": status,
        }
        await self._dispatch_to_application(
            application_id,
            event_data,
            required_intent=0,
            event_name="APP_INSTALL_UPDATE",
        )

    async def dispatch_install_delete(
        self,
        application_id: int,
        server_id: int,
        *,
        reason: str | None = None,
    ) -> None:
        event_data = {
            "application_id": str(application_id),
            "guild_id": str(server_id),
            "status": "removed",
            "reason": reason,
        }
        await self._dispatch_to_application(
            application_id,
            event_data,
            required_intent=0,
            event_name="APP_INSTALL_DELETE",
        )

    async def dispatch_message_create(self, db: AsyncSession, message) -> None:
        serialized = self._coerce_message_payload(message)
        channel = await db.get(TextChannel, message.text_channel_id)
        if not channel:
            return

        installs = await db.execute(
            select(BotInstall.application_id, BotInstall.intents)
            .join(BotApplication, BotApplication.id == BotInstall.application_id)
            .where(
                BotInstall.server_id == channel.channel_id,
                BotInstall.status == "active",
                BotApplication.status == "active",
            )
        )
        rows = installs.all()
        for application_id, install_intents in rows:
            if not install_intents:
                continue
            if not (int(install_intents) & INTENT_GUILD_MESSAGES):
                continue
            event_data = dict(serialized)
            event_data["guild_id"] = str(channel.channel_id)
            await self._dispatch_to_application(
                application_id,
                event_data,
                required_intent=INTENT_GUILD_MESSAGES,
                event_name="MESSAGE_CREATE",
                message_payload_filter=True,
            )

    async def dispatch_message_update(self, db: AsyncSession, message) -> None:
        serialized = self._coerce_message_payload(message)
        channel = await db.get(TextChannel, message.text_channel_id)
        if not channel:
            return

        installs = await db.execute(
            select(BotInstall.application_id, BotInstall.intents)
            .join(BotApplication, BotApplication.id == BotInstall.application_id)
            .where(
                BotInstall.server_id == channel.channel_id,
                BotInstall.status == "active",
                BotApplication.status == "active",
            )
        )
        rows = installs.all()
        for application_id, install_intents in rows:
            if not install_intents:
                continue
            if not (int(install_intents) & INTENT_GUILD_MESSAGES):
                continue
            event_data = dict(serialized)
            event_data["guild_id"] = str(channel.channel_id)
            await self._dispatch_to_application(
                application_id,
                event_data,
                required_intent=INTENT_GUILD_MESSAGES,
                event_name="MESSAGE_UPDATE",
                message_payload_filter=True,
            )

    async def dispatch_message_delete(
        self,
        db: AsyncSession,
        message_id: int,
        channel_id: int,
    ) -> None:
        channel = await db.get(TextChannel, channel_id)
        if not channel:
            return

        installs = await db.execute(
            select(BotInstall.application_id, BotInstall.intents)
            .join(BotApplication, BotApplication.id == BotInstall.application_id)
            .where(
                BotInstall.server_id == channel.channel_id,
                BotInstall.status == "active",
                BotApplication.status == "active",
            )
        )
        rows = installs.all()
        for application_id, install_intents in rows:
            if not install_intents:
                continue
            if not (int(install_intents) & INTENT_GUILD_MESSAGES):
                continue
            event_data = self._coerce_delete_payload({
                "id": message_id,
                "guild_id": str(channel.channel_id),
                "channel_id": str(channel_id),
            })
            await self._dispatch_to_application(
                application_id,
                event_data,
                required_intent=INTENT_GUILD_MESSAGES,
                event_name="MESSAGE_DELETE",
            )

    async def dispatch_interaction_create(self, db: AsyncSession, interaction) -> None:
        # No dedicated intent for interactions in this phase.
        # Keep payload minimal and deliver to installations that enabled basic message intents.
        application_id = interaction.application_id
        install_clause = [
            BotInstall.application_id == application_id,
            BotInstall.status == "active",
            BotApplication.status == "active",
        ]
        if interaction.guild_id:
            install_clause.append(BotInstall.server_id == int(interaction.guild_id))

        installs = await db.execute(
            select(BotInstall.intents)
            .join(BotApplication, BotApplication.id == BotInstall.application_id)
            .where(*install_clause)
        )
        rows = installs.all()
        if not rows:
            return
        install_intents = max(int(item[0] or 0) for item in rows)
        if not (install_intents & INTENT_GUILD_MESSAGES):
            return
        event_data = {
            "id": self._coerce_id(interaction.id if interaction.id else None),
            "application_id": self._coerce_id(interaction.application_id),
            "type": self._coerce_id(interaction.type) if hasattr(interaction, "type") else None,
            "command_id": self._coerce_id(interaction.command_id),
            "channel_id": self._coerce_id(interaction.channel_id) if interaction.channel_id else None,
            "guild_id": self._coerce_id(interaction.guild_id) if interaction.guild_id else None,
            "data": {
                "id": self._coerce_id(interaction.id),
                "application_id": str(application_id),
                "token": self._coerce_id(interaction.interaction_token),
                "version": 1,
                "command_id": self._coerce_id(interaction.command_id),
            },
        }
        await self._dispatch_to_application(
            int(application_id),
            event_data,
            required_intent=INTENT_GUILD_MESSAGES,
            event_name="INTERACTION_CREATE",
        )


dispatcher = BotEventDispatcher()
