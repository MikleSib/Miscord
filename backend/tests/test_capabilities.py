from app.api.capabilities import capabilities_payload
from app.core.config import settings


def test_capabilities_follow_runtime_feature_flags(monkeypatch):
    monkeypatch.setattr(settings, "THREADS_ENABLED", True)
    monkeypatch.setattr(settings, "FORUMS_ENABLED", False)
    monkeypatch.setattr(settings, "POLLS_ENABLED", True)
    monkeypatch.setattr(settings, "INBOX_ENABLED", False)
    monkeypatch.setattr(settings, "SERVER_TEMPLATES_ENABLED", True)
    monkeypatch.setattr(settings, "BOT_PLATFORM_ENABLED", False)

    payload = capabilities_payload()

    assert payload["version"] == 1
    assert payload["threads"] is True
    assert payload["forums"] is False
    assert payload["polls"] is True
    assert payload["inbox"] is False
    assert payload["server_templates"] is True
    assert payload["bot_platform"] is False
    assert payload["voice"] is True
    assert payload["screen_share"] is True
