from fastapi import WebSocket, WebSocketDisconnect, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import json
import asyncio
from typing import Dict, Optional, Any
from datetime import datetime, timezone

from app.db.database import AsyncSessionLocal
from app.models import (
    User,
    Message,
    TextChannel,
    Attachment,
    Reaction,
)
from app.core.security import decode_access_token
from app.websocket.connection_manager import manager
from app.services.user_activity_service import user_activity_service
from app.services.text_channel_visibility import get_visible_text_channel
from app.services.slow_mode import check_slow_mode
from app.services.rate_limit import enforce_message_antispam, rate_limit_payload
from app.services.mentions import notify_message_mentions
from app.services.message_notifications import notify_channel_message_activity
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.websocket.unified_dm import handle_dm_message, send_message_failure
from app.websocket.group_voice import (
    join_voice as join_group_voice,
    leave_voice as leave_group_voice,
    refresh_ticket as refresh_group_voice_ticket,
    notify_screen_share_viewer_joined,
    update_voice_state as update_group_voice_state,
    broadcast_voice,
)
from app.services.voice_presence import voice_presence
from app.core.config import settings
from app.services.user_sessions import is_session_active
from app.schemas.poll import PollCreate
from app.services.polls import create_poll_for_message, require_poll_permission, serialize_poll
from app.services.notifications import create_notification
from app.services.channel_access import user_can_access_text_channel


voice_connections: Dict[int, Dict[int, dict]] = {}


def _extract_request_id(message_data: dict) -> Optional[str]:
    request_id = message_data.get("request_id")
    return str(request_id) if request_id is not None else None


def _structured_log(user: Optional[User], event: str, **fields: Any) -> None:
    payload = {
        "source": "unified_ws",
        "event": event,
    }
    if user:
        payload["user_id"] = user.id
        payload["username"] = getattr(user, "username", None)
    payload.update({k: v for k, v in fields.items() if v is not None})
    print(f"[UnifiedWS] {json.dumps(payload, ensure_ascii=False)}")


def _voice_debug_metrics() -> dict:
    return {
        "protocol_version": 1,
        "transport": "sfu",
        "active_channels": len(voice_connections),
        "active_sessions": sum(
            len(users) for users in voice_connections.values()
        ),
    }


async def get_user_by_token_ws(token: str, db: AsyncSession) -> Optional[User]:
    try:
        payload = decode_access_token(token)
        if not payload:
            return None

        user_id = payload.get("sub")
        session_id = payload.get("sid")
        if not user_id or not isinstance(session_id, str):
            return None

        if not await is_session_active(db, session_id, int(user_id)):
            return None

        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        return user if user and user.is_active else None
    except Exception as e:
        print(f"[UnifiedWS] auth error: {e}")
        return None

__all__ = [name for name in globals() if not name.startswith('__')]
