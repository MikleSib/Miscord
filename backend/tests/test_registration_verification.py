from pathlib import Path

import pytest
from pydantic import ValidationError

from app.models.registration import RegistrationChallenge
from app.schemas.registration import RegistrationVerify
from app.services.registration import _code_digest, _email_hint
from app.services.registration_email import (
    build_delivery_message,
    render_verification_email,
    render_welcome_email,
)
from main import app


def test_verification_code_is_hmac_digest_not_plaintext() -> None:
    digest = _code_digest("5c21aef0-7de4-45f0-a084-b879428482f7", "123456")
    assert len(digest) == 64
    assert "123456" not in digest
    assert digest == _code_digest("5c21aef0-7de4-45f0-a084-b879428482f7", "123456")


def test_verification_schema_accepts_only_six_digits() -> None:
    valid = RegistrationVerify(
        challenge_id="5c21aef0-7de4-45f0-a084-b879428482f7",
        code="001204",
    )
    assert valid.code == "001204"
    with pytest.raises(ValidationError):
        RegistrationVerify(
            challenge_id="5c21aef0-7de4-45f0-a084-b879428482f7",
            code="12a456",
        )


def test_email_template_has_html_text_fallback_and_no_remote_assets() -> None:
    text, document = render_verification_email("654321", 10)
    assert "654321" in text
    assert "654321" in document
    assert "support@miscord.ru" in text
    assert "<img" not in document
    assert "http://" not in document and "https://" not in document


def test_delivery_message_has_required_transport_headers() -> None:
    message = build_delivery_message(
        "recipient@example.com",
        "Miscord verification",
        "Plain text",
        "<p>HTML</p>",
    )
    assert message["Date"]
    assert message["Message-ID"].endswith("@miscord.ru>")
    assert message["Reply-To"] == "support@miscord.ru"


def test_email_hint_does_not_reveal_full_mailbox() -> None:
    hint = _email_hint("important.person@example.com")
    assert hint.startswith("im")
    assert "important.person" not in hint
    assert hint.endswith("@example.com")


def test_welcome_email_escapes_name_and_links_project_mailboxes() -> None:
    text, document = render_welcome_email("<Misha>")
    assert "<Misha>" in text
    assert "&lt;Misha&gt;" in document
    assert "support@miscord.ru" in document
    assert "sales@miscord.ru" in document


def test_challenge_model_has_no_plaintext_code_column() -> None:
    columns = set(RegistrationChallenge.__table__.columns.keys())
    assert "code_digest" in columns
    assert "code" not in columns


def test_registration_routes_and_migration_are_present() -> None:
    routes = {(route.path, method) for route in app.routes for method in getattr(route, "methods", set())}
    assert ("/api/v1/auth/register", "POST") in routes
    assert ("/api/v1/auth/register/verify", "POST") in routes
    assert ("/api/v1/auth/register/resend", "POST") in routes
    migration = Path("migrations/versions/0008_email_registration.py").read_text(encoding="utf-8")
    assert "registration_challenges" in migration
    assert "email_verified_at" in migration
