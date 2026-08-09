from __future__ import annotations

import json
import uuid
from typing import Any

import redis.asyncio as redis

from app.core.config import settings


class VoicePresenceRegistry:
    """Redis-backed authoritative voice presence for Miscord Voice v1."""

    def __init__(self) -> None:
        self._client: redis.Redis | None = None

    async def client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.from_url(settings.REDIS_URL, decode_responses=True)
        return self._client

    @staticmethod
    def _session_key(session_id: str) -> str:
        return f"voice:v1:session:{session_id}"

    @staticmethod
    def _user_key(user_id: int) -> str:
        return f"voice:v1:user:{user_id}"

    @staticmethod
    def _channel_key(channel_id: int) -> str:
        return f"voice:v1:channel:{channel_id}"

    @staticmethod
    def _room_epoch_key(channel_id: int) -> str:
        return f"voice:v1:room:{channel_id}:epoch"

    async def room_epoch(self, channel_id: int) -> str:
        client = await self.client()
        key = self._room_epoch_key(channel_id)
        candidate = uuid.uuid4().hex
        await client.set(key, candidate, ex=settings.VOICE_SESSION_TTL_SECONDS, nx=True)
        epoch = await client.get(key)
        await client.expire(key, settings.VOICE_SESSION_TTL_SECONDS)
        return str(epoch or candidate)

    async def register(self, payload: dict[str, Any]) -> None:
        client = await self.client()
        session_id = str(payload["session_id"])
        user_id = int(payload["user_id"])
        channel_id = int(payload["channel_id"])
        previous_id = await client.get(self._user_key(user_id))
        if previous_id and previous_id != session_id:
            await self.remove(previous_id)
        ttl = settings.VOICE_SESSION_TTL_SECONDS
        pipeline = client.pipeline(transaction=True)
        pipeline.set(self._session_key(session_id), json.dumps(payload), ex=ttl)
        pipeline.set(self._user_key(user_id), session_id, ex=ttl)
        pipeline.sadd(self._channel_key(channel_id), session_id)
        pipeline.expire(self._channel_key(channel_id), ttl)
        pipeline.expire(self._room_epoch_key(channel_id), ttl)
        await pipeline.execute()

    async def touch(self, session_id: str) -> bool:
        client = await self.client()
        raw = await client.get(self._session_key(session_id))
        if not raw:
            return False
        payload = json.loads(raw)
        ttl = settings.VOICE_SESSION_TTL_SECONDS
        pipeline = client.pipeline(transaction=True)
        pipeline.expire(self._session_key(session_id), ttl)
        pipeline.expire(self._user_key(int(payload["user_id"])), ttl)
        pipeline.expire(self._channel_key(int(payload["channel_id"])), ttl)
        pipeline.expire(self._room_epoch_key(int(payload["channel_id"])), ttl)
        await pipeline.execute()
        return True

    async def update(self, session_id: str, **fields: Any) -> dict[str, Any] | None:
        client = await self.client()
        raw = await client.get(self._session_key(session_id))
        if not raw:
            return None
        payload = json.loads(raw)
        payload.update(fields)
        await self.register(payload)
        return payload

    async def remove(self, session_id: str) -> dict[str, Any] | None:
        client = await self.client()
        raw = await client.get(self._session_key(session_id))
        if not raw:
            return None
        payload = json.loads(raw)
        user_id = int(payload["user_id"])
        channel_id = int(payload["channel_id"])
        pipeline = client.pipeline(transaction=True)
        pipeline.delete(self._session_key(session_id))
        pipeline.srem(self._channel_key(channel_id), session_id)
        current_user_session = await client.get(self._user_key(user_id))
        if current_user_session == session_id:
            pipeline.delete(self._user_key(user_id))
        await pipeline.execute()
        if await client.scard(self._channel_key(channel_id)) == 0:
            await client.delete(self._channel_key(channel_id), self._room_epoch_key(channel_id))
        return payload

    async def participants(self, channel_id: int) -> list[dict[str, Any]]:
        client = await self.client()
        session_ids = list(await client.smembers(self._channel_key(channel_id)))
        if not session_ids:
            return []
        values = await client.mget([self._session_key(value) for value in session_ids])
        participants: list[dict[str, Any]] = []
        stale: list[str] = []
        for session_id, raw in zip(session_ids, values):
            if raw:
                participants.append(json.loads(raw))
            else:
                stale.append(session_id)
        if stale:
            await client.srem(self._channel_key(channel_id), *stale)
        return participants

    async def get_for_user(self, user_id: int) -> dict[str, Any] | None:
        client = await self.client()
        session_id = await client.get(self._user_key(user_id))
        if not session_id:
            return None
        raw = await client.get(self._session_key(session_id))
        return json.loads(raw) if raw else None


voice_presence = VoicePresenceRegistry()
