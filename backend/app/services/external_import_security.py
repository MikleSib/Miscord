from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings

_AAD = b"miscord-external-import-v1"


def state_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _key() -> bytes:
    configured = settings.EXTERNAL_IMPORT_ENCRYPTION_KEY.strip()
    if configured:
        try:
            decoded = base64.urlsafe_b64decode(configured + "=" * (-len(configured) % 4))
        except Exception as exc:
            raise RuntimeError("Invalid EXTERNAL_IMPORT_ENCRYPTION_KEY") from exc
        if len(decoded) != 32:
            raise RuntimeError("EXTERNAL_IMPORT_ENCRYPTION_KEY must encode 32 bytes")
        return decoded
    return hashlib.sha256((settings.SECRET_KEY + ":external-import").encode("utf-8")).digest()


def encrypt_import_token(value: str) -> str:
    nonce = os.urandom(12)
    payload = nonce + AESGCM(_key()).encrypt(nonce, value.encode("utf-8"), _AAD)
    return "v1." + base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decrypt_import_token(value: str) -> str:
    version, encoded = value.split(".", 1)
    if version != "v1":
        raise RuntimeError("Unsupported external import token format")
    payload = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    return AESGCM(_key()).decrypt(payload[:12], payload[12:], _AAD).decode("utf-8")
