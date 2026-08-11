from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_password_hash
from app.models.registration import RegistrationChallenge
from app.models.user import User
from app.schemas.registration import RegistrationChallengeResponse, RegistrationStart
from app.services.registration_email import MailDeliveryError, RegistrationMailer, registration_mailer


logger = logging.getLogger(__name__)


class RegistrationError(RuntimeError):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _code_digest(challenge_id: str, code: str) -> str:
    key = (settings.EMAIL_VERIFICATION_SECRET or settings.SECRET_KEY).encode("utf-8")
    return hmac.new(key, f"{challenge_id}:{code}".encode("utf-8"), hashlib.sha256).hexdigest()


def _new_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _email_hint(email: str) -> str:
    local, domain = email.split("@", 1)
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}{'•' * max(3, len(local) - len(visible))}@{domain}"


def _response(challenge: RegistrationChallenge, now: datetime) -> RegistrationChallengeResponse:
    expires = max(0, int((challenge.expires_at - now).total_seconds()))
    resend = max(0, int((challenge.resend_available_at - now).total_seconds()))
    return RegistrationChallengeResponse(
        challenge_id=challenge.id,
        email_hint=_email_hint(challenge.email),
        expires_in=expires,
        resend_in=resend,
    )


async def _ensure_identity_available(db: AsyncSession, email: str, username: str) -> None:
    result = await db.execute(
        select(User.id).where(
            or_(func.lower(User.email) == email, func.lower(User.username) == username.lower())
        )
    )
    if result.scalar_one_or_none() is not None:
        raise RegistrationError(409, "Пользователь с такой почтой или логином уже существует")


async def start_registration(
    db: AsyncSession,
    payload: RegistrationStart,
    mailer: RegistrationMailer = registration_mailer,
) -> RegistrationChallengeResponse:
    now = _now()
    email = payload.email.strip().lower()
    username = payload.username.strip().lower()
    await _ensure_identity_available(db, email, username)
    await db.execute(delete(RegistrationChallenge).where(RegistrationChallenge.expires_at <= now))
    await db.execute(
        delete(RegistrationChallenge).where(
            or_(RegistrationChallenge.email == email, func.lower(RegistrationChallenge.username) == username.lower())
        )
    )
    code = _new_code()
    challenge = RegistrationChallenge(
        email=email,
        username=username,
        display_name=(payload.display_name or "").strip() or None,
        hashed_password=get_password_hash(payload.password),
        code_digest="pending",
        attempts_remaining=settings.EMAIL_VERIFICATION_MAX_ATTEMPTS,
        expires_at=now + timedelta(seconds=settings.EMAIL_VERIFICATION_TTL_SECONDS),
        resend_available_at=now + timedelta(seconds=settings.EMAIL_VERIFICATION_RESEND_SECONDS),
    )
    db.add(challenge)
    await db.flush()
    challenge.code_digest = _code_digest(challenge.id, code)
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise RegistrationError(409, "Регистрация для этой почты или логина уже начата") from exc
    try:
        await mailer.send_code(email, code, settings.EMAIL_VERIFICATION_TTL_SECONDS // 60)
    except MailDeliveryError as exc:
        await db.execute(delete(RegistrationChallenge).where(RegistrationChallenge.id == challenge.id))
        await db.commit()
        raise RegistrationError(503, "Не удалось отправить письмо. Попробуйте ещё раз позже") from exc
    return _response(challenge, now)


async def resend_registration_code(
    db: AsyncSession,
    challenge_id: str,
    mailer: RegistrationMailer = registration_mailer,
) -> RegistrationChallengeResponse:
    now = _now()
    result = await db.execute(
        select(RegistrationChallenge).where(RegistrationChallenge.id == challenge_id).with_for_update()
    )
    challenge = result.scalar_one_or_none()
    if challenge is None or challenge.expires_at <= now:
        if challenge is not None:
            await db.delete(challenge)
            await db.commit()
        raise RegistrationError(410, "Код истёк. Начните регистрацию заново")
    if challenge.resend_available_at > now:
        wait = int((challenge.resend_available_at - now).total_seconds()) + 1
        raise RegistrationError(429, f"Новый код можно запросить через {wait} сек.")
    if challenge.resend_count >= settings.EMAIL_VERIFICATION_MAX_RESENDS:
        raise RegistrationError(429, "Слишком много повторных отправок. Начните регистрацию заново")

    code = _new_code()
    challenge.code_digest = _code_digest(challenge.id, code)
    challenge.attempts_remaining = settings.EMAIL_VERIFICATION_MAX_ATTEMPTS
    challenge.resend_count += 1
    challenge.expires_at = now + timedelta(seconds=settings.EMAIL_VERIFICATION_TTL_SECONDS)
    challenge.resend_available_at = now + timedelta(seconds=settings.EMAIL_VERIFICATION_RESEND_SECONDS)
    await db.commit()
    try:
        await mailer.send_code(challenge.email, code, settings.EMAIL_VERIFICATION_TTL_SECONDS // 60)
    except MailDeliveryError as exc:
        raise RegistrationError(503, "Не удалось отправить новый код. Попробуйте позже") from exc
    return _response(challenge, now)


async def verify_registration(
    db: AsyncSession,
    challenge_id: str,
    code: str,
    mailer: RegistrationMailer = registration_mailer,
) -> User:
    now = _now()
    result = await db.execute(
        select(RegistrationChallenge).where(RegistrationChallenge.id == challenge_id).with_for_update()
    )
    challenge = result.scalar_one_or_none()
    if challenge is None or challenge.expires_at <= now:
        if challenge is not None:
            await db.delete(challenge)
            await db.commit()
        raise RegistrationError(410, "Код истёк. Начните регистрацию заново")
    if challenge.attempts_remaining <= 0:
        raise RegistrationError(429, "Попытки закончились. Запросите новый код")
    expected = _code_digest(challenge.id, code)
    if not secrets.compare_digest(challenge.code_digest, expected):
        challenge.attempts_remaining -= 1
        await db.commit()
        if challenge.attempts_remaining <= 0:
            raise RegistrationError(429, "Попытки закончились. Запросите новый код")
        raise RegistrationError(400, f"Неверный код. Осталось попыток: {challenge.attempts_remaining}")

    await _ensure_identity_available(db, challenge.email, challenge.username)
    user = User(
        username=challenge.username,
        email=challenge.email,
        display_name=challenge.display_name,
        hashed_password=challenge.hashed_password,
        email_verified_at=now,
    )
    db.add(user)
    await db.execute(
        delete(RegistrationChallenge).where(
            or_(
                RegistrationChallenge.email == challenge.email,
                func.lower(RegistrationChallenge.username) == challenge.username.lower(),
            )
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise RegistrationError(409, "Пользователь с такой почтой или логином уже существует") from exc
    await db.refresh(user)
    try:
        await mailer.send_welcome(user.email, user.display_name or user.username)
    except MailDeliveryError:
        logger.warning("Welcome email delivery failed for user_id=%s", user.id)
    return user
