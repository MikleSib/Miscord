import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from app.schemas.user import User as UserSchema
from app.services.direct_message_service import get_conversations


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


def test_conversation_payload_includes_required_verification_timestamp():
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

    assert payload["email_verified_at"] == now
    assert UserSchema.model_validate(payload).id == peer.id
