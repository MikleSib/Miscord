from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_active_user
from app.core.security import verify_password
from app.db.database import get_db
from app.models.account_security import AccountChallenge, UserTwoFactor
from app.models.user import User
from app.services.account_security import (
    AccountSecurityError,
    consume_challenge,
    decrypt_secret,
    encrypt_secret,
    new_backup_codes,
    new_totp_secret,
    start_challenge,
    totp_uri,
    verify_second_factor,
    verify_totp,
    finish_password_reset,
)
from app.services.rate_limit import rate_limit_auth, rate_limit_user
from app.services.user_sessions import revoke_all_sessions


router = APIRouter()


class PasswordResetStart(BaseModel):
    email: EmailStr


class ChallengeVerification(BaseModel):
    challenge_id: str = Field(min_length=36, max_length=36)
    code: str = Field(min_length=6, max_length=12)


class PasswordResetFinish(ChallengeVerification):
    new_password: str = Field(min_length=8, max_length=128)


class EmailChangeStart(BaseModel):
    new_email: EmailStr
    current_password: str = Field(min_length=1, max_length=128)


class TwoFactorSetup(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)


class TwoFactorEnable(ChallengeVerification):
    pass


class TwoFactorDisable(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=6, max_length=12)


def _error(exc: AccountSecurityError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.post("/password-reset/start", status_code=status.HTTP_202_ACCEPTED)
async def start_password_reset(
    payload: PasswordResetStart,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    rate_limit_auth(request, "password-reset", limit=5, window=900)
    email = str(payload.email).lower()
    user = (await db.execute(select(User).where(func.lower(User.email) == email))).scalar_one_or_none()
    challenge_id = str(uuid.uuid4())
    if user and not user.is_bot:
        try:
            challenge_id = await start_challenge(
                db, type="password_reset", email=email, user_id=user.id,
            )
        except AccountSecurityError as exc:
            raise _error(exc) from exc
    return {
        "challenge_id": challenge_id,
        "message": "Если аккаунт существует, код отправлен на указанную почту.",
    }


@router.post("/password-reset/finish", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(payload: PasswordResetFinish, db: AsyncSession = Depends(get_db)):
    try:
        await finish_password_reset(db, payload.challenge_id, payload.code, payload.new_password)
    except AccountSecurityError as exc:
        raise _error(exc) from exc


@router.post("/email-change/start", status_code=status.HTTP_202_ACCEPTED)
async def start_email_change(
    payload: EmailChangeStart,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный текущий пароль")
    email = str(payload.new_email).lower()
    existing = (await db.execute(select(User.id).where(func.lower(User.email) == email))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Эта почта уже используется")
    challenge_id = await start_challenge(
        db,
        type="email_change",
        email=email,
        user_id=current_user.id,
        payload={"new_email": email},
    )
    return {"challenge_id": challenge_id, "masked_email": _mask_email(email)}


@router.post("/email-change/finish")
async def finish_email_change(
    payload: ChallengeVerification,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        challenge = await consume_challenge(db, payload.challenge_id, payload.code, "email_change")
    except AccountSecurityError as exc:
        raise _error(exc) from exc
    if challenge.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Этот запрос принадлежит другому аккаунту")
    email = str((challenge.payload or {}).get("new_email", "")).lower()
    if not email:
        raise HTTPException(status_code=400, detail="Новая почта отсутствует")
    existing = (await db.execute(select(User.id).where(
        func.lower(User.email) == email, User.id != current_user.id,
    ))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Эта почта уже используется")
    current_user.email = email
    current_user.email_verified_at = datetime.now(timezone.utc)
    await db.delete(challenge)
    await db.commit()
    await revoke_all_sessions(db, current_user.id)
    return {"email": email, "reauthentication_required": True}


@router.get("/2fa")
async def two_factor_status(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(UserTwoFactor, current_user.id)
    return {"enabled": item is not None, "backup_codes_remaining": len(item.backup_code_hashes or []) if item else 0}


@router.post("/2fa/setup")
async def setup_two_factor(
    payload: TwoFactorSetup,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный текущий пароль")
    if await db.get(UserTwoFactor, current_user.id):
        raise HTTPException(status_code=409, detail="Двухфакторная аутентификация уже включена")
    secret = new_totp_secret()
    challenge = AccountChallenge(
        user_id=current_user.id,
        email=current_user.email,
        type="two_factor_setup",
        code_digest="totp",
        payload={"secret": encrypt_secret(secret)},
        expires_at=datetime.now(timezone.utc).replace(microsecond=0),
    )
    challenge.expires_at += timedelta(minutes=15)
    db.add(challenge)
    await db.commit()
    await db.refresh(challenge)
    return {"challenge_id": challenge.id, "secret": secret, "otpauth_uri": totp_uri(current_user, secret)}


@router.post("/2fa/enable")
async def enable_two_factor(
    payload: TwoFactorEnable,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    challenge = await db.get(AccountChallenge, payload.challenge_id)
    if (
        not challenge
        or challenge.user_id != current_user.id
        or challenge.type != "two_factor_setup"
        or challenge.expires_at <= datetime.now(timezone.utc)
    ):
        raise HTTPException(status_code=410, detail="Настройка истекла. Начните заново.")
    secret = decrypt_secret(str((challenge.payload or {}).get("secret", "")))
    if not verify_totp(secret, payload.code):
        raise HTTPException(status_code=400, detail="Неверный код приложения-аутентификатора")
    codes, hashes = new_backup_codes()
    db.add(UserTwoFactor(
        user_id=current_user.id,
        secret_ciphertext=encrypt_secret(secret),
        backup_code_hashes=hashes,
    ))
    await db.delete(challenge)
    await db.commit()
    await revoke_all_sessions(db, current_user.id)
    return {"backup_codes": codes, "reauthentication_required": True}


@router.post("/2fa/backup-codes")
async def regenerate_backup_codes(
    payload: TwoFactorDisable,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный текущий пароль")
    if not await verify_second_factor(db, current_user.id, payload.code):
        raise HTTPException(status_code=400, detail="Неверный код двухфакторной аутентификации")
    item = await db.get(UserTwoFactor, current_user.id)
    if not item:
        raise HTTPException(status_code=404, detail="Двухфакторная аутентификация не включена")
    codes, hashes = new_backup_codes()
    item.backup_code_hashes = hashes
    await db.commit()
    return {"backup_codes": codes}


@router.delete("/2fa", status_code=status.HTTP_204_NO_CONTENT)
async def disable_two_factor(
    payload: TwoFactorDisable,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный текущий пароль")
    if not await verify_second_factor(db, current_user.id, payload.code):
        raise HTTPException(status_code=400, detail="Неверный код двухфакторной аутентификации")
    item = await db.get(UserTwoFactor, current_user.id)
    if item:
        await db.delete(item)
        await db.commit()
    await revoke_all_sessions(db, current_user.id)


def _mask_email(email: str) -> str:
    local, domain = email.split("@", 1)
    visible = local[:2] if len(local) > 2 else local[:1]
    return f"{visible}{'*' * max(2, len(local) - len(visible))}@{domain}"
