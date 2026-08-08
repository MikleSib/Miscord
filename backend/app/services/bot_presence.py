from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from app.websocket.connection_manager import manager


async def set_bot_online(
    db: AsyncSession,
    bot_user_id: int,
    is_online: bool,
) -> bool:
    """Persist and broadcast a bot's Gateway-backed online state.

    Human presence is driven by the app websocket activity service. Bot
    presence is instead owned by authenticated Bot Gateway sessions.
    """
    user = await db.get(User, bot_user_id)
    if user is None or not bool(user.is_bot):
        return False

    changed = bool(user.is_online) != is_online
    user.is_online = is_online
    if is_online:
        user.last_activity = datetime.now(timezone.utc)
    await db.commit()

    if changed:
        await manager.broadcast(
            {
                "type": "user_status_changed",
                "data": {
                    "user_id": user.id,
                    "username": user.display_name or user.username,
                    "is_online": is_online,
                },
            }
        )
    return changed
