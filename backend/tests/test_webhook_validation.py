import pytest
from pydantic import ValidationError

from app.schemas.webhook import WebhookExecute


def test_execute_requires_supported_flags():
    with pytest.raises(ValidationError):
        WebhookExecute(content="test", flags=1)


def test_embed_combined_limit():
    with pytest.raises(ValidationError):
        WebhookExecute(embeds=[{"description": "x" * 4000}, {"description": "y" * 2001}])


def test_mentions_are_safe_by_default():
    payload = WebhookExecute(content="hello <@1>")
    assert payload.allowed_mentions.parse == []
    assert payload.allowed_mentions.users == []


def test_https_avatar_is_required():
    with pytest.raises(ValidationError):
        WebhookExecute(content="hello", avatar_url="http://example.com/avatar.png")

