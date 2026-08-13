from datetime import datetime, timezone


def utc_isoformat(value: datetime | None) -> str | None:
    """Serialize database timestamps as unambiguous UTC ISO-8601 strings."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat()
