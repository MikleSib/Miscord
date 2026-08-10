import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.api import channels_voice_moderation as moderation
from app.core.permissions import Permission


def test_effective_voice_state_keeps_self_and_server_reasons_independent():
    assert moderation._effective_state({
        "self_muted": False,
        "server_muted": True,
        "self_deafened": True,
        "server_deafened": False,
    }) == (True, True)
    assert moderation._effective_state({
        "self_muted": False,
        "server_muted": False,
        "self_deafened": False,
        "server_deafened": False,
    }) == (False, False)


def test_move_target_requires_view_and_connect_permissions():
    both = int(Permission.VIEW_CHANNEL | Permission.CONNECT)
    assert moderation._can_connect(both)
    assert not moderation._can_connect(int(Permission.VIEW_CHANNEL))
    assert not moderation._can_connect(int(Permission.CONNECT))


def test_authorize_checks_exact_voice_permission_and_role_hierarchy(monkeypatch):
    effective_permissions = AsyncMock(return_value=int(Permission.MUTE_MEMBERS))
    require_hierarchy = AsyncMock()
    monkeypatch.setattr(moderation, "get_effective_channel_permissions", effective_permissions)
    monkeypatch.setattr(moderation, "require_hierarchy", require_hierarchy)
    actor = SimpleNamespace(id=11)
    channel = SimpleNamespace(id=88, channel_id=77)
    db = object()

    asyncio.run(moderation._authorize(db, channel, actor, 22, Permission.MUTE_MEMBERS))

    effective_permissions.assert_awaited_once_with(db, 77, actor.id, "voice", channel.id)
    assert require_hierarchy.await_args.args[1:] == (77, actor, 22)
