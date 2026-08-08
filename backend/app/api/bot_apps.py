from datetime import datetime, timezone
import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.core.security import get_password_hash
from app.db.database import get_db
from app.models.bot import BotApplication, BotApplicationSecret, BotAuditLog, BotToken
from app.models.user import User
from app.schemas.bot import (
    BotApplicationCreate,
    BotApplicationCreatedResponse,
    BotApplicationResponse,
    BotApplicationUpdate,
    BotIdentityResponse,
    BotPrincipalResponse,
    BotTokenResetResponse,
)
from app.services.bot_security import (
    BotPrincipal,
    bot_token_hint,
    generate_bot_token,
    generate_client_id,
    generate_signing_keypair,
    get_current_bot,
    hash_bot_token,
)


router = APIRouter()
MAX_APPLICATIONS_PER_OWNER = 10


def _ensure_enabled() -> None:
    if not settings.BOT_PLATFORM_ENABLED:
        raise HTTPException(status_code=404, detail="Not found")


def _serialize(application: BotApplication) -> BotApplicationResponse:
    return BotApplicationResponse(
        id=application.id,
        client_id=application.client_id,
        name=application.name,
        description=application.description,
        avatar_url=application.avatar_url,
        public_key=application.public_key,
        status=application.status,
        created_at=application.created_at,
        updated_at=application.updated_at,
        bot=BotIdentityResponse.model_validate(application.bot_user),
    )


async def _owned_application(db: AsyncSession, owner_id: int, application_id: int) -> BotApplication:
    result = await db.execute(
        select(BotApplication)
        .options(selectinload(BotApplication.bot_user), selectinload(BotApplication.secret))
        .where(BotApplication.id == application_id, BotApplication.owner_id == owner_id)
    )
    application = result.scalar_one_or_none()
    if application is None:
        raise HTTPException(status_code=404, detail="Bot application not found")
    return application


def _audit(application_id: int, actor_id: int | None, action: str, details: dict | None = None) -> BotAuditLog:
    return BotAuditLog(application_id=application_id, actor_id=actor_id, action=action, details=details)


@router.get("/bot-apps", response_model=list[BotApplicationResponse])
async def list_bot_applications(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    result = await db.execute(
        select(BotApplication)
        .options(selectinload(BotApplication.bot_user))
        .where(BotApplication.owner_id == current_user.id)
        .order_by(BotApplication.created_at.desc())
    )
    return [_serialize(application) for application in result.scalars().all()]


@router.post("/bot-apps", response_model=BotApplicationCreatedResponse, status_code=status.HTTP_201_CREATED)
async def create_bot_application(
    payload: BotApplicationCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    total = await db.scalar(select(func.count(BotApplication.id)).where(BotApplication.owner_id == current_user.id))
    if (total or 0) >= MAX_APPLICATIONS_PER_OWNER:
        raise HTTPException(status_code=400, detail="Application limit reached")

    client_id = generate_client_id()
    public_key, encrypted_private_key = generate_signing_keypair()
    token = generate_bot_token(client_id)
    bot_user = User(
        username=f"bot_{client_id}",
        email=f"{client_id}@bots.invalid",
        hashed_password=get_password_hash(secrets.token_urlsafe(48)),
        display_name=payload.name,
        avatar_url=payload.avatar_url,
        is_active=True,
        is_online=False,
        is_bot=True,
    )
    db.add(bot_user)
    await db.flush()

    application = BotApplication(
        owner_id=current_user.id,
        bot_user_id=bot_user.id,
        client_id=client_id,
        name=payload.name,
        description=payload.description,
        avatar_url=payload.avatar_url,
        public_key=public_key,
    )
    db.add(application)
    await db.flush()
    db.add_all([
        BotApplicationSecret(
            application_id=application.id,
            signing_private_key_ciphertext=encrypted_private_key,
            token_rotation_id=1,
        ),
        BotToken(
            application_id=application.id,
            token_hash=hash_bot_token(token),
            token_hint=bot_token_hint(token),
            rotation_id=1,
        ),
        _audit(application.id, current_user.id, "application_create", {"name": payload.name}),
    ])
    await db.commit()
    application = await _owned_application(db, current_user.id, application.id)
    return BotApplicationCreatedResponse(application=_serialize(application), bot_token=token)


@router.get("/bot-apps/{application_id}", response_model=BotApplicationResponse)
async def get_bot_application(
    application_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    return _serialize(await _owned_application(db, current_user.id, application_id))


@router.patch("/bot-apps/{application_id}", response_model=BotApplicationResponse)
async def update_bot_application(
    application_id: int,
    payload: BotApplicationUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _owned_application(db, current_user.id, application_id)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        application.name = changes["name"]
        application.bot_user.display_name = changes["name"]
    if "description" in changes:
        application.description = changes["description"]
    if "avatar_url" in changes:
        application.avatar_url = changes["avatar_url"] or None
        application.bot_user.avatar_url = changes["avatar_url"] or None
    application.updated_at = datetime.now(timezone.utc)
    db.add(_audit(application.id, current_user.id, "application_update", {"fields": sorted(changes.keys())}))
    await db.commit()
    return _serialize(await _owned_application(db, current_user.id, application_id))


@router.delete("/bot-apps/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disable_bot_application(
    application_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _owned_application(db, current_user.id, application_id)
    now = datetime.now(timezone.utc)
    application.status = "disabled"
    application.bot_user.is_active = False
    application.updated_at = now
    await db.execute(
        update(BotToken)
        .where(BotToken.application_id == application.id, BotToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.add(_audit(application.id, current_user.id, "application_disable"))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/bot-apps/{application_id}/reset-token", response_model=BotTokenResetResponse)
@router.post("/bot-apps/{application_id}/regenerate-secret", response_model=BotTokenResetResponse, include_in_schema=False)
async def reset_bot_token(
    application_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _owned_application(db, current_user.id, application_id)
    if application.status != "active":
        raise HTTPException(status_code=409, detail="Disabled applications cannot rotate tokens")
    now = datetime.now(timezone.utc)
    application.secret.token_rotation_id += 1
    rotation_id = application.secret.token_rotation_id
    token = generate_bot_token(application.client_id)
    await db.execute(
        update(BotToken)
        .where(BotToken.application_id == application.id, BotToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.add_all([
        BotToken(
            application_id=application.id,
            token_hash=hash_bot_token(token),
            token_hint=bot_token_hint(token),
            rotation_id=rotation_id,
        ),
        _audit(application.id, current_user.id, "token_reset", {"rotation_id": rotation_id}),
    ])
    await db.commit()
    return BotTokenResetResponse(bot_token=token, rotation_id=rotation_id)


@router.get("/bot/users/@me", response_model=BotPrincipalResponse)
async def get_bot_user(principal: BotPrincipal = Depends(get_current_bot)):
    return BotPrincipalResponse(application=_serialize(principal.application))
