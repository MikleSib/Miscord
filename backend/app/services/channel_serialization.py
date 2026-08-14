from __future__ import annotations

from typing import Any


def voice_channel_payload(channel: Any) -> dict[str, Any]:
    """Serialize voice and Stage channels consistently for every server payload."""
    return {
        "id": channel.id,
        "name": channel.name,
        "type": "voice",
        "kind": getattr(channel, "kind", None) or "voice",
        "position": channel.position,
        "category_id": getattr(channel, "category_id", None),
        "max_users": getattr(channel, "max_users", 0) or 0,
        "bitrate": int(getattr(channel, "bitrate", 64) or 64),
        "video_quality": getattr(channel, "video_quality", None) or "auto",
        "created_at": getattr(channel, "created_at", None),
    }
