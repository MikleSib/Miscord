import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic import ValidationError

from app.api.safety import AutoModPayload
from app.api.server_features import EventPayload
from app.core.security import create_access_token, decode_access_token
from app.services.account_security import new_totp_secret, verify_totp, _totp
from app.services.communication_safety import _matches
from app.services.direct_message_service import DirectMessageReplyError, require_reply_in_conversation


def test_user_access_token_has_session_and_v1_security_claims():
    token = create_access_token({"sub": "42", "sid": "session-42"})
    payload = decode_access_token(token)
    assert payload is not None
    assert payload["sub"] == "42"
    assert payload["sid"] == "session-42"
    assert payload["iss"] == "miscord-api-v1"
    assert payload["aud"] == "miscord-user"
    assert payload["jti"]


def test_dm_reply_rejects_message_outside_conversation():
    result = MagicMock()
    result.scalar_one_or_none.return_value = None
    db = SimpleNamespace(execute=AsyncMock(return_value=result))
    with pytest.raises(DirectMessageReplyError):
        asyncio.run(require_reply_in_conversation(db, 999, 1, 2))


def test_dm_reply_without_target_needs_no_query():
    db = SimpleNamespace(execute=AsyncMock())
    asyncio.run(require_reply_in_conversation(db, None, 1, 2))
    db.execute.assert_not_awaited()


@pytest.mark.parametrize(
    ("trigger", "config", "content", "matches"),
    [
        ("keyword", {"keywords": ["bad word"]}, "A BAD WORD here", True),
        ("mention_spam", {"max_mentions": 2}, "<@1> <@2> <@3>", True),
        ("link", {"allow_links": False}, "https://example.test", True),
        ("spam", {}, "aaaaaaaaaaaa", True),
        ("keyword", {"keywords": ["bad word"]}, "ordinary message", False),
    ],
)
def test_automod_triggers_are_deterministic(trigger, config, content, matches):
    rule = SimpleNamespace(trigger_type=trigger, config=config)
    assert (_matches(rule, content) is not None) is matches


def test_automod_actions_are_bounded_and_normalized():
    payload = AutoModPayload(
        name="Links", trigger_type="link", config={"allow_links": False},
        actions=[{"type": "block_message"}, {"type": "timeout", "duration_seconds": 999_999_999}],
    )
    assert payload.actions[1]["duration_seconds"] == 2_419_200
    with pytest.raises(ValidationError):
        AutoModPayload(name="Bad", trigger_type="spam", actions=[{"type": "unknown"}])


def test_totp_accepts_current_window_and_rejects_invalid_code():
    secret = new_totp_secret()
    now = 1_800_000_000
    current = _totp(secret, now // 30)
    assert verify_totp(secret, current, at=now)
    assert not verify_totp(secret, "000000" if current != "000000" else "000001", at=now)


def test_scheduled_event_rejects_end_before_start():
    start = datetime.now(timezone.utc) + timedelta(hours=2)
    with pytest.raises(ValidationError):
        EventPayload(
            name="Meeting", entity_type="external", location="Online",
            scheduled_start_at=start, scheduled_end_at=start - timedelta(minutes=1),
        )
