from __future__ import annotations

import json
import secrets
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

import redis.asyncio as redis

from app.core.config import settings


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class BotVoiceSession:
    application_id: int
    bot_user_id: int
    guild_id: int
    channel_id: int
    session_id: str
    self_mute: bool
    self_deaf: bool
    created_at: datetime

    def to_json(self) -> str:
        payload = asdict(self)
        payload["created_at"] = self.created_at.isoformat()
        return json.dumps(payload)

    @classmethod
    def from_json(cls, raw: str) -> "BotVoiceSession":
        payload = json.loads(raw)
        payload["created_at"] = datetime.fromisoformat(payload["created_at"])
        return cls(**payload)


class BotVoiceSessionRegistry:
    """Redis-backed bot voice routing state; media keys stay in voice-media RAM."""

    def __init__(self) -> None:
        self._client: redis.Redis | None = None

    async def client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.from_url(settings.REDIS_URL, decode_responses=True)
        return self._client

    @staticmethod
    def _session_key(session_id: str) -> str:
        return f"voice:v1:bot:session:{session_id}"

    @staticmethod
    def _guild_key(application_id: int, guild_id: int) -> str:
        return f"voice:v1:bot:route:{application_id}:{guild_id}"

    async def create(
        self,
        *,
        application_id: int,
        bot_user_id: int,
        guild_id: int,
        channel_id: int,
        self_mute: bool,
        self_deaf: bool,
    ) -> BotVoiceSession:
        session = BotVoiceSession(
            application_id=application_id,
            bot_user_id=bot_user_id,
            guild_id=guild_id,
            channel_id=channel_id,
            session_id=secrets.token_urlsafe(24),
            self_mute=self_mute,
            self_deaf=self_deaf,
            created_at=_utcnow(),
        )
        client = await self.client()
        route_key = self._guild_key(application_id, guild_id)
        old_id = await client.get(route_key)
        pipeline = client.pipeline(transaction=True)
        if old_id:
            pipeline.delete(self._session_key(old_id))
        pipeline.set(
            self._session_key(session.session_id),
            session.to_json(),
            ex=settings.VOICE_SESSION_TTL_SECONDS,
        )
        pipeline.set(route_key, session.session_id, ex=settings.VOICE_SESSION_TTL_SECONDS)
        await pipeline.execute()
        return session

    async def get(self, session_id: str) -> BotVoiceSession | None:
        client = await self.client()
        raw = await client.get(self._session_key(session_id))
        return BotVoiceSession.from_json(raw) if raw else None

    async def get_for_application_guild(
        self, application_id: int, guild_id: int,
    ) -> BotVoiceSession | None:
        client = await self.client()
        route_key = self._guild_key(application_id, guild_id)
        session_id = await client.get(route_key)
        if not session_id:
            return None
        session = await self.get(session_id)
        if session is None:
            await client.delete(route_key)
        return session

    async def update_state(
        self,
        session_id: str,
        *,
        self_mute: bool,
        self_deaf: bool,
    ) -> BotVoiceSession | None:
        session = await self.get(session_id)
        if session is None:
            return None
        session.self_mute = self_mute
        session.self_deaf = self_deaf
        client = await self.client()
        ttl = settings.VOICE_SESSION_TTL_SECONDS
        pipeline = client.pipeline(transaction=True)
        pipeline.set(self._session_key(session_id), session.to_json(), ex=ttl)
        pipeline.expire(self._guild_key(session.application_id, session.guild_id), ttl)
        await pipeline.execute()
        return session

    async def revoke(self, application_id: int, guild_id: int) -> BotVoiceSession | None:
        client = await self.client()
        route_key = self._guild_key(application_id, guild_id)
        session_id = await client.get(route_key)
        session = await self.get(session_id) if session_id else None
        pipeline = client.pipeline(transaction=True)
        pipeline.delete(route_key)
        if session_id:
            pipeline.delete(self._session_key(session_id))
        await pipeline.execute()
        return session


registry = BotVoiceSessionRegistry()
