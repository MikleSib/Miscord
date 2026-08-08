import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import WebSocketDisconnect

from app.core.permissions import Permission
from app.services.voice_session import voice_connections
from app.websocket import bot_voice_gateway, unified, voice


@pytest.fixture(autouse=True)
def clear_voice_connections():
    voice_connections.clear()
    yield
    voice_connections.clear()


def test_all_voice_gateways_share_one_connection_registry():
    assert unified.voice_connections is voice_connections
    assert voice.voice_connections is voice_connections
    assert bot_voice_gateway.voice_connections is voice_connections


@pytest.mark.asyncio
async def test_bot_voice_prepare_does_not_accept_websocket_twice(monkeypatch):
    user = SimpleNamespace(id=14, username="bot", display_name="Bot")
    channel = SimpleNamespace(id=6, channel_id=6)
    session = SimpleNamespace(
        session_id="session",
        application_id=4,
        bot_user_id=14,
        guild_id=6,
        channel_id=6,
        self_mute=False,
        self_deaf=True,
    )

    async def get(model, _object_id):
        return user if model is bot_voice_gateway.User else channel

    db = SimpleNamespace(
        get=get,
        scalar=AsyncMock(return_value=1),
        execute=AsyncMock(),
        add=lambda _value: None,
        commit=AsyncMock(),
    )
    manager = SimpleNamespace(
        connect=AsyncMock(side_effect=AssertionError("must not accept twice")),
        register_channel=AsyncMock(),
    )
    monkeypatch.setattr(bot_voice_gateway, "manager", manager)
    monkeypatch.setattr(
        bot_voice_gateway,
        "get_effective_channel_permissions",
        AsyncMock(return_value=int(Permission.CONNECT | Permission.SPEAK)),
    )
    monkeypatch.setattr(bot_voice_gateway, "_force_leave_other_channels", AsyncMock())
    monkeypatch.setattr(bot_voice_gateway, "_replace_same_channel_connection", AsyncMock())
    monkeypatch.setattr(bot_voice_gateway.bot_voice_sessions, "attach", AsyncMock())
    websocket = SimpleNamespace()

    prepared = await bot_voice_gateway._prepare_connection(websocket, db, session)

    assert prepared is not None
    manager.register_channel.assert_awaited_once_with(websocket, 14, -6)
    manager.connect.assert_not_awaited()
    assert voice_connections[6][14]["gateway"] == "bot"


@pytest.mark.asyncio
async def test_bot_signal_is_translated_for_unified_client():
    websocket = SimpleNamespace(send_text=AsyncMock())
    voice_connections[6] = {
        1: {"gateway": "unified", "websocket": websocket},
    }

    await voice._relay_signal(
        6,
        14,
        {"target_id": 1, "answer": {"type": "answer", "sdp": "test"}},
        "answer",
        "answer",
    )

    message = json.loads(websocket.send_text.await_args.args[0])
    assert message["type"] == "voice_answer"
    assert message["from_id"] == 14


@pytest.mark.asyncio
async def test_unified_signal_is_sent_directly_to_bot():
    websocket = SimpleNamespace(send_json=AsyncMock())
    voice_connections[6] = {
        14: {"gateway": "bot", "websocket": websocket},
    }
    manager = SimpleNamespace(send_personal_message=AsyncMock())
    user = SimpleNamespace(id=1)
    offer = {"type": "offer", "sdp": "test"}

    await unified.handle_voice_offer(
        user,
        {"target_user_id": 14, "offer": offer},
        manager,
    )

    websocket.send_json.assert_awaited_once_with(
        {"type": "offer", "from_id": 1, "offer": offer}
    )
    manager.send_personal_message.assert_not_awaited()


@pytest.mark.asyncio
async def test_bot_gateway_commits_read_transaction_without_expiring_user(monkeypatch):
    websocket = SimpleNamespace(query_params={}, accept=AsyncMock())
    user = SimpleNamespace(id=14, username="bot", display_name="Bot")
    channel = SimpleNamespace(id=6, channel_id=6)
    session = SimpleNamespace(
        session_id="session",
        application_id=4,
        bot_user_id=14,
        guild_id=6,
        channel_id=6,
        self_mute=False,
        self_deaf=False,
    )
    db = SimpleNamespace(
        commit=AsyncMock(),
        rollback=AsyncMock(),
        close=AsyncMock(),
    )
    offer = {"type": "offer", "sdp": "test"}
    offer_payload = {"type": "offer", "target_id": 1, "offer": offer}
    receive = AsyncMock(
        side_effect=[
            {"op": 0, "d": {}},
            offer_payload,
            WebSocketDisconnect(),
        ]
    )
    relay = AsyncMock()

    monkeypatch.setattr(bot_voice_gateway, "AsyncSessionLocal", lambda: db)
    monkeypatch.setattr(bot_voice_gateway, "_receive_json", receive)
    monkeypatch.setattr(bot_voice_gateway, "_send", AsyncMock())
    monkeypatch.setattr(
        bot_voice_gateway, "_load_and_validate_session", AsyncMock(return_value=session)
    )
    monkeypatch.setattr(
        bot_voice_gateway,
        "_prepare_connection",
        AsyncMock(return_value=(user, channel, "connection")),
    )
    monkeypatch.setattr(bot_voice_gateway, "_participants", AsyncMock(return_value=[]))
    monkeypatch.setattr(bot_voice_gateway, "_handle_join", AsyncMock())
    monkeypatch.setattr(bot_voice_gateway, "_relay_signal", relay)
    monkeypatch.setattr(bot_voice_gateway, "_cleanup_voice_session", AsyncMock())
    monkeypatch.setattr(bot_voice_gateway.bot_voice_sessions, "detach", AsyncMock())

    await bot_voice_gateway.websocket_bot_voice_gateway_endpoint(websocket)

    db.commit.assert_awaited_once()
    db.rollback.assert_not_awaited()
    relay.assert_awaited_once_with(6, 14, offer_payload, "offer", "offer")


@pytest.mark.asyncio
async def test_closed_bot_voice_socket_does_not_disconnect_unified_client():
    websocket = SimpleNamespace(
        send_json=AsyncMock(side_effect=RuntimeError("voice socket is closed"))
    )
    voice_connections[6] = {
        14: {"gateway": "bot", "websocket": websocket},
    }
    manager = SimpleNamespace(send_personal_message=AsyncMock())

    await unified.handle_voice_offer(
        SimpleNamespace(id=1),
        {"target_user_id": 14, "offer": {"type": "offer", "sdp": "test"}},
        manager,
    )

    websocket.send_json.assert_awaited_once()
    manager.send_personal_message.assert_not_awaited()
