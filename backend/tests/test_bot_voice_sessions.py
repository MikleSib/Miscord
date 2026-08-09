import pytest

from app.services.bot_voice_sessions import BotVoiceSessionRegistry


@pytest.fixture
def registry():
    return BotVoiceSessionRegistry()


@pytest.mark.asyncio
async def test_bot_voice_session_is_stored_and_resolved_through_redis(registry):
    session = await registry.create(
        application_id=901,
        bot_user_id=902,
        guild_id=903,
        channel_id=904,
        self_mute=False,
        self_deaf=True,
    )
    try:
        loaded = await registry.get_for_application_guild(901, 903)
        assert loaded is not None
        assert loaded.session_id == session.session_id
        assert loaded.channel_id == 904
        assert loaded.self_deaf is True
    finally:
        await registry.revoke(901, 903)


@pytest.mark.asyncio
async def test_replacing_route_removes_previous_session(registry):
    first = await registry.create(
        application_id=911,
        bot_user_id=912,
        guild_id=913,
        channel_id=914,
        self_mute=False,
        self_deaf=False,
    )
    second = await registry.create(
        application_id=911,
        bot_user_id=912,
        guild_id=913,
        channel_id=915,
        self_mute=True,
        self_deaf=False,
    )
    try:
        assert await registry.get(first.session_id) is None
        loaded = await registry.get_for_application_guild(911, 913)
        assert loaded is not None and loaded.session_id == second.session_id
    finally:
        await registry.revoke(911, 913)


@pytest.mark.asyncio
async def test_update_and_revoke_cleanup(registry):
    session = await registry.create(
        application_id=921,
        bot_user_id=922,
        guild_id=923,
        channel_id=924,
        self_mute=False,
        self_deaf=False,
    )
    updated = await registry.update_state(
        session.session_id,
        self_mute=True,
        self_deaf=True,
    )
    assert updated is not None and updated.self_mute and updated.self_deaf
    removed = await registry.revoke(921, 923)
    assert removed is not None and removed.session_id == session.session_id
    assert await registry.get(session.session_id) is None
