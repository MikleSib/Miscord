"""Routes extracted mechanically from bot_client.py; keep below 600 lines."""

from .bot_client_shared import *  # noqa: F401,F403

router = APIRouter()

@router.get("/channels/{channel_id}/application-commands")
async def list_channel_application_commands(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await require_text_channel_access(db, current_user, channel_id)
    permissions = await get_member_permissions(db, channel.channel_id, current_user.id)
    if not has_permission(permissions, Permission.USE_APPLICATION_COMMANDS):
        return {"applications": [], "commands": []}
    role_ids = await _member_roles(db, channel.channel_id, current_user.id)
    server_result = await db.execute(
        select(BotCommand, BotApplication)
        .join(BotApplication, BotApplication.id == BotCommand.application_id)
        .join(BotInstall, and_(
            BotInstall.application_id == BotApplication.id,
            BotInstall.server_id == channel.channel_id,
            BotInstall.status == "active",
        ))
        .where(
            BotApplication.status == "active",
            BotCommand.is_enabled.is_(True),
            or_(BotCommand.server_id == channel.channel_id, BotCommand.server_id.is_(None)),
        )
        .order_by(BotCommand.server_id.desc().nullslast(), BotCommand.name, BotCommand.command_type)
    )
    selected: dict[tuple[int, str, int], tuple[BotCommand, BotApplication]] = {}
    for command, application in server_result.all():
        key = (application.id, command.name, int(command.command_type))
        if key not in selected and _command_supports(command, 0, 0) and _command_allowed(
            command,
            permissions,
            current_user.id,
            role_ids,
            channel.channel_id,
            channel.id,
        ):
            selected[key] = (command, application)
    user_result = await db.execute(
        select(BotCommand, BotApplication)
        .join(BotApplication, BotApplication.id == BotCommand.application_id)
        .join(BotUserInstall, and_(
            BotUserInstall.application_id == BotApplication.id,
            BotUserInstall.user_id == current_user.id,
            BotUserInstall.status == "active",
        ))
        .where(
            BotApplication.status == "active",
            BotCommand.is_enabled.is_(True),
            BotCommand.server_id.is_(None),
        )
        .order_by(BotCommand.name, BotCommand.command_type)
    )
    for command, application in user_result.all():
        key = (application.id, command.name, int(command.command_type))
        if key not in selected and _command_supports(command, 1, 0) and _command_allowed(
            command,
            permissions,
            current_user.id,
            role_ids,
            channel.channel_id,
            channel.id,
        ):
            selected[key] = (command, application)
    apps: dict[int, dict[str, Any]] = {}
    commands = []
    for command, application in selected.values():
        apps[application.id] = {
            "id": application.client_id,
            "name": application.name,
            "icon": application.avatar_url,
            "description": application.description or "",
        }
        commands.append(miscord_command(command, application_client_id=application.client_id))
    return {"applications": list(apps.values()), "commands": commands}


async def _command_context(
    db: AsyncSession,
    channel_id: int,
    application_client_id: str,
    command_id: int,
    current_user: User,
):
    channel = await require_text_channel_access(db, current_user, channel_id)
    permissions = await get_member_permissions(db, channel.channel_id, current_user.id)
    if not has_permission(permissions, Permission.USE_APPLICATION_COMMANDS):
        raise HTTPException(status_code=403, detail="You cannot use application commands in this channel")
    result = await db.execute(
        select(BotCommand, BotApplication)
        .join(BotApplication, BotApplication.id == BotCommand.application_id)
        .options(selectinload(BotApplication.bot_user), selectinload(BotApplication.secret))
        .where(
            BotApplication.client_id == application_client_id,
            BotApplication.status == "active",
            BotCommand.id == command_id,
            BotCommand.is_enabled.is_(True),
            or_(BotCommand.server_id == channel.channel_id, BotCommand.server_id.is_(None)),
        )
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=404, detail="Application command not found")
    command, application = row
    server_install = await db.scalar(select(BotInstall).where(
        BotInstall.application_id == application.id,
        BotInstall.server_id == channel.channel_id,
        BotInstall.status == "active",
    ))
    user_install = await db.scalar(select(BotUserInstall).where(
        BotUserInstall.application_id == application.id,
        BotUserInstall.user_id == current_user.id,
        BotUserInstall.status == "active",
    ))
    integration_type: int
    if server_install is not None and _command_supports(command, 0, 0):
        integration_type = 0
    elif user_install is not None and command.server_id is None and _command_supports(command, 1, 0):
        integration_type = 1
    else:
        raise HTTPException(status_code=404, detail="Application command is not available in this context")
    role_ids = await _member_roles(db, channel.channel_id, current_user.id)
    if not _command_allowed(
        command,
        permissions,
        current_user.id,
        role_ids,
        channel.channel_id,
        channel.id,
    ):
        raise HTTPException(status_code=403, detail="You do not have permission to use this command")
    app_permissions = int(server_install.permissions or 0) if server_install is not None and integration_type == 0 else permissions
    authorizing_owners = (
        {"0": str(channel.channel_id)} if integration_type == 0 else {"1": str(current_user.id)}
    )
    return channel, command, application, app_permissions, permissions, role_ids, authorizing_owners


async def _deliver(db: AsyncSession, interaction: BotInteraction, application: BotApplication) -> tuple[str, int]:
    if application.interactions_endpoint_url:
        try:
            callback_data = await deliver_interaction_http(
                application,
                application.secret.signing_private_key_ciphertext,
                interaction.request_payload,
            )
            from app.schemas.miscord import MiscordInteractionCallback
            await apply_initial_callback(db, interaction, MiscordInteractionCallback.model_validate(callback_data))
            return "responded", 1
        except (InteractionEndpointError, ValueError):
            return "failed", 0
    delivered = await bot_event_dispatcher.dispatch_interaction_create(db, interaction)
    return ("pending" if delivered else "offline"), delivered


def _modal_inputs(modal: dict[str, Any]) -> dict[str, dict[str, Any]]:
    inputs: dict[str, dict[str, Any]] = {}
    for row in modal.get("components") or []:
        if not isinstance(row, dict):
            continue
        children = row.get("components") if _as_int(row.get("type")) == 1 else [row]
        for child in children or []:
            if not isinstance(child, dict) or _as_int(child.get("type")) != 4:
                continue
            custom_id = str(child.get("custom_id") or "")
            if custom_id:
                inputs[custom_id] = child
    return inputs


def _validate_modal_submission(source: BotInteraction, raw_components: Any, custom_id: str) -> list[dict[str, Any]]:
    modal = (source.response_payload or {}).get("data")
    if not isinstance(modal, dict) or source.response_type != 9 or str(modal.get("custom_id") or "") != custom_id:
        raise HTTPException(status_code=400, detail="Modal is no longer valid")
    definitions = _modal_inputs(modal)
    if not definitions or not isinstance(raw_components, list) or len(raw_components) > 5:
        raise HTTPException(status_code=400, detail="Invalid modal components")
    submitted: dict[str, str] = {}
    for row in raw_components:
        if not isinstance(row, dict):
            raise HTTPException(status_code=400, detail="Invalid modal component")
        children = row.get("components") if _as_int(row.get("type")) == 1 else [row]
        if not isinstance(children, list) or len(children) != 1:
            raise HTTPException(status_code=400, detail="Each modal row must contain one text input")
        child = children[0]
        if not isinstance(child, dict) or _as_int(child.get("type")) != 4:
            raise HTTPException(status_code=400, detail="Modal submissions only support text inputs")
        input_id = str(child.get("custom_id") or "")
        if input_id not in definitions or input_id in submitted:
            raise HTTPException(status_code=400, detail="Unknown modal input")
        value = str(child.get("value") or "")
        definition = definitions[input_id]
        minimum = max(0, _as_int(definition.get("min_length")))
        maximum = min(4000, max(1, _as_int(definition.get("max_length"), 4000)))
        if definition.get("required", True) and not value:
            raise HTTPException(status_code=400, detail=f"Modal input {input_id} is required")
        if value and not minimum <= len(value) <= maximum:
            raise HTTPException(status_code=400, detail=f"Modal input {input_id} has an invalid length")
        submitted[input_id] = value
    if any(definition.get("required", True) and input_id not in submitted for input_id, definition in definitions.items()):
        raise HTTPException(status_code=400, detail="Required modal inputs are missing")
    return [
        {"type": 1, "components": [{"type": 4, "custom_id": input_id, "value": value}]}
        for input_id, value in submitted.items()
    ]
