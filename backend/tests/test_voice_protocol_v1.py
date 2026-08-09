from app.schemas.bot_protocol import GATEWAY_API_VERSION
from app.websocket.bot_voice_control import voice_gateway_endpoint


def test_only_gateway_protocol_v1_is_advertised():
    assert GATEWAY_API_VERSION == 1
    assert voice_gateway_endpoint().endswith("/ws/voice-gateway?v=1")
    assert "v=8" not in voice_gateway_endpoint()
