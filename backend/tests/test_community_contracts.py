from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.permissions import Permission
from app.schemas.forum import ForumCreate
from app.schemas.poll import PollCreate
from app.schemas.thread import ThreadCreate, ThreadUpdate
from app.services.polls import is_poll_closed
from app.services.server_templates import builtin_templates
from app.services import thread_access
from app.services.forum_post_serializer import _preview


def test_thread_contract_accepts_only_supported_archive_windows() -> None:
    assert ThreadCreate(name=" Public ", auto_archive_minutes=60).name == "Public"
    assert ThreadUpdate(auto_archive_minutes=10080).auto_archive_minutes == 10080
    with pytest.raises(ValidationError):
        ThreadCreate(name="bad", auto_archive_minutes=120)


def test_forum_contract_validates_layout_sort_and_slow_mode() -> None:
    forum = ForumCreate(name="Ideas", default_layout="gallery", default_sort="created_at", slow_mode_seconds=60)
    assert forum.default_layout == "gallery"
    assert forum.slow_mode_seconds == 60
    with pytest.raises(ValidationError):
        ForumCreate(name="Ideas", slow_mode_seconds=17)


def test_forum_preview_is_compact_and_whitespace_safe() -> None:
    assert _preview("  Первая  строка\n\nвторая строка  ") == "Первая строка вторая строка"
    assert _preview("", limit=20) is None
    assert _preview("длинное сообщение для превью", limit=12) == "длинное соо…"


def test_poll_contract_enforces_answers_duration_and_unique_text() -> None:
    poll = PollCreate(
        question="Release?",
        answers=[{"text": "Yes"}, {"text": "No"}],
        duration_seconds=3600,
    )
    assert len(poll.answers) == 2
    with pytest.raises(ValidationError):
        PollCreate(question="Release?", answers=[{"text": "Yes"}, {"text": " yes "}], duration_seconds=3600)
    with pytest.raises(ValidationError):
        PollCreate(question="Release?", answers=[{"text": "Yes"}, {"text": "No"}], duration_seconds=7200)


def test_poll_closes_at_expiry_or_manual_close() -> None:
    now = datetime.now(timezone.utc)
    assert is_poll_closed(SimpleNamespace(expires_at=now - timedelta(seconds=1), closed_at=None), now)
    assert not is_poll_closed(SimpleNamespace(expires_at=now + timedelta(seconds=1), closed_at=None), now)
    assert is_poll_closed(SimpleNamespace(expires_at=now + timedelta(days=1), closed_at=now), now)


def test_builtin_templates_are_versioned_and_exclude_live_resources() -> None:
    templates = builtin_templates()
    assert {item["id"] for item in templates} == {"blank", "community", "gaming", "study", "team"}
    forbidden = {"members", "messages", "threads", "bots", "webhooks", "secrets", "invites", "bans", "audit_log"}
    for template in templates:
        assert template["schema_version"] == 1
        assert not forbidden.intersection(template["definition"])


@pytest.mark.asyncio
async def test_locked_thread_is_read_only_for_non_moderator(monkeypatch: pytest.MonkeyPatch) -> None:
    thread = SimpleNamespace(id=7, archived_at=None, locked=True)
    user = SimpleNamespace(id=10)

    async def get_thread(_db, _thread_id):
        return thread

    async def can_access(_db, _thread, _user):
        return True

    async def context(_db, _thread, _user):
        return SimpleNamespace(owner_id=1), SimpleNamespace(id=2), int(Permission.SEND_MESSAGES_IN_THREADS)

    monkeypatch.setattr(thread_access, "get_thread", get_thread)
    monkeypatch.setattr(thread_access, "can_access_thread", can_access)
    monkeypatch.setattr(thread_access, "_context", context)
    with pytest.raises(HTTPException) as raised:
        await thread_access.require_thread_access(SimpleNamespace(), user, 7, need_send=True)
    assert raised.value.status_code == 403


def test_legacy_human_websockets_are_not_registered() -> None:
    from main import app

    paths = {route.path for route in app.routes}
    assert "/ws/unified" in paths
    assert "/ws/chat/{text_channel_id}" not in paths
    assert "/ws/notifications" not in paths
