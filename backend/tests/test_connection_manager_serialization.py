import asyncio
import json
from datetime import datetime, timezone

from app.websocket.connection_manager import ConnectionManager


class RecordingRedis:
    def __init__(self):
        self.published = []

    async def publish(self, channel, payload):
        self.published.append((channel, payload))


def test_personal_message_serializes_datetimes_for_redis():
    manager = ConnectionManager()
    redis = RecordingRedis()
    manager.redis_client = redis
    created_at = datetime(2026, 8, 13, 15, 30, tzinfo=timezone.utc)

    asyncio.run(manager.send_personal_message({
        "type": "dm",
        "data": {"created_at": created_at},
    }, user_id=2))

    assert len(redis.published) == 1
    channel, encoded = redis.published[0]
    assert channel == "user:2"
    assert json.loads(encoded)["data"]["created_at"] == created_at.isoformat()
