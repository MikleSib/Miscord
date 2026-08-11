from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
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


@router.post("/register", response_model=RegistrationChallengeResponse, status_code=status.HTTP_202_ACCEPTED)
async def register(
    request: Request,
    payload: RegistrationStart,
    db: AsyncSession = Depends(get_db),
):
    rate_limit_auth(request, "register_start", limit=5, window=600)
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
    try:
        return await resend_registration_code(db, payload.challenge_id)
    except RegistrationError as exc:
        _raise_http(exc)

