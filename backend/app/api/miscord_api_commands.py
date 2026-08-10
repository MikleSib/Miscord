"""Routes extracted mechanically from miscord_api.py; keep below 600 lines."""

from .miscord_api_shared import *  # noqa: F401,F403

router = APIRouter()

def _command_scope(application_id: int, guild_id: int | None) -> list[Any]:
    clauses: list[Any] = [BotCommand.application_id == application_id]
    clauses.append(BotCommand.server_id == guild_id if guild_id is not None else BotCommand.server_id.is_(None))
    return clauses


async def _upsert_command(
    db: AsyncSession,
    principal: BotPrincipal,
    payload: MiscordApplicationCommandPayload,
    *,
    guild_id: int | None,
) -> tuple[BotCommand, bool]:
    if guild_id is not None:
        await _active_install(db, principal, guild_id)
    result = await db.execute(select(BotCommand).where(
        *_command_scope(principal.application.id, guild_id),
        BotCommand.name == payload.name,
        BotCommand.command_type == payload.type,
    ))
    command = result.scalar_one_or_none()
    created = command is None
    if command is None:
        limits = {1: 100, 2: 5, 3: 5, 4: 1}
        count = await db.scalar(select(func.count(BotCommand.id)).where(
            *_command_scope(principal.application.id, guild_id),
            BotCommand.command_type == payload.type,
        ))
        if int(count or 0) >= limits[payload.type]:
            raise MiscordAPIError(400, 30032, "Maximum number of application commands reached")
        command = BotCommand(application_id=principal.application.id, server_id=guild_id)
        db.add(command)
    command.name = payload.name
    command.description = payload.description
    command.command_type = payload.type
    command.name_localizations = payload.name_localizations
    command.description_localizations = payload.description_localizations
    command.default_member_permissions = int(payload.default_member_permissions) if payload.default_member_permissions is not None else None
    command.legacy_default_member_permissions = (
        miscord_permissions_to_legacy(command.default_member_permissions)
        if command.default_member_permissions is not None
        else None
    )
    command.dm_permission = True if payload.dm_permission is None else payload.dm_permission
    command.contexts = payload.contexts
    command.integration_types = payload.integration_types
    command.nsfw = payload.nsfw
    previous_definition = command.definition if isinstance(command.definition, dict) else {}
    command.definition = {
        "options": payload.options,
        **({"handler": payload.handler} if payload.handler is not None else {}),
        **({"guild_permissions": previous_definition["guild_permissions"]} if "guild_permissions" in previous_definition else {}),
    }
    command.version = 1 if created else int(command.version or 0) + 1
    command.is_enabled = True
    command.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(command)
    return command, created


async def _list_commands(db: AsyncSession, principal: BotPrincipal, guild_id: int | None) -> list[dict[str, Any]]:
    if guild_id is not None:
        await _active_install(db, principal, guild_id)
    result = await db.execute(
        select(BotCommand)
        .where(*_command_scope(principal.application.id, guild_id), BotCommand.is_enabled.is_(True))
        .order_by(BotCommand.id)
    )
    return [miscord_command(item, application_client_id=principal.application.client_id) for item in result.scalars().all()]


@router.get("/applications/{application_id}/commands")
async def list_global_commands(
    application_id: str,
    with_localizations: bool = Query(default=False),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    return await _list_commands(db, principal, None)


@router.get("/applications/{application_id}/guilds/{guild_id}/commands")
async def list_guild_commands(
    application_id: str,
    guild_id: int,
    with_localizations: bool = Query(default=False),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    return await _list_commands(db, principal, guild_id)


@router.post("/applications/{application_id}/commands")
async def create_global_command(
    application_id: str,
    raw_payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    try:
        payload = MiscordApplicationCommandPayload.model_validate(raw_payload)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    command, created = await _upsert_command(db, principal, payload, guild_id=None)
    return miscord_command(command, application_client_id=principal.application.client_id)


@router.post("/applications/{application_id}/guilds/{guild_id}/commands")
async def create_guild_command(
    application_id: str,
    guild_id: int,
    raw_payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    try:
        payload = MiscordApplicationCommandPayload.model_validate(raw_payload)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    command, created = await _upsert_command(db, principal, payload, guild_id=guild_id)
    return miscord_command(command, application_client_id=principal.application.client_id)


async def _get_command(db: AsyncSession, principal: BotPrincipal, command_id: int, guild_id: int | None) -> BotCommand:
    result = await db.execute(select(BotCommand).where(
        *_command_scope(principal.application.id, guild_id),
        BotCommand.id == command_id,
        BotCommand.is_enabled.is_(True),
    ))
    command = result.scalar_one_or_none()
    if command is None:
        raise UNKNOWN_COMMAND()
    return command


def _command_permissions_payload(command: BotCommand, application_id: str, guild_id: int) -> dict[str, Any]:
    definition = command.definition if isinstance(command.definition, dict) else {}
    by_guild = definition.get("guild_permissions")
    permissions = by_guild.get(str(guild_id), []) if isinstance(by_guild, dict) else []
    return {
        "id": str(command.id),
        "application_id": application_id,
        "guild_id": str(guild_id),
        "permissions": list(permissions) if isinstance(permissions, list) else [],
    }


@router.get("/applications/{application_id}/guilds/{guild_id}/commands/permissions")
async def get_guild_application_command_permissions(
    application_id: str,
    guild_id: int,
    principal: OAuthPrincipal = Depends(get_command_permissions_oauth),
    db: AsyncSession = Depends(get_db),
):
    if principal.application.client_id != application_id:
        raise MISSING_ACCESS()
    if not has_permission(await get_member_permissions(db, guild_id, principal.user.id), Permission.MANAGE_GUILD):
        raise MISSING_PERMISSIONS()
    install = await db.scalar(select(BotInstall.id).where(
        BotInstall.application_id == principal.application.id,
        BotInstall.server_id == guild_id,
        BotInstall.status == "active",
    ))
    if install is None:
        raise MISSING_ACCESS()
    result = await db.execute(select(BotCommand).where(
        BotCommand.application_id == principal.application.id,
        BotCommand.is_enabled.is_(True),
        or_(BotCommand.server_id == guild_id, BotCommand.server_id.is_(None)),
    ).order_by(BotCommand.id))
    return [_command_permissions_payload(command, application_id, guild_id) for command in result.scalars().all()]


async def _guild_permission_command(
    db: AsyncSession,
    application_id: int,
    guild_id: int,
    command_id: int,
) -> BotCommand:
    command = await db.scalar(select(BotCommand).where(
        BotCommand.application_id == application_id,
        BotCommand.id == command_id,
        BotCommand.is_enabled.is_(True),
        or_(BotCommand.server_id == guild_id, BotCommand.server_id.is_(None)),
    ))
    if command is None:
        raise UNKNOWN_COMMAND()
    return command


@router.get("/applications/{application_id}/guilds/{guild_id}/commands/{command_id}/permissions")
async def get_application_command_permissions(
    application_id: str,
    guild_id: int,
    command_id: int,
    principal: OAuthPrincipal = Depends(get_command_permissions_oauth),
    db: AsyncSession = Depends(get_db),
):
    if principal.application.client_id != application_id:
        raise MISSING_ACCESS()
    if not has_permission(await get_member_permissions(db, guild_id, principal.user.id), Permission.MANAGE_GUILD):
        raise MISSING_PERMISSIONS()
    command = await _guild_permission_command(db, principal.application.id, guild_id, command_id)
    return _command_permissions_payload(command, application_id, guild_id)


@router.put("/applications/{application_id}/guilds/{guild_id}/commands/{command_id}/permissions")
async def edit_application_command_permissions(
    application_id: str,
    guild_id: int,
    command_id: int,
    payload: dict[str, Any] = Body(...),
    principal: OAuthPrincipal = Depends(get_command_permissions_oauth),
    db: AsyncSession = Depends(get_db),
):
    if principal.application.client_id != application_id or principal.user is None:
        raise MISSING_ACCESS()
    permissions = await get_member_permissions(db, guild_id, principal.user.id)
    if not has_permission(permissions, Permission.MANAGE_GUILD):
        raise MISSING_PERMISSIONS()
    command = await _guild_permission_command(db, principal.application.id, guild_id, command_id)
    raw_permissions = payload.get("permissions")
    if not isinstance(raw_permissions, list) or len(raw_permissions) > 100:
        raise MiscordAPIError(400, 50035, "permissions must be an array with at most 100 entries")
    cleaned: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for item in raw_permissions:
        if not isinstance(item, dict):
            raise MiscordAPIError(400, 50035, "Each command permission must be an object")
        try:
            permission_type = int(item.get("type"))
            target_id = str(int(item.get("id")))
        except (TypeError, ValueError) as exc:
            raise MiscordAPIError(400, 50035, "Invalid command permission target") from exc
        if permission_type not in {1, 2, 3} or (permission_type, target_id) in seen:
            raise MiscordAPIError(400, 50035, "Invalid or duplicate command permission target")
        seen.add((permission_type, target_id))
        cleaned.append({"id": target_id, "type": permission_type, "permission": bool(item.get("permission"))})
    definition = dict(command.definition) if isinstance(command.definition, dict) else {}
    by_guild = dict(definition.get("guild_permissions") or {})
    by_guild[str(guild_id)] = cleaned
    definition["guild_permissions"] = by_guild
    command.definition = definition
    command.version += 1
    await db.commit()
    return _command_permissions_payload(command, application_id, guild_id)


@router.get("/applications/{application_id}/commands/{command_id}")
async def get_global_command(
    application_id: str,
    command_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    return miscord_command(await _get_command(db, principal, command_id, None), application_client_id=principal.application.client_id)


@router.get("/applications/{application_id}/guilds/{guild_id}/commands/{command_id}")
async def get_guild_command(
    application_id: str,
    guild_id: int,
    command_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    await _active_install(db, principal, guild_id)
    return miscord_command(await _get_command(db, principal, command_id, guild_id), application_client_id=principal.application.client_id)


async def _edit_command(
    db: AsyncSession,
    principal: BotPrincipal,
    command_id: int,
    guild_id: int | None,
    raw_payload: dict[str, Any],
) -> dict[str, Any]:
    command = await _get_command(db, principal, command_id, guild_id)
    current = miscord_command(command, application_client_id=principal.application.client_id)
    merged = {
        "name": current["name"],
        "description": current["description"],
        "type": current["type"],
        "options": current["options"],
        "default_member_permissions": current["default_member_permissions"],
        "dm_permission": current["dm_permission"],
        "nsfw": current["nsfw"],
        "name_localizations": current["name_localizations"],
        "description_localizations": current["description_localizations"],
        "integration_types": current["integration_types"],
        "contexts": current["contexts"],
        **raw_payload,
    }
    try:
        payload = MiscordApplicationCommandPayload.model_validate(merged)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    command.name = payload.name
    command.description = payload.description
    command.name_localizations = payload.name_localizations
    command.description_localizations = payload.description_localizations
    previous_definition = command.definition if isinstance(command.definition, dict) else {}
    command.definition = {
        "options": payload.options,
        **({"handler": payload.handler} if payload.handler is not None else {}),
        **({"guild_permissions": previous_definition["guild_permissions"]} if "guild_permissions" in previous_definition else {}),
    }
    command.default_member_permissions = int(payload.default_member_permissions) if payload.default_member_permissions is not None else None
    command.legacy_default_member_permissions = (
        miscord_permissions_to_legacy(command.default_member_permissions)
        if command.default_member_permissions is not None
        else None
    )
    command.dm_permission = True if payload.dm_permission is None else payload.dm_permission
    command.nsfw = payload.nsfw
    command.integration_types = payload.integration_types
    command.contexts = payload.contexts
    command.version += 1
    await db.commit()
    return miscord_command(command, application_client_id=principal.application.client_id)


@router.patch("/applications/{application_id}/commands/{command_id}")
async def edit_global_command(
    application_id: str,
    command_id: int,
    raw_payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    return await _edit_command(db, principal, command_id, None, raw_payload)


@router.patch("/applications/{application_id}/guilds/{guild_id}/commands/{command_id}")
async def edit_guild_command(
    application_id: str,
    guild_id: int,
    command_id: int,
    raw_payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    await _active_install(db, principal, guild_id)
    return await _edit_command(db, principal, command_id, guild_id, raw_payload)


async def _delete_command(db: AsyncSession, principal: BotPrincipal, command_id: int, guild_id: int | None) -> None:
    command = await _get_command(db, principal, command_id, guild_id)
    await db.delete(command)
    await db.commit()


@router.delete("/applications/{application_id}/commands/{command_id}", status_code=204)
async def delete_global_command(
    application_id: str,
    command_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    await _delete_command(db, principal, command_id, None)
    return Response(status_code=204)


@router.delete("/applications/{application_id}/guilds/{guild_id}/commands/{command_id}", status_code=204)
async def delete_guild_command(
    application_id: str,
    guild_id: int,
    command_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    await _active_install(db, principal, guild_id)
    await _delete_command(db, principal, command_id, guild_id)
    return Response(status_code=204)


async def _bulk_overwrite(
    db: AsyncSession,
    principal: BotPrincipal,
    guild_id: int | None,
    raw_payload: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    parsed: list[MiscordApplicationCommandPayload] = []
    try:
        parsed = [MiscordApplicationCommandPayload.model_validate(item) for item in raw_payload]
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    keys = [(item.name, item.type) for item in parsed]
    if len(keys) != len(set(keys)):
        raise MiscordAPIError(400, 50035, "Command names and types must be unique")
    existing_result = await db.execute(select(BotCommand).where(*_command_scope(principal.application.id, guild_id)))
    existing = {(item.name, int(item.command_type)): item for item in existing_result.scalars().all()}
    output = []
    for item in parsed:
        command, _ = await _upsert_command(db, principal, item, guild_id=guild_id)
        output.append(miscord_command(command, application_client_id=principal.application.client_id))
    remove_ids = [item.id for key, item in existing.items() if key not in set(keys)]
    if remove_ids:
        await db.execute(delete(BotCommand).where(BotCommand.id.in_(remove_ids)))
        await db.commit()
    return output


@router.put("/applications/{application_id}/commands")
async def bulk_overwrite_global_commands(
    application_id: str,
    raw_payload: list[dict[str, Any]] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    return await _bulk_overwrite(db, principal, None, raw_payload)


@router.put("/applications/{application_id}/guilds/{guild_id}/commands")
async def bulk_overwrite_guild_commands(
    application_id: str,
    guild_id: int,
    raw_payload: list[dict[str, Any]] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    await _active_install(db, principal, guild_id)
    return await _bulk_overwrite(db, principal, guild_id, raw_payload)
