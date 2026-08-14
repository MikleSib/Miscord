from __future__ import annotations

import asyncio
import json
import logging

from app.services.voice_presence import voice_presence
from app.services.bot_voice_sessions import registry as bot_voice_sessions

logger = logging.getLogger(__name__)


async def publish_stage_command(session_id: str, **fields: object) -> None:
    """Apply a Stage role/disconnect change to an active media session."""
    try:
        client = await voice_presence.client()
        await client.publish(
            "voice:v1:human:moderate",
            json.dumps({"session_id": session_id, **fields}),
        )
    except Exception:
        logger.exception("Could not publish Stage media command", extra={"session_id": session_id})


async def _revoke_bot_stage_session(item: dict, client) -> None:
    application_id = item.get("application_id")
    guild_id = item.get("guild_id")
    if not item.get("is_bot") or application_id is None or guild_id is None:
        return
    try:
        await bot_voice_sessions.revoke(int(application_id), int(guild_id))
        await client.publish("voice:v1:bot:revoke", str(item["session_id"]))
    except Exception:
        logger.exception("Could not revoke Stage bot session", extra={"session_id": item.get("session_id")})


async def disconnect_stage_participants(channel_id: int) -> None:
    """Revoke every human media session after a Stage instance is ended."""
    try:
        participants = await voice_presence.participants(channel_id)
    except Exception:
        logger.exception("Could not enumerate Stage participants", extra={"channel_id": channel_id})
        return
    await asyncio.gather(*(
        publish_stage_command(str(item["session_id"]), disconnect=True)
        for item in participants
    ))
    client = await voice_presence.client()
    await asyncio.gather(*(
        _revoke_bot_stage_session(item, client) for item in participants
    ))
    await asyncio.gather(*(
        voice_presence.remove(str(item["session_id"]))
        for item in participants
    ), return_exceptions=True)
