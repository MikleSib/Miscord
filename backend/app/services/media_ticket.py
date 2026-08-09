from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
from typing import Any
from urllib.parse import urlsplit

from jose import jwt

from app.core.config import settings


def _signing_secret() -> str:
    return settings.VOICE_MEDIA_JWT_SECRET or settings.SECRET_KEY


def media_ws_url() -> str:
    configured = settings.VOICE_MEDIA_WS_URL.strip()
    if configured:
        return configured
    parsed = urlsplit(settings.SERVER_HOST.rstrip("/"))
    scheme = "wss" if parsed.scheme == "https" else "ws"
    host = parsed.netloc or parsed.path
    return f"{scheme}://{host}/ws/media"


def create_media_ticket(
    *,
    user_id: int,
    channel_id: int,
    session_id: str,
    room_epoch: str,
    username: str,
    display_name: str | None,
    avatar_url: str | None,
    is_bot: bool = False,
    application_id: int | None = None,
    guild_id: int | None = None,
    self_mute: bool = False,
    self_deaf: bool = False,
    can_speak: bool = True,
) -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=settings.VOICE_MEDIA_TICKET_TTL_SECONDS)
    jti = secrets.token_urlsafe(24)
    payload: dict[str, Any] = {
        "iss": "miscord-api-v1",
        "aud": settings.VOICE_MEDIA_AUDIENCE,
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
        "jti": jti,
        "protocol_version": 1,
        "channel_id": channel_id,
        "session_id": session_id,
        "room_epoch": room_epoch,
        "username": username,
        "display_name": display_name,
        "avatar_url": avatar_url,
        "is_bot": is_bot,
        "self_mute": self_mute,
        "self_deaf": self_deaf,
        "can_speak": can_speak,
    }
    if application_id is not None:
        payload["application_id"] = application_id
    if guild_id is not None:
        payload["guild_id"] = guild_id
    return jwt.encode(payload, _signing_secret(), algorithm="HS256"), jti
