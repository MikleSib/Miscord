"""Routes extracted mechanically from bot_client.py; keep below 600 lines."""

from .bot_client_shared import *  # noqa: F401,F403
from .bot_client_commands import _command_context, _deliver, _validate_modal_submission

router = APIRouter()

@router.post("/channels/{channel_id}/interactions")
async def create_channel_interaction(
    channel_id: int,
    payload: ClientInteractionCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        command_id = int(payload.command_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid command id") from exc
    channel, command, application, app_permissions, permissions, role_ids, authorizing_owners = await _command_context(
        db, channel_id, payload.application_id, command_id, current_user
    )
    membership = await db.scalar(select(ChannelMember).where(
        ChannelMember.channel_id == channel.channel_id,
        ChannelMember.user_id == current_user.id,
    ))
    data = dict(payload.data)
    data.update({"id": str(command.id), "name": command.name, "type": int(command.command_type)})
    command_type = int(command.command_type or 1)
    if command_type in {2, 3}:
        try:
            target_id = int(data.get("target_id"))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Context menu commands require a valid target_id") from exc
        if command_type == 2:
            target_member = await db.scalar(select(ChannelMember).where(
                ChannelMember.channel_id == channel.channel_id,
                ChannelMember.user_id == target_id,
            ))
            target_user = await db.get(User, target_id) if target_member is not None else None
            if target_user is None:
                raise HTTPException(status_code=404, detail="Target user not found")
            target_roles = await _member_roles(db, channel.channel_id, target_id)
            data["target_id"] = str(target_id)
            data["resolved"] = {
                "users": {str(target_id): miscord_user(target_user)},
                "members": {str(target_id): {"roles": [str(item) for item in target_roles]}},
            }
        else:
            target_message = await db.scalar(
                select(Message)
                .options(
                    selectinload(Message.author),
                    selectinload(Message.attachments),
                    selectinload(Message.reactions),
                    selectinload(Message.reply_to).selectinload(Message.author),
                    selectinload(Message.reply_to).selectinload(Message.attachments),
                    selectinload(Message.reply_to).selectinload(Message.reactions),
                )
                .where(
                    Message.id == target_id,
                    Message.text_channel_id == channel.id,
                    Message.is_deleted.is_(False),
                )
            )
            if target_message is None:
                raise HTTPException(status_code=404, detail="Target message not found")
            data["target_id"] = str(target_id)
            data["resolved"] = {"messages": {str(target_id): miscord_message(target_message, guild_id=channel.channel_id)}}
    interaction_payload = {
        "id": "",
        "application_id": application.client_id,
        "type": 2,
        "data": data,
        "guild_id": str(channel.channel_id),
        "guild": {"id": str(channel.channel_id), "locale": "ru"},
        "channel_id": str(channel.id),
        "channel": {"id": str(channel.id), "type": 0, "guild_id": str(channel.channel_id), "name": channel.name},
        "member": {
            "user": miscord_user(current_user),
            "roles": [str(item) for item in role_ids],
            "joined_at": membership.joined_at.isoformat() if membership and membership.joined_at else None,
            "deaf": False,
            "mute": False,
            "flags": 0,
            "permissions": str(permissions),
        },
        "token": "",
        "version": 1,
        "app_permissions": str(app_permissions),
        "locale": "ru",
        "guild_locale": "ru",
        "entitlements": [],
        "authorizing_integration_owners": authorizing_owners,
        "context": 0,
        "attachment_size_limit": 10 * 1024 * 1024,
    }
    interaction = new_interaction(
        application,
        interaction_type=2,
        guild_id=channel.channel_id,
        channel_id=channel.id,
        author_user_id=current_user.id,
        command_id=command.id,
        payload=interaction_payload,
    )
    interaction_payload["id"] = interaction.interaction_id
    interaction_payload["token"] = interaction.interaction_token
    db.add(interaction)
    await db.commit()
    status, delivered = await _deliver(db, interaction, application)
    return {
        "id": interaction.interaction_id,
        "application_id": application.client_id,
        "token": interaction.interaction_token,
        "status": status,
        "delivered_sessions": delivered,
    }


@router.post("/channels/{channel_id}/autocomplete-interactions")
async def create_autocomplete_interaction(
    channel_id: int,
    payload: ClientInteractionCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        command_id = int(payload.command_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid command id") from exc
    channel, command, application, app_permissions, permissions, role_ids, authorizing_owners = await _command_context(
        db, channel_id, payload.application_id, command_id, current_user
    )
    if int(command.command_type or 1) != 1:
        raise HTTPException(status_code=400, detail="Only chat input commands support autocomplete")
    data = dict(payload.data)
    focused = _focused_option(data.get("options"))
    definition = command.definition if isinstance(command.definition, dict) else {}
    option_definition = _option_definition(definition.get("options"), str((focused or {}).get("name") or ""))
    if focused is None or not option_definition or option_definition.get("autocomplete") is not True:
        raise HTTPException(status_code=400, detail="A valid autocomplete option must be focused")
    membership = await db.scalar(select(ChannelMember).where(
        ChannelMember.channel_id == channel.channel_id,
        ChannelMember.user_id == current_user.id,
    ))
    data.update({"id": str(command.id), "name": command.name, "type": 1})
    interaction_payload = {
        "id": "",
        "application_id": application.client_id,
        "type": 4,
        "data": data,
        "guild_id": str(channel.channel_id),
        "guild": {"id": str(channel.channel_id), "locale": "ru"},
        "channel_id": str(channel.id),
        "channel": {"id": str(channel.id), "type": 0, "guild_id": str(channel.channel_id), "name": channel.name},
        "member": {
            "user": miscord_user(current_user),
            "roles": [str(item) for item in role_ids],
            "joined_at": membership.joined_at.isoformat() if membership and membership.joined_at else None,
            "deaf": False,
            "mute": False,
            "flags": 0,
            "permissions": str(permissions),
        },
        "token": "",
        "version": 1,
        "app_permissions": str(app_permissions),
        "locale": "ru",
        "guild_locale": "ru",
        "entitlements": [],
        "authorizing_integration_owners": authorizing_owners,
        "context": 0,
        "attachment_size_limit": 10 * 1024 * 1024,
    }
    interaction = new_interaction(
        application,
        interaction_type=4,
        guild_id=channel.channel_id,
        channel_id=channel.id,
        author_user_id=current_user.id,
        command_id=command.id,
        payload=interaction_payload,
    )
    interaction_payload["id"] = interaction.interaction_id
    interaction_payload["token"] = interaction.interaction_token
    db.add(interaction)
    await db.commit()
    status, _ = await _deliver(db, interaction, application)
    response = interaction.response_payload if interaction.responded else None
    if response is None and status == "pending":
        response = await wait_for_callback(
            AsyncSessionLocal,
            interaction.interaction_id,
            interaction.interaction_token,
        )
    if not isinstance(response, dict) or _as_int(response.get("type")) != 8:
        return {"choices": [], "status": status}
    response_data = response.get("data") if isinstance(response.get("data"), dict) else {}
    return {"choices": list(response_data.get("choices") or [])[:25], "status": "responded"}


@router.post("/channels/{channel_id}/component-interactions")
async def create_component_interaction(
    channel_id: int,
    raw_payload: dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await require_text_channel_access(db, current_user, channel_id)
    try:
        message_id = int(raw_payload.get("message_id"))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="message_id is required") from exc
    message_result = await db.execute(
        select(Message).options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions),
            selectinload(Message.reply_to).selectinload(Message.author),
            selectinload(Message.reply_to).selectinload(Message.attachments),
            selectinload(Message.reply_to).selectinload(Message.reactions),
        ).where(
            Message.id == message_id,
            Message.text_channel_id == channel_id,
        )
    )
    message = message_result.scalar_one_or_none()
    if message is None or not message.application_id:
        raise HTTPException(status_code=404, detail="Interactive message not found")
    app_result = await db.execute(
        select(BotApplication)
        .options(selectinload(BotApplication.bot_user), selectinload(BotApplication.secret))
        .where(BotApplication.client_id == str(message.application_id), BotApplication.status == "active")
    )
    application = app_result.scalar_one_or_none()
    if application is None:
        raise HTTPException(status_code=404, detail="Application not found")
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
    if server_install is None and user_install is None:
        raise HTTPException(status_code=404, detail="Application is not installed for this context")
    permissions = await get_member_permissions(db, channel.channel_id, current_user.id)
    role_ids = await _member_roles(db, channel.channel_id, current_user.id)
    custom_id = str(raw_payload.get("custom_id") or "")[:100]
    if not custom_id:
        raise HTTPException(status_code=400, detail="custom_id is required")
    interaction_payload = {
        "id": "",
        "application_id": application.client_id,
        "type": 3,
        "data": {
            "custom_id": custom_id,
            "component_type": int(raw_payload.get("component_type") or 2),
            "values": raw_payload.get("values") or [],
        },
        "guild_id": str(channel.channel_id),
        "channel_id": str(channel.id),
        "member": {"user": miscord_user(current_user), "roles": [str(item) for item in role_ids], "permissions": str(permissions)},
        "message": miscord_message(message, guild_id=channel.channel_id),
        "token": "",
        "version": 1,
        "app_permissions": str(int(server_install.permissions or 0) if server_install is not None else permissions),
        "locale": "ru",
        "guild_locale": "ru",
        "entitlements": [],
        "authorizing_integration_owners": (
            {"0": str(channel.channel_id)} if server_install is not None else {"1": str(current_user.id)}
        ),
        "context": 0,
    }
    interaction = new_interaction(
        application,
        interaction_type=3,
        guild_id=channel.channel_id,
        channel_id=channel.id,
        author_user_id=current_user.id,
        command_id=None,
        payload=interaction_payload,
    )
    interaction_payload["id"] = interaction.interaction_id
    interaction_payload["token"] = interaction.interaction_token
    db.add(interaction)
    await db.commit()
    status, delivered = await _deliver(db, interaction, application)
    return {"id": interaction.interaction_id, "status": status, "delivered_sessions": delivered}


@router.post("/channels/{channel_id}/modal-interactions")
async def create_modal_interaction(
    channel_id: int,
    raw_payload: dict[str, Any] = Body(...),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    channel = await require_text_channel_access(db, current_user, channel_id)
    source_interaction_id = str(raw_payload.get("source_interaction_id") or "")
    custom_id = str(raw_payload.get("custom_id") or "")[:100]
    if not source_interaction_id or not custom_id:
        raise HTTPException(status_code=400, detail="source_interaction_id and custom_id are required")
    result = await db.execute(
        select(BotInteraction, BotApplication)
        .join(BotApplication, BotApplication.id == BotInteraction.application_id)
        .options(selectinload(BotApplication.bot_user), selectinload(BotApplication.secret))
        .where(
            BotInteraction.interaction_id == source_interaction_id,
            BotInteraction.channel_id == channel.id,
            BotInteraction.author_user_id == current_user.id,
            BotInteraction.responded.is_(True),
            BotApplication.status == "active",
        )
    )
    row = result.first()
    if row is None:
        raise HTTPException(status_code=404, detail="Modal interaction not found")
    source, application = row
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
    if server_install is None and user_install is None:
        raise HTTPException(status_code=404, detail="Application is not installed for this context")
    if aware(source.expires_at) and aware(source.expires_at) <= utcnow():
        raise HTTPException(status_code=404, detail="Modal interaction expired")
    components = _validate_modal_submission(source, raw_payload.get("components"), custom_id)
    permissions = await get_member_permissions(db, channel.channel_id, current_user.id)
    role_ids = await _member_roles(db, channel.channel_id, current_user.id)
    membership = await db.scalar(select(ChannelMember).where(
        ChannelMember.channel_id == channel.channel_id,
        ChannelMember.user_id == current_user.id,
    ))
    interaction_payload = {
        "id": "",
        "application_id": application.client_id,
        "type": 5,
        "data": {"custom_id": custom_id, "components": components},
        "guild_id": str(channel.channel_id),
        "guild": {"id": str(channel.channel_id), "locale": "ru"},
        "channel_id": str(channel.id),
        "channel": {"id": str(channel.id), "type": 0, "guild_id": str(channel.channel_id), "name": channel.name},
        "member": {
            "user": miscord_user(current_user),
            "roles": [str(item) for item in role_ids],
            "joined_at": membership.joined_at.isoformat() if membership and membership.joined_at else None,
            "deaf": False,
            "mute": False,
            "flags": 0,
            "permissions": str(permissions),
        },
        "token": "",
        "version": 1,
        "app_permissions": str(int(server_install.permissions or 0) if server_install is not None else permissions),
        "locale": "ru",
        "guild_locale": "ru",
        "entitlements": [],
        "authorizing_integration_owners": (
            {"0": str(channel.channel_id)} if server_install is not None else {"1": str(current_user.id)}
        ),
        "context": 0,
    }
    interaction = new_interaction(
        application,
        interaction_type=5,
        guild_id=channel.channel_id,
        channel_id=channel.id,
        author_user_id=current_user.id,
        command_id=None,
        payload=interaction_payload,
    )
    interaction_payload["id"] = interaction.interaction_id
    interaction_payload["token"] = interaction.interaction_token
    db.add(interaction)
    await db.commit()
    status, delivered = await _deliver(db, interaction, application)
    return {"id": interaction.interaction_id, "status": status, "delivered_sessions": delivered}
