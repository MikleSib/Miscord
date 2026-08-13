import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.api import channel_permissions
from app.core.permissions import Permission


def test_my_text_channel_permissions_returns_effective_channel_mask(monkeypatch):
    channel = SimpleNamespace(id=45, channel_id=12)
    user = SimpleNamespace(id=7)
    db = object()
    effective = int(Permission.VIEW_CHANNEL | Permission.READ_MESSAGE_HISTORY)

    get_channel = AsyncMock(return_value=channel)
    is_member = AsyncMock(return_value=True)
    get_effective = AsyncMock(return_value=effective)
    monkeypatch.setattr(channel_permissions, "_get_text_channel", get_channel)
    monkeypatch.setattr(channel_permissions, "is_member", is_member)
    monkeypatch.setattr(channel_permissions, "get_effective_channel_permissions", get_effective)

    result = asyncio.run(channel_permissions.get_my_text_channel_permissions(45, user, db))

    assert result == {"permissions": effective}
    is_member.assert_awaited_once_with(db, 12, 7)
    get_effective.assert_awaited_once_with(db, 12, 7, "text", 45)


def test_my_text_channel_permissions_hides_channel_from_non_member(monkeypatch):
    channel = SimpleNamespace(id=45, channel_id=12)
    monkeypatch.setattr(channel_permissions, "_get_text_channel", AsyncMock(return_value=channel))
    monkeypatch.setattr(channel_permissions, "is_member", AsyncMock(return_value=False))

    with pytest.raises(HTTPException) as raised:
        asyncio.run(channel_permissions.get_my_text_channel_permissions(
            45,
            SimpleNamespace(id=7),
            object(),
        ))

    assert raised.value.status_code == 404


def test_permission_change_notification_is_best_effort(monkeypatch):
    monkeypatch.setattr(
        channel_permissions.manager,
        "send_to_channel",
        AsyncMock(side_effect=RuntimeError("redis unavailable")),
    )

    asyncio.run(channel_permissions._notify_text_permission_change(
        SimpleNamespace(id=45, channel_id=12),
    ))
