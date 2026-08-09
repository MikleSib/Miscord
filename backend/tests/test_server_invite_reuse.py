from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.api import servers
from app.schemas.server import InviteCreate
from app.services.server_invites import invite_matches_reuse_request


NOW = datetime(2026, 8, 9, 12, 0, tzinfo=timezone.utc)
SEVEN_DAYS = 7 * 24 * 60 * 60


def invite(**overrides):
    values = {
        "id": 1,
        "code": "stable-code",
        "server_id": 123,
        "inviter_id": 7,
        "target_text_channel_id": None,
        "max_uses": None,
        "uses": 0,
        "created_at": NOW - timedelta(days=1),
        "expires_at": NOW + timedelta(days=6),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def matches(item, *, max_age=SEVEN_DAYS, max_uses=None):
    return invite_matches_reuse_request(
        item,
        max_age_seconds=max_age,
        max_uses=max_uses,
        now=NOW,
    )


def test_invite_create_reuses_by_default_and_can_force_unique():
    assert InviteCreate().unique is False
    assert InviteCreate(unique=True).unique is True


def test_same_active_invite_is_reusable():
    assert matches(invite()) is True


@pytest.mark.parametrize(
    "candidate,max_age,max_uses",
    [
        (invite(expires_at=NOW - timedelta(seconds=1)), SEVEN_DAYS, None),
        (invite(max_uses=3, uses=3), SEVEN_DAYS, 3),
        (invite(expires_at=NOW + timedelta(hours=1)), SEVEN_DAYS, None),
        (invite(max_uses=2), SEVEN_DAYS, 3),
        (invite(expires_at=None), SEVEN_DAYS, None),
        (invite(expires_at=NOW + timedelta(days=6)), 0, None),
    ],
)
def test_incompatible_invite_is_not_reused(candidate, max_age, max_uses):
    assert matches(candidate, max_age=max_age, max_uses=max_uses) is False


def test_permanent_invite_reuses_only_for_permanent_request():
    assert matches(invite(expires_at=None), max_age=0) is True


@pytest.mark.asyncio
async def test_server_route_returns_reusable_invite_without_database_write(monkeypatch):
    existing = invite()
    current_user = SimpleNamespace(
        id=7,
        display_name="Misha",
        username="misha",
        avatar_url=None,
    )
    db = SimpleNamespace(add=AsyncMock(), commit=AsyncMock(), refresh=AsyncMock())
    find_reusable = AsyncMock(return_value=existing)

    monkeypatch.setattr(
        servers,
        "require_membership",
        AsyncMock(return_value=SimpleNamespace(is_public=True)),
    )
    monkeypatch.setattr(servers, "find_reusable_invite", find_reusable)

    response = await servers.create_server_invite(
        123,
        InviteCreate(max_age_seconds=SEVEN_DAYS),
        current_user,
        db,
    )

    assert response["code"] == "stable-code"
    find_reusable.assert_awaited_once()
    db.add.assert_not_called()
    db.commit.assert_not_awaited()
