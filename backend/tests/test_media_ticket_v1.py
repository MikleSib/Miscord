from jose import jwt

from app.core.config import settings
from app.services.media_ticket import create_media_ticket, media_ws_url


def test_media_ticket_is_v1_and_scoped_to_one_session():
    token, jti = create_media_ticket(
        user_id=10,
        channel_id=20,
        session_id="session-1",
        room_epoch="epoch-1",
        username="tester",
        display_name="Tester",
        avatar_url=None,
    )
    payload = jwt.decode(
        token,
        settings.VOICE_MEDIA_JWT_SECRET or settings.SECRET_KEY,
        algorithms=["HS256"],
        audience=settings.VOICE_MEDIA_AUDIENCE,
        issuer="miscord-api-v1",
    )
    assert payload["protocol_version"] == 1
    assert payload["session_id"] == "session-1"
    assert payload["channel_id"] == 20
    assert payload["jti"] == jti
    assert payload["exp"] - payload["iat"] == settings.VOICE_MEDIA_TICKET_TTL_SECONDS


def test_media_gateway_url_has_no_ticket_query_parameter():
    assert "ticket=" not in media_ws_url()
    assert media_ws_url().endswith("/ws/media")
