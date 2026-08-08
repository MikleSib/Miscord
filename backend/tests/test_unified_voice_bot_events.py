from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.websocket import unified


class _Result:
    def __init__(self, *, scalar=None, scalars=None, rowcount=0):
        self._scalar = scalar
        self._scalars = scalars or []
        self.rowcount = rowcount

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return SimpleNamespace(all=lambda: self._scalars)


@pytest.mark.asyncio
async def test_unified_voice_join_dispatches_gateway_voice_state(monkeypatch):
    voice_channel = SimpleNamespace(id=9, channel_id=6, max_users=0, name="General")
    results = iter(
        [
            _Result(scalar=voice_channel),
            _Result(rowcount=0),
            _Result(scalars=[]),
        ]
    )
    db = SimpleNamespace(
        execute=AsyncMock(side_effect=lambda *_args, **_kwargs: next(results)),
        commit=AsyncMock(),
        add=lambda _value: None,
    )
    websocket = SimpleNamespace(send_text=AsyncMock())
    manager = SimpleNamespace(register_channel=AsyncMock(), broadcast=AsyncMock())
    user = SimpleNamespace(id=1, username="misha", display_name="misha", avatar_url=None)
    dispatch = AsyncMock()
    monkeypatch.setattr(unified, "_dispatch_bot_voice_state", dispatch)
    monkeypatch.setattr(
        "app.services.channel_access.user_can_access_voice_channel",
        AsyncMock(return_value=True),
    )
    connections = {}

    channel_id, connection_id = await unified.handle_join_voice(
        user,
        {"voice_channel_id": 9, "is_muted": False, "is_deafened": True},
        db,
        websocket,
        123,
        manager,
        connections,
    )

    assert channel_id == 9
    assert connection_id
    dispatch.assert_awaited_once_with(
        db,
        guild_id=6,
        channel_id=9,
        user_id=1,
        session_id=connection_id,
        self_mute=False,
        self_deaf=True,
    )
