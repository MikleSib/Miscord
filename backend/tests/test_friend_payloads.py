import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from app.schemas.user import User as UserSchema
from app.services.friend_service import get_friends, get_pending_requests


class _ScalarResult:
    def __init__(self, values):
        self.values = values

    def unique(self):
        return self

    def scalars(self):
        return self

    def all(self):
        return self.values

    def scalar_one_or_none(self):
        return self.values


class _Database:
    def __init__(self, results):
        self.results = iter(results)

    async def execute(self, _statement):
        return _ScalarResult(next(self.results))


def _user(user_id: int):
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=user_id,
        username=f'user{user_id}',
        email=f'user{user_id}@example.com',
        display_name=None,
        avatar_url=None,
        is_active=True,
        is_online=False,
        is_bot=False,
        created_at=now,
        updated_at=now,
        email_verified_at=now,
    )


def test_pending_friend_payload_includes_required_verification_timestamp():
    sender = _user(2)
    request = SimpleNamespace(id=8, user_a=sender, created_at=sender.created_at)

    payload = asyncio.run(get_pending_requests(_Database([[request]]), 1))[0]

    assert payload['email_verified_at'] == sender.email_verified_at
    assert UserSchema.model_validate(payload).id == sender.id


def test_friend_payload_includes_required_verification_timestamp():
    friend = _user(2)
    friendship = SimpleNamespace(
        user_a_id=1,
        user_b_id=2,
        user_a=_user(1),
        user_b=friend,
        created_at=friend.created_at,
    )

    payload = asyncio.run(get_friends(_Database([[friendship], None]), 1))[0]

    assert payload['email_verified_at'] == friend.email_verified_at
    assert UserSchema.model_validate(payload).id == friend.id
