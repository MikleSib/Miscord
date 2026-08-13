import asyncio

from starlette.websockets import WebSocketDisconnect

from app.websocket import unified


class _Database:
    closed = False

    async def close(self):
        self.closed = True


class _DisconnectedSocket:
    accepted = False
    close_calls = 0

    async def accept(self):
        self.accepted = True

    async def receive_text(self):
        raise WebSocketDisconnect(code=1001)

    async def close(self, **_kwargs):
        self.close_calls += 1


def test_disconnect_during_identify_does_not_send_a_second_close(monkeypatch):
    database = _Database()
    socket = _DisconnectedSocket()
    monkeypatch.setattr(unified, 'AsyncSessionLocal', lambda: database)

    asyncio.run(unified.websocket_unified_endpoint(socket))

    assert socket.accepted is True
    assert socket.close_calls == 0
    assert database.closed is True
