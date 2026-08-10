from datetime import datetime, timezone

import pytest

from app.services.realtime_events import enqueue_realtime_event, event_envelope


def test_event_envelope_has_stable_v1_shape() -> None:
    payload = event_envelope(
        "f972d3f2-b7d6-44d0-91d3-27947c944ad0",
        "THREAD_CREATE",
        {"thread_id": 42},
        datetime(2026, 8, 10, 8, 30, tzinfo=timezone.utc),
    )
    assert payload == {
        "event_id": "f972d3f2-b7d6-44d0-91d3-27947c944ad0",
        "type": "THREAD_CREATE",
        "data": {"thread_id": 42},
        "created_at": "2026-08-10T08:30:00Z",
    }


def test_non_broadcast_event_requires_target() -> None:
    class FakeSession:
        def add(self, _event) -> None:
            raise AssertionError("must fail before adding")

    with pytest.raises(ValueError, match="target_id"):
        enqueue_realtime_event(
            FakeSession(),  # type: ignore[arg-type]
            event_type="THREAD_CREATE",
            data={},
            topic="server",
        )


def test_event_envelope_json_encodes_nested_datetimes() -> None:
    created_at = datetime(2026, 8, 10, 8, 30, tzinfo=timezone.utc)
    payload = event_envelope(
        "notification-event",
        "NOTIFICATION_CREATE",
        {"notification": {"created_at": created_at, "read_at": None}},
        created_at,
    )

    assert payload["data"]["notification"]["created_at"] == "2026-08-10T08:30:00+00:00"
