"""Routes extracted mechanically from bot_platform.py; keep below 600 lines."""

from .bot_platform_shared import *  # noqa: F401,F403

router = APIRouter()

@router.get("/bot-apps/{application_id}/commands")
async def list_bot_commands(
    application_id: int,
    server_id: int | None = Query(default=None),
    include_disabled: bool = Query(default=False),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    query = select(BotCommand).where(BotCommand.application_id == application.id)
    if server_id is None:
        query = query.where(BotCommand.server_id.is_(None))
    else:
        query = query.where(BotCommand.server_id == server_id)
    if not include_disabled:
        query = query.where(BotCommand.is_enabled.is_(True))
    query = query.order_by(BotCommand.created_at.asc())
    result = await db.execute(query)
    return [_serialize_command(item) for item in result.scalars().all()]


@router.get("/bot-apps/{application_id}/commands/{command_id}")
async def get_bot_command(
    application_id: int,
    command_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    result = await db.execute(
        select(BotCommand).where(BotCommand.id == command_id, BotCommand.application_id == application.id)
    )
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")
    return _serialize_command(command)


@router.post("/bot-apps/{application_id}/commands", response_model=list[dict[str, Any]])
async def create_bot_command(
    application_id: int,
    payload: BotCommandCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    server_id = payload.server_id
    if server_id is not None:
        await require_permission(db, server_id, current_user, Permission.MANAGE_SERVER)
    command_name = _normalized_command_name(payload.name, payload.type)
    await _ensure_command_name_available(db, application.id, server_id, command_name, payload.type)
    db.add(
        BotCommand(
            application_id=application.id,
            server_id=server_id,
            name=command_name,
            description=payload.description,
            command_type=payload.type,
            definition=payload.definition or {},
            default_member_permissions=payload.default_member_permissions,
            legacy_default_member_permissions=(
                miscord_permissions_to_legacy(payload.default_member_permissions)
                if payload.default_member_permissions is not None
                else None
            ),
            dm_permission=payload.dm_permission,
            allowed_user_ids=payload.allowed_user_ids,
            allowed_role_ids=payload.allowed_role_ids,
            name_localizations=payload.name_localizations,
            description_localizations=payload.description_localizations,
            contexts=payload.contexts,
            integration_types=payload.integration_types,
            nsfw=payload.nsfw,
            is_enabled=True,
            version=1,
        )
    )
    await db.commit()
    return await list_bot_commands(application_id, server_id=server_id, current_user=current_user, db=db)


@router.put("/bot-apps/{application_id}/commands/{command_id}")
async def replace_bot_command(
    application_id: int,
    command_id: int,
    payload: BotCommandReplace,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    result = await db.execute(select(BotCommand).where(BotCommand.id == command_id, BotCommand.application_id == application.id))
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")

    if payload.server_id != command.server_id:
        if payload.server_id is not None:
            await require_permission(db, payload.server_id, current_user, Permission.MANAGE_SERVER)
        if command.server_id is not None:
            await require_permission(db, command.server_id, current_user, Permission.MANAGE_SERVER)

    target_name = _normalized_command_name(payload.name, payload.type)
    await _ensure_command_name_available(
        db,
        application.id,
        payload.server_id,
        target_name,
        payload.type,
        ignore_id=command.id,
    )

    command.server_id = payload.server_id
    command.name = target_name
    command.description = payload.description
    command.command_type = payload.type
    previous_definition = command.definition if isinstance(command.definition, dict) else {}
    command.definition = {
        **(payload.definition or {}),
        **({"guild_permissions": previous_definition["guild_permissions"]} if "guild_permissions" in previous_definition else {}),
    }
    command.default_member_permissions = payload.default_member_permissions
    command.legacy_default_member_permissions = (
        miscord_permissions_to_legacy(payload.default_member_permissions)
        if payload.default_member_permissions is not None
        else None
    )
    command.dm_permission = payload.dm_permission
    command.allowed_user_ids = payload.allowed_user_ids
    command.allowed_role_ids = payload.allowed_role_ids
    command.name_localizations = payload.name_localizations
    command.description_localizations = payload.description_localizations
    command.contexts = payload.contexts
    command.integration_types = payload.integration_types
    command.nsfw = payload.nsfw
    command.is_enabled = True
    command.version += 1
    command.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _serialize_command(command)


@router.patch("/bot-apps/{application_id}/commands/{command_id}")
async def update_bot_command(
    application_id: int,
    command_id: int,
    payload: BotCommandUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    result = await db.execute(select(BotCommand).where(BotCommand.id == command_id, BotCommand.application_id == application.id))
    command = result.scalar_one_or_none()
    if not command:
        raise HTTPException(status_code=404, detail="Command not found")
    if "server_id" in payload.model_fields_set and payload.server_id != command.server_id:
        if payload.server_id is not None:
            await require_permission(db, payload.server_id, current_user, Permission.MANAGE_SERVER)
        if command.server_id is not None:
            await require_permission(db, command.server_id, current_user, Permission.MANAGE_SERVER)
        command.server_id = payload.server_id
    if payload.name is not None:
        target_name = _normalized_command_name(payload.name, payload.type or int(command.command_type or 1))
        await _ensure_command_name_available(
            db,
            application.id,
            command.server_id,
            target_name,
            payload.type or int(command.command_type or 1),
            ignore_id=command.id,
        )
        command.name = target_name
    if payload.description is not None:
        command.description = payload.description
    if payload.type is not None:
        command.command_type = payload.type
    if payload.definition is not None:
        previous_definition = command.definition if isinstance(command.definition, dict) else {}
        command.definition = {
            **payload.definition,
            **({"guild_permissions": previous_definition["guild_permissions"]} if "guild_permissions" in previous_definition else {}),
        }
    if "default_member_permissions" in payload.model_fields_set:
        command.default_member_permissions = payload.default_member_permissions
        command.legacy_default_member_permissions = (
            miscord_permissions_to_legacy(payload.default_member_permissions)
            if payload.default_member_permissions is not None
            else None
        )
    if payload.dm_permission is not None:
        command.dm_permission = payload.dm_permission
    if payload.allowed_user_ids is not None:
        command.allowed_user_ids = payload.allowed_user_ids
    if payload.allowed_role_ids is not None:
        command.allowed_role_ids = payload.allowed_role_ids
    if "name_localizations" in payload.model_fields_set:
        command.name_localizations = payload.name_localizations
    if "description_localizations" in payload.model_fields_set:
        command.description_localizations = payload.description_localizations
    if "contexts" in payload.model_fields_set:
        command.contexts = payload.contexts
    if "integration_types" in payload.model_fields_set:
        command.integration_types = payload.integration_types
    if payload.nsfw is not None:
        command.nsfw = payload.nsfw
    if payload.is_enabled is not None:
        command.is_enabled = payload.is_enabled
    command.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return _serialize_command(command)


@router.delete("/bot-apps/{application_id}/commands/{command_id}", status_code=204)
async def delete_bot_command(
    application_id: int,
    command_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    result = await db.execute(select(BotCommand.id).where(BotCommand.application_id == application.id, BotCommand.id == command_id))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Command not found")
    await db.execute(delete(BotCommand).where(BotCommand.id == command_id))
    await db.commit()


@router.post("/bot-apps/{application_id}/commands/sync")
async def sync_bot_commands(
    application_id: int,
    server_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_enabled()
    application = await _application_by_id(db, application_id, owner_id=current_user.id)
    if server_id is not None:
        await require_permission(db, server_id, current_user, Permission.MANAGE_SERVER)
    query = select(BotCommand).where(BotCommand.application_id == application.id)
    if server_id is None:
        query = query.where(BotCommand.server_id.is_(None))
    else:
        query = query.where(BotCommand.server_id == server_id)
    query = query.where(BotCommand.is_enabled.is_(True))
    result = await db.execute(query)
    commands = result.scalars().all()
    for command in commands:
        command.version += 1
    await db.commit()
    return {
        "application_id": application.id,
        "server_id": server_id,
        "synced_commands": len(commands),
        "commands": [_serialize_command(item) for item in commands],
    }
