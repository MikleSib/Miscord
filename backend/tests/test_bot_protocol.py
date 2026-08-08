import pytest

from app.schemas.bot_protocol import (
    BotGatewayHello,
    BotGatewayIdentify,
    BotProtocolError,
    GATEWAY_API_VERSION,
    GATEWAY_DEFAULT_ENCODING,
    GatewayOpCode,
    validate_gateway_query,
)
from app.services.bot_event_dispatcher import dispatcher


def test_validate_gateway_query_uses_defaults():
    version, encoding = validate_gateway_query(None, None)
    assert version == GATEWAY_API_VERSION
    assert encoding == GATEWAY_DEFAULT_ENCODING


def test_validate_gateway_query_invalid_version():
    with pytest.raises(BotProtocolError) as exc:
        validate_gateway_query(9, GATEWAY_DEFAULT_ENCODING)
    assert exc.value.code == "invalid_gateway_version"


def test_validate_gateway_query_invalid_encoding():
    with pytest.raises(BotProtocolError) as exc:
        validate_gateway_query(GATEWAY_API_VERSION, "etf")
    assert exc.value.code == "invalid_gateway_encoding"


def test_validate_gateway_query_invalid_compress():
    with pytest.raises(BotProtocolError) as exc:
        validate_gateway_query(GATEWAY_API_VERSION, GATEWAY_DEFAULT_ENCODING, "lz4")
    assert exc.value.code == "invalid_gateway_compress"


def test_gateway_hello_schema_allows_expected_payload():
    payload = BotGatewayHello(
        op=GatewayOpCode.HELLO.value,
        d={
            "v": GATEWAY_API_VERSION,
            "heartbeat_interval": 45000,
            "_trace": ["trace"],
        },
    )
    assert payload.op == GatewayOpCode.HELLO
    assert payload.d.heartbeat_interval == 45000


def test_gateway_identify_schema_rejects_missing_token():
    with pytest.raises(Exception):
        BotGatewayIdentify(op=GatewayOpCode.IDENTIFY.value, d={"intents": 0})


def test_ready_payload_contract():
    payload = dispatcher._ready_payload("session-1")
    assert payload["op"] == GatewayOpCode.DISPATCH.value
    assert payload["t"] == "READY"
    assert payload["d"]["v"] == GATEWAY_API_VERSION
    assert payload["d"]["session_id"] == "session-1"
