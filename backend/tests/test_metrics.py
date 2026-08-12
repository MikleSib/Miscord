from types import SimpleNamespace

from app.core.metrics import route_label


def test_route_label_prefers_fastapi_template():
    request = SimpleNamespace(
        scope={"route": SimpleNamespace(path="/api/v1/channels/{channel_id}")},
        url=SimpleNamespace(path="/api/v1/channels/42"),
    )

    assert route_label(request) == "/api/v1/channels/{channel_id}"


def test_route_label_redacts_dynamic_fallback_segments():
    request = SimpleNamespace(
        scope={},
        url=SimpleNamespace(path="/api/v1/webhooks/42/sensitive-token"),
    )

    assert route_label(request) == "/api/v1/webhooks/:id/:token"
