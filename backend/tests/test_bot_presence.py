from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import bot_presence
from app.services.bot_event_dispatcher import BotEventDispatcher


@pytest.mark.asyncio
async def test_bot_presence_persists_and_broadcasts_only_transitions(monkeypatch):
    user = SimpleNamespace(
        id=14,
        username="bot",
        display_name="Music Bot",
        is_bot=True,
        is_online=False,
        last_activity=None,
    )
    db = SimpleNamespace(get=AsyncMock(return_value=user), commit=AsyncMock())
    broadcast = AsyncMock()
    monkeypatch.setattr(bot_presence.manager, "broadcast", broadcast)

    assert await bot_presence.set_bot_online(db, user.id, True) is True
    assert user.is_online is True
    assert user.last_activity is not None
    broadcast.assert_awaited_once_with(
        {
            "type": "user_status_changed",
            "data": {
                "user_id": 14,
                "username": "Music Bot",
                "is_online": True,
            },
        }
    )

    assert await bot_presence.set_bot_online(db, user.id, True) is False
    assert broadcast.await_count == 1


@pytest.mark.asyncio
async def test_bot_stays_online_until_its_last_gateway_session_closes():
    dispatcher = BotEventDispatcher()
    websocket = SimpleNamespace()

    first, _ = await dispatcher.register(
        7,
        "client",
        websocket,
        session_id="first",
        intents=0,
    )
    second, _ = await dispatcher.register(
        7,
        "client",
        websocket,
        session_id="second",
        intents=0,
    )

    assert await dispatcher.has_active_sessions(7) is True
    await dispatcher.unregister(first.session_id)
    assert await dispatcher.has_active_sessions(7) is True
    await dispatcher.unregister(second.session_id)
    assert await dispatcher.has_active_sessions(7) is False
