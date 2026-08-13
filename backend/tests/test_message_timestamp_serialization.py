from datetime import datetime, timedelta, timezone

from app.services.datetime_serializer import utc_isoformat


def test_live_message_timestamp_marks_naive_database_value_as_utc():
    value = datetime(2026, 8, 9, 2, 53, 0)

    assert utc_isoformat(value) == "2026-08-09T02:53:00+00:00"


def test_live_message_timestamp_is_normalized_to_utc():
    value = datetime(2026, 8, 9, 9, 53, 0, tzinfo=timezone(timedelta(hours=7)))

    assert utc_isoformat(value) == "2026-08-09T02:53:00+00:00"
