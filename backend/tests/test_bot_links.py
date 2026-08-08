from urllib.parse import parse_qs, urlparse

from app.services.bot_links import build_bot_authorize_url


def test_build_bot_authorize_url_targets_frontend_route():
    url = build_bot_authorize_url(
        "https://miscord.ru/",
        "1234567890123456789",
        ["bot", "applications.commands"],
        3,
    )

    parsed = urlparse(url)
    assert parsed.scheme == "https"
    assert parsed.netloc == "miscord.ru"
    assert parsed.path == "/bot/authorize"
    assert parse_qs(parsed.query) == {
        "client_id": ["1234567890123456789"],
        "scope": ["bot applications.commands"],
        "permissions": ["3"],
    }


def test_build_bot_authorize_url_removes_trailing_host_slash():
    url = build_bot_authorize_url("https://miscord.ru///", "1234567890123456", ["bot"], 0)

    assert url.startswith("https://miscord.ru/bot/authorize?")
