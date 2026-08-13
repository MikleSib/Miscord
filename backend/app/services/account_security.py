from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_password_hash
from app.models.account_security import AccountChallenge, UserTwoFactor
from app.models.user import User
from app.services.registration_email import MailDeliveryError, registration_mailer
from app.services.user_sessions import revoke_all_sessions


class AccountSecurityError(RuntimeError):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _digest(challenge_id: str, code: str) -> str:
    return hmac.new(
        settings.SECRET_KEY.encode(), f"account:{challenge_id}:{code}".encode(), hashlib.sha256,
    ).hexdigest()


def _encryption_key() -> bytes:
    return hashlib.sha256(f"miscord-2fa:{settings.SECRET_KEY}".encode()).digest()


def encrypt_secret(secret: str) -> str:
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(_encryption_key()).encrypt(nonce, secret.encode(), b"miscord-2fa-v1")
    return base64.urlsafe_b64encode(nonce + ciphertext).decode()


def decrypt_secret(value: str) -> str:
    raw = base64.urlsafe_b64decode(value.encode())
    return AESGCM(_encryption_key()).decrypt(raw[:12], raw[12:], b"miscord-2fa-v1").decode()


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def totp_uri(user: User, secret: str) -> str:
    label = quote(f"Miscord:{user.email}")
    return f"otpauth://totp/{label}?secret={secret}&issuer=Miscord&algorithm=SHA1&digits=6&period=30"


def _totp(secret: str, counter: int) -> str:
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{value:06d}"


def verify_totp(secret: str, code: str, at: int | None = None) -> bool:
    if not code.isdigit() or len(code) != 6:
        return False
    counter = int((at or time.time()) // 30)
    return any(secrets.compare_digest(_totp(secret, counter + drift), code) for drift in (-1, 0, 1))


def _backup_hash(code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"backup:{code.upper()}".encode(), hashlib.sha256).hexdigest()


def new_backup_codes() -> tuple[list[str], list[str]]:
    codes = [f"{secrets.token_hex(2).upper()}-{secrets.token_hex(2).upper()}" for _ in range(10)]
    return codes, [_backup_hash(code) for code in codes]


async def verify_second_factor(db: AsyncSession, user_id: int, code: str) -> bool:
    item = await db.get(UserTwoFactor, user_id)
    if item is None:
        return True
    if verify_totp(decrypt_secret(item.secret_ciphertext), code.replace(" ", "")):
        return True
    digest = _backup_hash(code.replace(" ", ""))
    hashes = list(item.backup_code_hashes or [])
    if digest not in hashes:
        return False
    hashes.remove(digest)
    item.backup_code_hashes = hashes
    await db.commit()
    return True


async def start_challenge(
    db: AsyncSession,
    *,
    type: str,
    email: str,
    user_id: int | None,
    payload: dict | None = None,
) -> str:
    await db.execute(delete(AccountChallenge).where(
        AccountChallenge.type == type,
        AccountChallenge.email == email.lower(),
    ))
    code = f"{secrets.randbelow(1_000_000):06d}"
    challenge = AccountChallenge(
        user_id=user_id,
        email=email.lower(),
        type=type,
        code_digest="pending",
        payload=payload or {},
        expires_at=_now() + timedelta(minutes=10),
    )
    db.add(challenge)
    await db.flush()
    challenge.code_digest = _digest(challenge.id, code)
    await db.commit()
    purpose = "Сброс пароля" if type == "password_reset" else "Подтверждение новой почты"
    try:
        await registration_mailer.send_security_code(email, code, purpose, 10)
    except MailDeliveryError as exc:
        await db.delete(challenge)
        await db.commit()
        raise AccountSecurityError(
            503,
            "Не удалось отправить письмо. Проверьте адрес и попробуйте немного позже.",
        ) from exc
    return challenge.id


async def consume_challenge(db: AsyncSession, challenge_id: str, code: str, expected_type: str) -> AccountChallenge:
    challenge = (await db.execute(select(AccountChallenge).where(
        AccountChallenge.id == challenge_id,
        AccountChallenge.type == expected_type,
    ).with_for_update())).scalar_one_or_none()
    if challenge is None or challenge.expires_at <= _now():
        raise AccountSecurityError(410, "Код истёк. Запросите новый.")
    if challenge.attempts_remaining <= 0:
        raise AccountSecurityError(429, "Попытки закончились. Запросите новый код.")
    if not secrets.compare_digest(challenge.code_digest, _digest(challenge.id, code)):
        challenge.attempts_remaining -= 1
        await db.commit()
        raise AccountSecurityError(400, "Неверный код подтверждения.")
    return challenge


async def finish_password_reset(db: AsyncSession, challenge_id: str, code: str, password: str) -> None:
    challenge = await consume_challenge(db, challenge_id, code, "password_reset")
    user = (await db.execute(select(User).where(func.lower(User.email) == challenge.email))).scalar_one_or_none()
    if user is None:
        raise AccountSecurityError(404, "Аккаунт не найден.")
    user.hashed_password = get_password_hash(password)
    await db.delete(challenge)
    await db.commit()
    await revoke_all_sessions(db, user.id)
