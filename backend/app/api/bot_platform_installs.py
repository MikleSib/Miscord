"""Routes extracted mechanically from bot_platform.py; keep below 600 lines."""

from .bot_platform_shared import *  # noqa: F401,F403

router = APIRouter()

@router.get("/bot-apps/{application_id}/invite-link")
async def get_bot_invite_link(
    application_id: int,
    permissions: int | None = Query(default=None, ge=0),
    scope: str = Query(default="bot applications.commands"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    scopes = _parse_scopes(scope)
    result = await db.execute(
        select(BotApplication).where(
            BotApplication.id == application_id,
            BotApplication.owner_id == current_user.id,
            BotApplication.status == "active",
        )
    )
    application = result.scalar_one_or_none()
    if not application:
        raise HTTPException(status_code=404, detail="Bot application not found")

    if application.custom_install_url:
        return {"invite_url": application.custom_install_url}
    if isinstance(application.integration_types_config, dict) and application.integration_types_config:
        return {
            "invite_url": build_bot_authorize_url(
                settings.SERVER_HOST,
                application.client_id,
            )
        }

    permissions = _resolve_invite_permissions(application, permissions)

    return {
        "invite_url": build_bot_authorize_url(
            settings.SERVER_HOST,
            application.client_id,
            scopes,
            permissions,
        )
    }


@router.get("/bot/oauth/callback")
async def get_bot_oauth_callback(
    client_id: str,
    scope: str = "bot",
    permissions: int = 0,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await _application_by_client_id(db, client_id)
    scopes = _parse_scopes(scope)
    permissions = _validate_permissions(permissions)
    return {
        "authorize_url": build_bot_authorize_url(
            settings.SERVER_HOST,
            client_id,
            scopes,
            permissions,
        )
    }


@router.get("/bot/oauth/authorize")
async def get_bot_authorization(
    client_id: str,
    scope: str = "bot",
    permissions: int = 0,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    scopes = _parse_scopes(scope)
    permissions = _validate_permissions(permissions)
    application = await _application_by_client_id(db, client_id)
    servers_result = await db.execute(
        select(Channel)
        .outerjoin(
            ChannelMember,
            (ChannelMember.channel_id == Channel.id) & (ChannelMember.user_id == current_user.id),
        )
        .where(or_(Channel.owner_id == current_user.id, ChannelMember.user_id == current_user.id))
        .order_by(Channel.name.asc())
    )
    servers = list(servers_result.scalars().unique().all())
    install_result = await db.execute(
        select(BotInstall.server_id).where(
            BotInstall.application_id == application.id,
            BotInstall.status == "active",
        )
    )
    installed_ids = set(install_result.scalars().all())
    eligible = []
    for server in servers:
        effective = await get_member_permissions(db, server.id, current_user.id, owner_id=server.owner_id)
        if current_user.id != server.owner_id and not effective & int(Permission.MANAGE_SERVER):
            continue
        eligible.append({
            "id": server.id,
            "name": server.name,
            "icon": server.icon,
            "already_installed": server.id in installed_ids,
            "can_grant": permissions & ~effective == 0,
        })
    return {
        "application": _serialize_application(application),
        "scopes": scopes,
        "permissions": permissions,
        "permission_names": _permission_names(permissions),
        "servers": eligible,
    }


@router.post("/bot/oauth/authorize")
async def authorize_bot_install(
    payload: BotInstallRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    scopes = _parse_scopes(payload.scope)
    requested = _validate_permissions(payload.permissions)
    application = await _application_by_client_id(db, payload.client_id)
    server_result = await db.execute(select(Channel).where(Channel.id == payload.server_id))
    server = server_result.scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    effective = await require_permission(db, server.id, current_user, Permission.MANAGE_SERVER)
    if requested & ~effective:
        raise HTTPException(status_code=403, detail="You cannot grant permissions you do not have")

    install_result = await db.execute(
        select(BotInstall)
        .where(BotInstall.application_id == application.id, BotInstall.server_id == server.id)
        .with_for_update()
    )
    install = install_result.scalar_one_or_none()
    was_existing = install is not None
    was_active = bool(install is not None and install.status == "active")
    previous_permissions = int(install.permissions or 0) if was_existing else int(requested)
    previous_intents = int(install.intents or 0) if was_existing else int(payload.intents)
    previous_scopes = list(install.scopes) if was_existing and isinstance(install.scopes, list) else None
    role = await db.get(Role, install.role_id) if install and install.role_id else None
    if role is None:
        role_result = await db.execute(
            select(Role).where(
                Role.server_id == server.id,
                Role.managed_by_bot_application_id == application.id,
            )
        )
        role = role_result.scalar_one_or_none()
    if role is None:
        position_result = await db.execute(select(func.max(Role.position)).where(Role.server_id == server.id))
        role = Role(
            server_id=server.id,
            name=application.name,
            color="#5865f2",
            position=int(position_result.scalar() or 0) + 1,
            permissions=requested,
            legacy_permissions=miscord_permissions_to_legacy(requested),
            is_default=False,
            managed_by_bot_application_id=application.id,
        )
        db.add(role)
        await db.flush()
    else:
        role.name = application.name
        role.permissions = requested
        role.legacy_permissions = miscord_permissions_to_legacy(requested)

    membership_result = await db.execute(
        select(ChannelMember).where(
            ChannelMember.channel_id == server.id,
            ChannelMember.user_id == application.bot_user_id,
        )
    )
    if membership_result.scalar_one_or_none() is None:
        db.add(ChannelMember(channel_id=server.id, user_id=application.bot_user_id))
    member_role_result = await db.execute(
        select(MemberRole).where(MemberRole.role_id == role.id, MemberRole.user_id == application.bot_user_id)
    )
    if member_role_result.scalar_one_or_none() is None:
        db.add(MemberRole(server_id=server.id, role_id=role.id, user_id=application.bot_user_id))
    if install is None:
        install = BotInstall(application_id=application.id, server_id=server.id, installed_by_id=current_user.id)
        db.add(install)
    install.intents = payload.intents
    install.installed_by_id = current_user.id
    install.role_id = role.id
    install.scopes = scopes
    install.permissions = requested
    install.legacy_permissions = miscord_permissions_to_legacy(requested)
    install.status = "active"
    await db.commit()
    if not was_active:
        await bot_event_dispatcher.dispatch_install_create(
            application.id,
            server.id,
            permissions=requested,
            intents=payload.intents,
            scopes=scopes,
        )
        queue_event_webhook(application, "APPLICATION_AUTHORIZED", {
            "integration_type": 0,
            "user": miscord_user(current_user),
            "scopes": scopes,
            "guild": {"id": str(server.id), "name": server.name, "icon": server.icon},
        })
    elif (
        previous_permissions != requested
        or previous_intents != payload.intents
        or previous_scopes != scopes
    ):
        await bot_event_dispatcher.dispatch_install_update(
            application.id,
            server.id,
            permissions=requested,
            intents=payload.intents,
            scopes=scopes,
        )
    return {
        "installed": True,
        "application": _serialize_application(application),
        "server": {"id": server.id, "name": server.name, "icon": server.icon},
        "permissions": requested,
        "scopes": scopes,
    }


@router.get("/servers/{server_id}/bots")
async def list_installed_bots(
    server_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await require_permission(db, server_id, current_user, Permission.MANAGE_SERVER)
    result = await db.execute(
        select(BotInstall)
        .options(selectinload(BotInstall.application).selectinload(BotApplication.bot_user))
        .where(BotInstall.server_id == server_id, BotInstall.status == "active")
        .order_by(BotInstall.installed_at.desc())
    )
    return {
        "bots": [{
            "application": _serialize_application(item.application),
            "permissions": int(item.permissions or 0),
            "permission_names": _permission_names(int(item.permissions or 0)),
            "scopes": item.scopes or [],
            "installed_at": item.installed_at,
            "installed_by_id": item.installed_by_id,
        } for item in result.scalars().all()]
    }


@router.delete("/servers/{server_id}/bots/{application_id}", status_code=204)
async def uninstall_bot(
    server_id: int,
    application_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    await require_permission(db, server_id, current_user, Permission.MANAGE_SERVER)
    result = await db.execute(
        select(BotInstall)
        .options(
            selectinload(BotInstall.application).selectinload(BotApplication.secret),
            selectinload(BotInstall.application).selectinload(BotApplication.bot_user),
        )
        .where(
            BotInstall.server_id == server_id,
            BotInstall.application_id == application_id,
            BotInstall.status == "active",
        )
        .with_for_update()
    )
    install = result.scalar_one_or_none()
    if not install:
        raise HTTPException(status_code=404, detail="Bot installation not found")
    bot_user_id = install.application.bot_user_id
    if install.role_id:
        await db.execute(delete(MemberRole).where(MemberRole.role_id == install.role_id))
        await db.execute(delete(Role).where(Role.id == install.role_id))
    await db.execute(delete(MemberRole).where(MemberRole.server_id == server_id, MemberRole.user_id == bot_user_id))
    await db.execute(delete(ChannelMember).where(ChannelMember.channel_id == server_id, ChannelMember.user_id == bot_user_id))
    install.role_id = None
    install.status = "revoked"
    await db.commit()
    await bot_event_dispatcher.dispatch_install_delete(
        application_id,
        server_id,
        reason="revoked",
    )
    queue_event_webhook(install.application, "APPLICATION_DEAUTHORIZED", {
        "user": miscord_user(current_user),
    })
