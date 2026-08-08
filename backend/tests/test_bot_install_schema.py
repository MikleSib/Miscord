import pytest
from pydantic import ValidationError

from app.schemas.bot_install import BotInstallRequest


def test_bot_install_accepts_generated_client_id():
    payload = BotInstallRequest(
        client_id="1234567890123456789",
        server_id=1,
        scope="bot applications.commands",
        permissions=3,
    )

    assert payload.client_id == "1234567890123456789"


@pytest.mark.parametrize("client_id", ["123", "a" * 19, "1" * 32])
def test_bot_install_rejects_invalid_client_id(client_id: str):
    with pytest.raises(ValidationError):
        BotInstallRequest(client_id=client_id, server_id=1)
