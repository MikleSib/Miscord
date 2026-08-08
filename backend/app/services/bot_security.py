from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import time
from dataclasses import dataclass

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.db.database import get_db
from app.models.bot import BotApplication, BotToken
from app.models.user import User


_TOKEN_PATTERN = re.compile(r"^mcb_([0-9]{16,20})\.([A-Za-z0-9_-]{43})$")
_TIMESTAMP_TOLERANCE_SECONDS = 300


@dataclass(frozen=True)
class BotPrincipal:
    application: BotApplication
    bot_user: User


def _secret_encryption_key() -> bytes:
    configured = settings.BOT_SECRET_ENCRYPTION_KEY.strip()
    if configured:
        try:
            key = base64.urlsafe_b64decode(configured + "=" * (-len(configured) % 4))
        except Exception as exc:
            raise RuntimeError("Invalid BOT_SECRET_ENCRYPTION_KEY") from exc
        if len(key) != 32:
            raise RuntimeError("BOT_SECRET_ENCRYPTION_KEY must encode exactly 32 bytes")
        return key
    return hashlib.sha256((settings.SECRET_KEY + ":bot-platform").encode("utf-8")).digest()


def generate_signing_keypair() -> tuple[str, str]:
    private_key = Ed25519PrivateKey.generate()
    private_bytes = private_key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    public_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    nonce = os.urandom(12)
    ciphertext = AESGCM(_secret_encryption_key()).encrypt(nonce, private_bytes, b"miscord-bot-signing-v1")
    encrypted_private_key = "v1." + base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii").rstrip("=")
    return public_bytes.hex(), encrypted_private_key


def generate_client_id() -> str:
    return str(secrets.randbelow(9_000_000_000_000_000_000) + 1_000_000_000_000_000_000)


def generate_bot_token(client_id: str) -> str:
    return f"mcb_{client_id}.{secrets.token_urlsafe(32)}"


def hash_bot_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def bot_token_hint(token: str) -> str:
    return token[-6:]


def _invalid_interaction_signature() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "invalid_interaction_signature", "message": "Invalid interaction signature"},
    )


def _ensure_interaction_timestamp(raw_timestamp: str | None) -> int:
    if not raw_timestamp:
        raise _invalid_interaction_signature()
    try:
        timestamp = int(raw_timestamp)
    except ValueError as exc:
        raise _invalid_interaction_signature() from exc
    now = int(time.time())
    if abs(now - timestamp) > _TIMESTAMP_TOLERANCE_SECONDS:
        raise HTTPException(
            status_code=401,
            detail={"code": "invalid_interaction_timestamp", "message": "Interaction timestamp outside tolerance"},
        )
    return timestamp


def _load_public_key_hex(value: str) -> bytes:
    try:
        raw = bytes.fromhex(value)
    except ValueError as exc:
        raise RuntimeError("Application public key is invalid") from exc
    if len(raw) != 32:
        raise RuntimeError("Application public key is invalid")
    return raw


def verify_interaction_signature(
    application: BotApplication,
    signature: str | None,
    timestamp: str | None,
    body: bytes,
) -> None:
    if not signature:
        raise _invalid_interaction_signature()
    _ensure_interaction_timestamp(timestamp)
    try:
        public_key = Ed25519PublicKey.from_public_bytes(_load_public_key_hex(application.public_key))
        public_key.verify(bytes.fromhex(signature), f"{timestamp}{body.decode('utf-8')}".encode("utf-8"))
    except (ValueError, InvalidSignature, UnicodeError) as exc:
        raise _invalid_interaction_signature() from exc


def _invalid_token() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={"code": "invalid_bot_token", "message": "Invalid or revoked bot token"},
        headers={"WWW-Authenticate": "Bot"},
    )


async def _load_bot_principal_from_token(token: str, db: AsyncSession) -> BotPrincipal:
    match = _TOKEN_PATTERN.fullmatch(token)
    if not match:
        raise _invalid_token()

    token_hash = hash_bot_token(token)
    result = await db.execute(
        select(BotToken)
        .options(selectinload(BotToken.application).selectinload(BotApplication.bot_user))
        .where(BotToken.token_hash == token_hash, BotToken.revoked_at.is_(None))
    )
    stored = result.scalar_one_or_none()
    if stored is None or not hmac.compare_digest(stored.token_hash, token_hash):
        raise _invalid_token()

    application = stored.application
    if application.client_id != match.group(1) or application.status != "active" or not application.bot_user.is_active:
        raise _invalid_token()
    return BotPrincipal(application=application, bot_user=application.bot_user)


async def get_bot_principal_by_token(token: str, db: AsyncSession) -> BotPrincipal:
    return await _load_bot_principal_from_token(token, db)


async def get_current_bot(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> BotPrincipal:
    if not settings.BOT_PLATFORM_ENABLED:
        raise HTTPException(status_code=404, detail="Not found")
    if not authorization or not authorization.startswith("Bot "):
        raise _invalid_token()

    return await _load_bot_principal_from_token(authorization[4:].strip(), db)
