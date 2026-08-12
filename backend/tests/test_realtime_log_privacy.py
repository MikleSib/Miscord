import json

from app.websocket.connection_manager import _event_type
from app.websocket.unified_support import _structured_log


def test_event_type_does_not_expose_realtime_payload() -> None:
    secret = "private message that must never reach logs"
    payload = json.dumps({"type": "new_message", "data": {"content": secret}})

    assert _event_type(payload) == "new_message"
    assert secret not in _event_type(payload)


def test_structured_log_drops_sensitive_fields(capsys) -> None:
    secret = "sensitive text"

    _structured_log(
        None,
        "message_received",
        message_type="chat_message",
        content=secret,
        payload={"content": secret},
        token="secret-token",
    )

    output = capsys.readouterr().out
    assert '"message_type": "chat_message"' in output
    assert secret not in output
    assert "secret-token" not in output
