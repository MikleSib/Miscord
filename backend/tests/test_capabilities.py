from app.api.capabilities import capabilities_payload
from app.core.config import settings


def test_capabilities_follow_runtime_feature_flags(monkeypatch):
    monkeypatch.setattr(settings, "THREADS_ENABLED", True)
    monkeypatch.setattr(settings, "FORUMS_ENABLED", False)
    monkeypatch.setattr(settings, "POLLS_ENABLED", True)
    monkeypatch.setattr(settings, "INBOX_ENABLED", False)
    monkeypatch.setattr(settings, "SERVER_TEMPLATES_ENABLED", True)
    monkeypatch.setattr(settings, "BOT_PLATFORM_ENABLED", False)
    monkeypatch.setattr(settings, "EXPRESSIONS_ENABLED", True)
    monkeypatch.setattr(settings, "GIPHY_API_KEY", "browser-key")
    monkeypatch.setattr(settings, "SOUNDBOARD_ENABLED", True)
    monkeypatch.setattr(settings, "STAGE_CHANNELS_ENABLED", True)

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
    assert payload["custom_emoji"] is True
    assert payload["stickers"] is True
    assert payload["gifs"] is True
    assert payload["soundboard"] is True
    assert payload["stage_channels"] is True
