import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from app.schemas.user import RelationshipUser
from app.services.direct_message_service import get_conversations, hide_conversation


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows


class _Database:
    def __init__(self, rows):
        self.rows = rows

    async def execute(self, _statement):
        return _Result(self.rows)


class _ScalarResult:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _HideDatabase:
    def __init__(self, message_id):
        self.message_id = message_id
        self.statements = []
        self.commits = 0

    async def execute(self, statement):
        self.statements.append(statement)
        if len(self.statements) == 1:
            return _ScalarResult(self.message_id)
        return _ScalarResult(None)

    async def commit(self):
        self.commits += 1


def test_conversation_payload_is_public():
    now = datetime.now(timezone.utc)
    peer = SimpleNamespace(
        id=2,
        username="peer",
        email="peer@example.com",
        display_name="Peer",
        avatar_url=None,
        is_active=True,
        is_online=False,
        is_bot=False,
        created_at=now,
        updated_at=now,
        email_verified_at=now,
    )

    payload = asyncio.run(get_conversations(_Database([(peer, now)]), 1))[0]

    assert "email" not in payload
    assert RelationshipUser.model_validate(payload).id == peer.id


def test_hide_conversation_persists_for_existing_dialog():
    database = _HideDatabase(message_id=42)

    hidden = asyncio.run(hide_conversation(database, user_id=1, peer_id=2))

    assert hidden is True
    assert len(database.statements) == 2
    assert database.commits == 1


def test_hide_conversation_rejects_missing_dialog():
    database = _HideDatabase(message_id=None)

    hidden = asyncio.run(hide_conversation(database, user_id=1, peer_id=2))

    assert hidden is False
    assert len(database.statements) == 1
    assert database.commits == 0
