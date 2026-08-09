from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings


def generate_webhook_token() -> str:
    return secrets.token_urlsafe(32)


def hash_webhook_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_webhook_token(token: str, expected_hash: str) -> bool:
    return hmac.compare_digest(hash_webhook_token(token), expected_hash)


def _encryption_key() -> bytes:
    configured = settings.WEBHOOK_TOKEN_ENCRYPTION_KEY.strip()
    if configured:
        try:
            key = base64.urlsafe_b64decode(configured + "=" * (-len(configured) % 4))
        except Exception as exc:
            raise RuntimeError("Invalid WEBHOOK_TOKEN_ENCRYPTION_KEY") from exc
        if len(key) != 32:
            raise RuntimeError("WEBHOOK_TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes")
        return key
    return hashlib.sha256(settings.SECRET_KEY.encode("utf-8")).digest()


def encrypt_webhook_token(token: str) -> str:
    nonce = os.urandom(12)
    encrypted = AESGCM(_encryption_key()).encrypt(nonce, token.encode("utf-8"), b"miscord-webhook-v1")
    return "v1." + base64.urlsafe_b64encode(nonce + encrypted).decode("ascii").rstrip("=")


def decrypt_webhook_token(ciphertext: str) -> str:
    version, encoded = ciphertext.split(".", 1)
    if version != "v1":
        raise RuntimeError("Unsupported webhook token format")
    raw = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    return AESGCM(_encryption_key()).decrypt(raw[:12], raw[12:], b"miscord-webhook-v1").decode("utf-8")


def webhook_execution_url(webhook_id: int, token: str) -> str:
    return f"{settings.SERVER_HOST.rstrip('/')}/api/v1/webhooks/{webhook_id}/{token}"
