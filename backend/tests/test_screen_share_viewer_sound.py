import asyncio
from types import SimpleNamespace

from app.websocket import group_voice


class Manager:
    def __init__(self):
        self.messages = []

    async def send_personal_message(self, payload, user_id):
        self.messages.append((payload, user_id))


def test_viewer_join_is_sent_only_to_active_streamer(monkeypatch):
    async def active_streamer(_user_id):
        return {"channel_id": 55, "is_sharing_screen": True}

    monkeypatch.setattr(group_voice.voice_presence, "get_for_user", active_streamer)
    manager = Manager()
    viewer = SimpleNamespace(id=7, username="viewer", display_name="Viewer")

    sent = asyncio.run(group_voice.notify_screen_share_viewer_joined(
        user=viewer, channel_id=55, streamer_id=9, manager=manager,
    ))

    assert sent is True
    assert manager.messages == [({
        "type": "screen_share_viewer_joined",
        "streamer_id": 9,
        "viewer_id": 7,
        "viewer_username": "Viewer",
    }, 9)]


def test_viewer_join_rejects_inactive_stream(monkeypatch):
    async def inactive_streamer(_user_id):
        return {"channel_id": 55, "is_sharing_screen": False}

    monkeypatch.setattr(group_voice.voice_presence, "get_for_user", inactive_streamer)
    manager = Manager()
    viewer = SimpleNamespace(id=7, username="viewer", display_name=None)

    sent = asyncio.run(group_voice.notify_screen_share_viewer_joined(
        user=viewer, channel_id=55, streamer_id=9, manager=manager,
    ))

    assert sent is False
    assert manager.messages == []
