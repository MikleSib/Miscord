import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.e2ee_dms import _decode_b64, _pair, _uuid
from app.models import DirectMessage
from app.schemas.e2ee import E2eeDeviceRegister, SecretDmSessionCreate
from app.services import direct_message_service
from app.websocket.unified_secret_dm import _canonical_uuid, _decode_ciphertext


def test_e2ee_contracts_bound_binary_payloads_and_ids() -> None:
    device_id = "e6833ec2-ef11-4a40-8a11-166f0526229d"
    payload = E2eeDeviceRegister(
        device_id=device_id,
        credential_id=f"user:7:device:{device_id}",
        key_package=base64.b64encode(b"k" * 64).decode(),
        signature_public_key=base64.b64encode(b"s" * 32).decode(),
    )
    assert payload.device_id == device_id
    with pytest.raises(ValidationError):
        SecretDmSessionCreate(
            session_id=device_id,
            founder_device_id=device_id,
            recipient_device_id=device_id,
            recipient_key_package_id=device_id,
            welcome="A" * 350001,
            ratchet_tree=base64.b64encode(b"tree").decode(),
        )


def test_base64_and_uuid_decoding_is_canonical_and_bounded() -> None:
    encoded = base64.b64encode(b"ciphertext" * 3).decode()
    assert _decode_b64(encoded, "test", 100) == b"ciphertext" * 3
    assert _decode_ciphertext(encoded) == b"ciphertext" * 3
    assert _pair(9, 2) == (2, 9)
    assert _uuid("e6833ec2-ef11-4a40-8a11-166f0526229d", "id")
    assert _canonical_uuid("e6833ec2-ef11-4a40-8a11-166f0526229d")
    assert _canonical_uuid("E6833EC2-EF11-4A40-8A11-166F0526229D") is None
    padded = base64.b64encode(b"requires-padding").decode()
    assert padded.endswith("=")
    with pytest.raises(HTTPException):
        _decode_b64(padded.rstrip("="), "test", 100)
    with pytest.raises(HTTPException):
        _uuid("not-a-uuid", "id")


def test_secret_message_model_never_needs_plaintext() -> None:
    message = DirectMessage(
        sender_id=1,
        recipient_id=2,
        content=None,
        encryption_version=1,
        ciphertext=b"opaque mls packet",
        secret_session_id="e6833ec2-ef11-4a40-8a11-166f0526229d",
        sender_device_id="cb8789f5-6e61-46e6-a8d3-cdc2a96d3fb5",
    )
    assert message.content is None
    assert message.ciphertext == b"opaque mls packet"


@pytest.mark.asyncio
async def test_regular_dm_history_excludes_secret_ciphertext() -> None:
    result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: []))
    db = SimpleNamespace(execute=AsyncMock(return_value=result))
    assert await direct_message_service.get_messages(db, 1, 2) == []
    statement = db.execute.await_args.args[0]
    assert "direct_messages.encryption_version" in str(statement)
