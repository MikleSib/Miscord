from datetime import timedelta
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.bot_voice_sessions import BotVoiceSessionRegistry, _utcnow


@pytest.mark.asyncio
async def test_voice_token_is_scoped_and_never_stored_in_plaintext():
    registry = BotVoiceSessionRegistry()
    session, token = await registry.create(
        application_id=1,
        bot_user_id=2,
        guild_id=3,
        channel_id=4,
        self_mute=False,
        self_deaf=True,
    )

    assert token.startswith("mcv_")
    assert token not in session.token_hash
    assert await registry.validate(
        session_id=session.session_id,
        token=token,
        application_id=1,
        bot_user_id=2,
        guild_id=3,
    ) is session
    assert await registry.validate(
        session_id=session.session_id,
        token=token,
        application_id=99,
    ) is None
    assert await registry.validate(
        session_id=session.session_id,
        token="mcv_wrong",
    ) is None


@pytest.mark.asyncio
async def test_new_session_replaces_previous_application_guild_session():
    registry = BotVoiceSessionRegistry()
    old, old_token = await registry.create(
        application_id=10,
        bot_user_id=20,
        guild_id=30,
        channel_id=40,
        self_mute=False,
        self_deaf=False,
    )
    new, _ = await registry.create(
        application_id=10,
        bot_user_id=20,
        guild_id=30,
        channel_id=41,
        self_mute=False,
        self_deaf=False,
    )

    assert old.session_id != new.session_id
    assert await registry.validate(session_id=old.session_id, token=old_token) is None
    assert await registry.get_for_application_guild(10, 30) is new


@pytest.mark.asyncio
async def test_expired_session_is_rejected():
    registry = BotVoiceSessionRegistry()
    session, token = await registry.create(
        application_id=1,
        bot_user_id=2,
        guild_id=3,
        channel_id=4,
        self_mute=False,
        self_deaf=False,
    )
    session.expires_at = _utcnow() - timedelta(seconds=1)

    assert await registry.validate(session_id=session.session_id, token=token) is None


@pytest.mark.asyncio
async def test_connected_session_state_can_change_without_rotating_credentials():
    registry = BotVoiceSessionRegistry()
    session, token = await registry.create(
        application_id=1,
        bot_user_id=2,
        guild_id=3,
        channel_id=4,
        self_mute=False,
        self_deaf=True,
    )

    updated = await registry.update_state(
        session.session_id,
        self_mute=True,
        self_deaf=False,
    )

    assert updated is session
    assert updated.self_mute is True
    assert updated.self_deaf is False
    assert await registry.validate(session_id=session.session_id, token=token) is session
