from datetime import datetime, timezone
import secrets

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.core.security import get_password_hash
from app.db.database import get_db
from app.models.bot import BotApplication, BotApplicationSecret, BotAuditLog, BotInstall, BotSession, BotToken
from app.models.channel import ChannelMember
from app.models.server_role import MemberRole, Role
from app.models.user import User
from app.schemas.bot import (
    BotApplicationCreate,
    BotApplicationCreatedResponse,
    BotApplicationResponse,
    BotApplicationUpdate,
    BotIdentityResponse,
    BotPrincipalResponse,
    BotClientSecretResetResponse,
    BotTokenResetResponse,
)
from app.services.bot_security import (
    BotPrincipal,
    bot_token_hint,
    generate_bot_token,
    generate_client_secret,
    generate_client_id,
    generate_signing_keypair,
    get_current_bot,
    hash_bot_token,
    hash_client_secret,
)
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.interaction_delivery import InteractionEndpointError, verify_interactions_endpoint


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
        bot_public=bool(application.bot_public),
        bot_require_code_grant=bool(application.bot_require_code_grant),
        terms_of_service_url=application.terms_of_service_url,
        privacy_policy_url=application.privacy_policy_url,
        redirect_uris=list(application.redirect_uris or []),
        interactions_endpoint_url=application.interactions_endpoint_url,
        event_webhooks_url=application.event_webhooks_url,
        event_webhooks_status=int(application.event_webhooks_status or 1),
        event_webhooks_types=list(application.event_webhooks_types or []),
        tags=list(application.tags or []),
        install_params=application.install_params,
        integration_types_config=dict(application.integration_types_config or {}),
        custom_install_url=application.custom_install_url,
        flags=int(application.flags or 0),
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
    client_secret = generate_client_secret()
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
        bot_public=payload.bot_public,
        bot_require_code_grant=payload.bot_require_code_grant,
        terms_of_service_url=payload.terms_of_service_url,
        privacy_policy_url=payload.privacy_policy_url,
        redirect_uris=payload.redirect_uris,
        interactions_endpoint_url=payload.interactions_endpoint_url,
        event_webhooks_url=payload.event_webhooks_url,
        event_webhooks_types=payload.event_webhooks_types,
        tags=payload.tags,
        install_params=payload.install_params,
        integration_types_config=payload.integration_types_config,
        custom_install_url=payload.custom_install_url,
    )
    db.add(application)
    await db.flush()
    if payload.interactions_endpoint_url:
        try:
            application.interactions_endpoint_url = await verify_interactions_endpoint(
                payload.interactions_endpoint_url,
                application,
                encrypted_private_key,
            )
        except InteractionEndpointError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.add_all([
        BotApplicationSecret(
            application_id=application.id,
            signing_private_key_ciphertext=encrypted_private_key,
            client_secret_hash=hash_client_secret(client_secret),
            client_secret_hint=client_secret[-6:],
            client_secret_rotation_id=1,
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
    return BotApplicationCreatedResponse(
        application=_serialize(application),
        bot_token=token,
        client_secret=client_secret,
    )


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
    if changes.get("interactions_endpoint_url"):
        try:
            changes["interactions_endpoint_url"] = await verify_interactions_endpoint(
                changes["interactions_endpoint_url"],
                application,
                application.secret.signing_private_key_ciphertext,
            )
        except InteractionEndpointError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    if "name" in changes:
        application.name = changes["name"]
        application.bot_user.display_name = changes["name"]
    if "description" in changes:
        application.description = changes["description"]
    if "avatar_url" in changes:
        application.avatar_url = changes["avatar_url"] or None
        application.bot_user.avatar_url = changes["avatar_url"] or None
    settings_fields = {
        "bot_public",
        "bot_require_code_grant",
        "terms_of_service_url",
        "privacy_policy_url",
        "redirect_uris",
        "interactions_endpoint_url",
        "event_webhooks_url",
        "event_webhooks_types",
        "tags",
        "custom_install_url",
        "install_params",
        "integration_types_config",
        "flags",
    }
    for field_name in settings_fields & changes.keys():
        setattr(application, field_name, changes[field_name])
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
    install_rows = await db.execute(
        select(BotInstall).where(BotInstall.application_id == application.id, BotInstall.status == "active")
    )
    installs = list(install_rows.scalars().all())
    server_ids = [int(item.server_id) for item in installs]
    if server_ids:
        await db.execute(
            delete(MemberRole).where(
                MemberRole.user_id == application.bot_user_id,
                MemberRole.server_id.in_(server_ids),
            )
        )
        await db.execute(
            delete(Role).where(Role.managed_by_bot_application_id == application.id)
        )
        await db.execute(
            delete(ChannelMember).where(
                ChannelMember.user_id == application.bot_user_id,
                ChannelMember.channel_id.in_(server_ids),
            )
        )
        for install in installs:
            install.status = "removed"
            install.updated_at = now
    await db.execute(
        update(BotSession)
        .where(BotSession.application_id == application.id)
        .values(is_active=False, is_resumable=False)
    )
    db.add(_audit(application.id, current_user.id, "application_disable"))
    await db.commit()
    await bot_event_dispatcher.disconnect_application(application.id, code=4004)
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
    await bot_event_dispatcher.disconnect_application(application.id, code=4004)
    return BotTokenResetResponse(bot_token=token, rotation_id=rotation_id)


@router.post("/bot-apps/{application_id}/reset-client-secret", response_model=BotClientSecretResetResponse)
async def reset_client_secret(
    application_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _owned_application(db, current_user.id, application_id)
    if application.status != "active":
        raise HTTPException(status_code=409, detail="Disabled applications cannot rotate secrets")
    secret = generate_client_secret()
    application.secret.client_secret_rotation_id += 1
    application.secret.client_secret_hash = hash_client_secret(secret)
    application.secret.client_secret_hint = secret[-6:]
    db.add(_audit(
        application.id,
        current_user.id,
        "client_secret_reset",
        {"rotation_id": application.secret.client_secret_rotation_id},
    ))
    await db.commit()
    return BotClientSecretResetResponse(
        client_secret=secret,
        rotation_id=application.secret.client_secret_rotation_id,
    )


@router.get("/bot/users/@me", response_model=BotPrincipalResponse)
async def get_bot_user(principal: BotPrincipal = Depends(get_current_bot)):
    return BotPrincipalResponse(application=_serialize(principal.application))
