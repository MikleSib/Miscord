from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.bot_platform import _resolve_invite_permissions
from app.api.bot_apps import router as bot_apps_router
from app.core.permissions import Permission
from app.schemas.bot import BotApplicationUpdate
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
    assert parsed.path == "/oauth2/authorize"
    assert parse_qs(parsed.query) == {
        "client_id": ["1234567890123456789"],
        "scope": ["bot applications.commands"],
        "permissions": ["3"],
    }


def test_build_bot_authorize_url_removes_trailing_host_slash():
    url = build_bot_authorize_url("https://miscord.ru///", "1234567890123456", ["bot"], 0)

    assert url.startswith("https://miscord.ru/oauth2/authorize?")


def test_build_bot_authorize_url_supports_install_context_parameters():
    url = build_bot_authorize_url(
        "https://miscord.ru",
        "1234567890123456",
        ["bot", "applications.commands"],
        8,
        guild_id="42",
        disable_guild_select=True,
        integration_type=0,
    )

    assert parse_qs(urlparse(url).query) == {
        "client_id": ["1234567890123456"],
        "scope": ["bot applications.commands"],
        "permissions": ["8"],
        "guild_id": ["42"],
        "disable_guild_select": ["true"],
        "integration_type": ["0"],
    }


def test_build_default_install_url_only_requires_client_id():
    url = build_bot_authorize_url("https://miscord.ru", "1234567890123456")

    assert parse_qs(urlparse(url).query) == {"client_id": ["1234567890123456"]}


def test_invite_permissions_use_saved_application_rules():
    expected = int(Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES | Permission.ATTACH_FILES)
    application = SimpleNamespace(install_params={"permissions": str(expected)})

    assert _resolve_invite_permissions(application, None) == expected


def test_explicit_invite_permissions_override_saved_rules():
    application = SimpleNamespace(install_params={"permissions": "0"})

    assert _resolve_invite_permissions(application, int(Permission.ADMINISTRATOR)) == int(Permission.ADMINISTRATOR)


def test_invite_permissions_normalize_compound_administrator_mask():
    application = SimpleNamespace(
        install_params={"permissions": str(int(Permission.ADMINISTRATOR | Permission.SEND_MESSAGES))}
    )

    assert _resolve_invite_permissions(application, None) == int(Permission.ADMINISTRATOR)


def test_invite_permissions_reject_unknown_bits():
    application = SimpleNamespace(install_params={"permissions": str(1 << 47)})

    with pytest.raises(HTTPException) as exc:
        _resolve_invite_permissions(application, None)

    assert exc.value.status_code == 400


def test_bot_media_routes_are_registered():
    routes = {(route.path, method) for route in bot_apps_router.routes for method in (route.methods or set())}

    assert ("/bot-apps/{application_id}/avatar", "POST") in routes
    assert ("/bot-apps/{application_id}/banner", "POST") in routes
    assert ("/bot-apps/{application_id}/avatar", "DELETE") in routes
    assert ("/bot-apps/{application_id}/banner", "DELETE") in routes


def test_bot_application_update_normalizes_banner_url():
    payload = BotApplicationUpdate(banner_url="  /api/v1/media/public/bot-banners/banner.webp  ")

    assert payload.banner_url == "/api/v1/media/public/bot-banners/banner.webp"


def test_bot_application_update_normalizes_administrator_install_permissions():
    payload = BotApplicationUpdate(
        install_params={"permissions": str(int(Permission.ADMINISTRATOR | Permission.SEND_MESSAGES))}
    )

    assert payload.install_params == {"permissions": str(int(Permission.ADMINISTRATOR))}


def test_bot_application_update_normalizes_installation_contexts():
    payload = BotApplicationUpdate(integration_types_config={
        "0": {"oauth2_install_params": {"scopes": ["bot", "applications.commands"], "permissions": "8"}},
        "1": {"oauth2_install_params": {"scopes": ["applications.commands"], "permissions": "123"}},
    })

    assert payload.integration_types_config["0"]["oauth2_install_params"]["permissions"] == "8"
    assert payload.integration_types_config["1"]["oauth2_install_params"]["permissions"] == "0"


def test_bot_application_update_validates_event_webhook_subscriptions():
    payload = BotApplicationUpdate(event_webhooks_types=["application_authorized", "APPLICATION_AUTHORIZED"])
    assert payload.event_webhooks_types == ["APPLICATION_AUTHORIZED"]

    with pytest.raises(ValidationError):
        BotApplicationUpdate(event_webhooks_types=["MESSAGE_CREATE"])
