from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


VOICE_SESSION_TTL_SECONDS = 120


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass
class BotVoiceSession:
    application_id: int
    bot_user_id: int
    guild_id: int
    channel_id: int
    session_id: str
    token_hash: str
    self_mute: bool
    self_deaf: bool
    created_at: datetime
    expires_at: datetime
    websocket: Any | None = None

    @property
    def expired(self) -> bool:
        return self.expires_at <= _utcnow()


class BotVoiceSessionRegistry:
    """Ephemeral voice credentials shared by the main and voice gateways.

    Voice tokens are intentionally stored as hashes. A token is scoped to one
    application, bot user, server, channel and session, and expires quickly.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, BotVoiceSession] = {}
        self._by_application_guild: dict[tuple[int, int], str] = {}
        self._lock = asyncio.Lock()

    async def create(
        self,
        *,
        application_id: int,
        bot_user_id: int,
        guild_id: int,
        channel_id: int,
        self_mute: bool,
        self_deaf: bool,
    ) -> tuple[BotVoiceSession, str]:
        session_id = secrets.token_urlsafe(24)
        token = f"mcv_{secrets.token_urlsafe(32)}"
        now = _utcnow()
        session = BotVoiceSession(
            application_id=application_id,
            bot_user_id=bot_user_id,
            guild_id=guild_id,
            channel_id=channel_id,
            session_id=session_id,
            token_hash=_hash_token(token),
            self_mute=self_mute,
            self_deaf=self_deaf,
            created_at=now,
            expires_at=now + timedelta(seconds=VOICE_SESSION_TTL_SECONDS),
        )
        old_socket = None
        async with self._lock:
            self._drop_expired_locked(now)
            key = (application_id, guild_id)
            old_id = self._by_application_guild.get(key)
            if old_id:
                old = self._sessions.pop(old_id, None)
                old_socket = old.websocket if old else None
            self._sessions[session_id] = session
            self._by_application_guild[key] = session_id
        if old_socket is not None:
            try:
                await old_socket.close(code=4000, reason="Voice session replaced")
            except Exception:
                pass
        return session, token

    async def validate(
        self,
        *,
        session_id: str,
        token: str,
        application_id: int | None = None,
        bot_user_id: int | None = None,
        guild_id: int | None = None,
    ) -> BotVoiceSession | None:
        now = _utcnow()
        async with self._lock:
            self._drop_expired_locked(now)
            session = self._sessions.get(session_id)
            if session is None:
                return None
            if application_id is not None and session.application_id != application_id:
                return None
            if bot_user_id is not None and session.bot_user_id != bot_user_id:
                return None
            if guild_id is not None and session.guild_id != guild_id:
                return None
            if not hmac.compare_digest(session.token_hash, _hash_token(token)):
                return None
            session.expires_at = now + timedelta(seconds=VOICE_SESSION_TTL_SECONDS)
            return session

    async def attach(self, session_id: str, websocket: Any) -> BotVoiceSession | None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session.expired:
                return None
            old_socket = session.websocket
            session.websocket = websocket
            session.expires_at = _utcnow() + timedelta(seconds=VOICE_SESSION_TTL_SECONDS)
        if old_socket is not None and old_socket is not websocket:
            try:
                await old_socket.close(code=4000, reason="Voice connection replaced")
            except Exception:
                pass
        return session

    async def touch(self, session_id: str) -> bool:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session.expired:
                return False
            session.expires_at = _utcnow() + timedelta(seconds=VOICE_SESSION_TTL_SECONDS)
            return True

    async def update_state(
        self,
        session_id: str,
        *,
        self_mute: bool,
        self_deaf: bool,
    ) -> BotVoiceSession | None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is None or session.expired:
                return None
            session.self_mute = self_mute
            session.self_deaf = self_deaf
            session.expires_at = _utcnow() + timedelta(seconds=VOICE_SESSION_TTL_SECONDS)
            return session

    async def detach(self, session_id: str, websocket: Any) -> None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session is not None and session.websocket is websocket:
                session.websocket = None
                session.expires_at = _utcnow() + timedelta(seconds=VOICE_SESSION_TTL_SECONDS)

    async def get_for_application_guild(
        self, application_id: int, guild_id: int
    ) -> BotVoiceSession | None:
        now = _utcnow()
        async with self._lock:
            self._drop_expired_locked(now)
            session_id = self._by_application_guild.get((application_id, guild_id))
            return self._sessions.get(session_id) if session_id else None

    async def revoke(self, application_id: int, guild_id: int) -> BotVoiceSession | None:
        socket = None
        async with self._lock:
            session_id = self._by_application_guild.pop((application_id, guild_id), None)
            session = self._sessions.pop(session_id, None) if session_id else None
            socket = session.websocket if session else None
        if socket is not None:
            try:
                await socket.close(code=4000, reason="Voice session revoked")
            except Exception:
                pass
        return session

    def _drop_expired_locked(self, now: datetime) -> None:
        expired = [session_id for session_id, item in self._sessions.items() if item.expires_at <= now]
        for session_id in expired:
            item = self._sessions.pop(session_id)
            key = (item.application_id, item.guild_id)
            if self._by_application_guild.get(key) == session_id:
                self._by_application_guild.pop(key, None)


registry = BotVoiceSessionRegistry()
