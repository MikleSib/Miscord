from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import get_password_hash
from app.db.database import get_db
from app.models.user import User
from app.schemas.registration import (
    RegistrationChallengeResponse,
    RegistrationResend,
    RegistrationStart,
    RegistrationVerify,
)
from app.schemas.user import User as UserSchema
from app.services.rate_limit import rate_limit_auth
from app.services.registration import (
    RegistrationError,
    resend_registration_code,
    start_registration,
    verify_registration,
)


router = APIRouter()


def _raise_http(exc: RegistrationError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


async def _register_without_email_verification(
    db: AsyncSession,
    payload: RegistrationStart,
) -> RegistrationChallengeResponse:
    existing = await db.execute(
        select(User.id).where(or_(User.username == payload.username, User.email == payload.email))
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Аккаунт с такой почтой или логином уже существует")
    db.add(User(
        username=payload.username,
        email=payload.email,
        display_name=payload.display_name,
        hashed_password=get_password_hash(payload.password),
    ))
    await db.commit()
    return RegistrationChallengeResponse(registration_complete=True)


@router.post("/register", response_model=RegistrationChallengeResponse, status_code=status.HTTP_202_ACCEPTED)
async def register(
    request: Request,
    payload: RegistrationStart,
    db: AsyncSession = Depends(get_db),
):
    rate_limit_auth(request, "register_start", limit=5, window=600)
    if not settings.EMAIL_VERIFICATION_ENABLED:
        return await _register_without_email_verification(db, payload)
    try:
        return await start_registration(db, payload)
    except RegistrationError as exc:
        _raise_http(exc)


@router.post("/register/verify", response_model=UserSchema)
async def verify(
    request: Request,
    payload: RegistrationVerify,
    db: AsyncSession = Depends(get_db),
):
    rate_limit_auth(request, "register_verify", limit=20, window=600)
    if not settings.EMAIL_VERIFICATION_ENABLED:
        raise HTTPException(status_code=404, detail="Подтверждение почты временно недоступно")
    try:
        return await verify_registration(db, payload.challenge_id, payload.code)
    except RegistrationError as exc:
        _raise_http(exc)


@router.post("/register/resend", response_model=RegistrationChallengeResponse)
async def resend(
    request: Request,
    payload: RegistrationResend,
    db: AsyncSession = Depends(get_db),
):
    rate_limit_auth(request, "register_resend", limit=5, window=600)
    if not settings.EMAIL_VERIFICATION_ENABLED:
        raise HTTPException(status_code=404, detail="Подтверждение почты временно недоступно")
    try:
        return await resend_registration_code(db, payload.challenge_id)
    except RegistrationError as exc:
        _raise_http(exc)
