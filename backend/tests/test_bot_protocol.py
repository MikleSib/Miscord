from unittest.mock import AsyncMock

import pytest

from app.schemas.bot_protocol import (
    BotGatewayHello,
    BotGatewayIdentify,
    BotProtocolError,
    GATEWAY_API_VERSION,
    GATEWAY_DEFAULT_ENCODING,
    GatewayOpCode,
    VoiceGatewayOpCode,
    validate_gateway_query,
)
from app.services.bot_event_dispatcher import INTENT_GUILD_VOICE_STATES, dispatcher


def test_validate_gateway_query_requires_v1():
    with pytest.raises(BotProtocolError) as exc:
        validate_gateway_query(None, None)
    assert exc.value.code == "missing_gateway_version"


def test_validate_gateway_query_invalid_version():
    with pytest.raises(BotProtocolError) as exc:
        validate_gateway_query(9, GATEWAY_DEFAULT_ENCODING)
    assert exc.value.code == "invalid_gateway_version"


def test_validate_gateway_query_rejects_v10():
    with pytest.raises(BotProtocolError) as exc:
        validate_gateway_query(10, GATEWAY_DEFAULT_ENCODING)
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
    application = type("Application", (), {"client_id": "123", "flags": 0})()
    user = type("User", (), {
        "id": 7,
        "username": "bot",
        "display_name": "Bot",
        "avatar_url": None,
        "is_bot": True,
    })()
    payload = dispatcher._ready_data(application, user, "session-1", [99])
    assert payload["v"] == GATEWAY_API_VERSION
    assert payload["session_id"] == "session-1"
    assert payload["user"]["bot"] is True
    assert payload["guilds"] == [{"id": "99", "unavailable": True}]
    assert payload["application"] == {"id": "123", "flags": 0}


def test_validate_gateway_query_supports_miscord_zlib_stream():
    version, encoding = validate_gateway_query(
        GATEWAY_API_VERSION,
        GATEWAY_DEFAULT_ENCODING,
        "zlib-stream",
    )
    assert version == GATEWAY_API_VERSION
    assert encoding == GATEWAY_DEFAULT_ENCODING


def test_voice_gateway_opcode_contract():
    assert VoiceGatewayOpCode.IDENTIFY == 0
    assert VoiceGatewayOpCode.READY == 2
    assert VoiceGatewayOpCode.HEARTBEAT_ACK == 6
    assert VoiceGatewayOpCode.HELLO == 8
    assert VoiceGatewayOpCode.CLIENT_CONNECT == 11
    assert VoiceGatewayOpCode.CLIENT_DISCONNECT == 13


@pytest.mark.asyncio
async def test_voice_state_delivery_is_gated_by_gateway_session_not_install_intents(monkeypatch):
    class Result:
        @staticmethod
        def all():
            return [(42,)]

    db = type("Database", (), {"execute": AsyncMock(return_value=Result())})()
    dispatch = AsyncMock(return_value=1)
    monkeypatch.setattr(dispatcher, "_dispatch_to_application", dispatch)

    payload = {"guild_id": "7", "user_id": "9", "channel_id": "11"}
    await dispatcher.dispatch_voice_state_update(db, 7, payload)

    dispatch.assert_awaited_once_with(
        42,
        payload,
        required_intent=INTENT_GUILD_VOICE_STATES,
        event_name="VOICE_STATE_UPDATE",
    )
