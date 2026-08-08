from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_active_user
from app.core.permissions import Permission, get_member_permissions, has_permission
from app.db.database import get_db
from app.models import BotApplication, BotCommand, BotInstall, BotInteraction, ChannelMember, MemberRole, Message, TextChannel, User
from app.schemas.discord import ClientInteractionCreate
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.bot_interactions import apply_initial_callback, aware, new_interaction, utcnow
from app.services.channel_access import require_text_channel_access
from app.services.discord_serializers import discord_command, discord_message, discord_user
from app.services.interaction_delivery import InteractionEndpointError, deliver_interaction_http


router = APIRouter()


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


async def _member_roles(db: AsyncSession, guild_id: int, user_id: int) -> list[int]:
    result = await db.execute(select(MemberRole.role_id).where(
        MemberRole.server_id == guild_id,
        MemberRole.user_id == user_id,
    ))
    return [int(item) for item in result.scalars().all()]


def _custom_command_allowed(
    command: BotCommand,
    user_id: int,
    role_ids: list[int],
    guild_id: int,
    channel_id: int,
) -> bool:
    users = {int(item) for item in (command.allowed_user_ids or [])}
    roles = {int(item) for item in (command.allowed_role_ids or [])}
    if users or roles:
        return user_id in users or bool(roles & set(role_ids))
    definition = command.definition if isinstance(command.definition, dict) else {}
    guild_permissions = definition.get("guild_permissions")
    entries = guild_permissions.get(str(guild_id), []) if isinstance(guild_permissions, dict) else []
    if not isinstance(entries, list) or not entries:
        return True
    valid_entries = [item for item in entries if isinstance(item, dict)]
    user_entry = next((item for item in valid_entries if _as_int(item.get("type")) == 2 and str(item.get("id")) == str(user_id)), None)
    if user_entry is not None:
        return bool(user_entry.get("permission"))
    role_entries = [item for item in valid_entries if _as_int(item.get("type")) == 1 and _as_int(item.get("id")) in set(role_ids)]
    if any(bool(item.get("permission")) for item in role_entries):
        return True
    if role_entries:
        return False
    channel_entries = [item for item in valid_entries if _as_int(item.get("type")) == 3 and _as_int(item.get("id")) in {guild_id, channel_id}]
    if channel_entries:
        return any(bool(item.get("permission")) for item in channel_entries)
    everyone = next((item for item in valid_entries if _as_int(item.get("type")) == 1 and str(item.get("id")) == str(guild_id)), None)
    return bool(everyone.get("permission")) if everyone is not None else True


def _command_allowed(
    command: BotCommand,
    permissions: int,
    user_id: int,
    role_ids: list[int],
    guild_id: int,
    channel_id: int,
) -> bool:
    required = int(command.default_member_permissions or 0)
    if required and not has_permission(permissions, Permission.ADMINISTRATOR) and permissions & required != required:
        return False
    return _custom_command_allowed(command, user_id, role_ids, guild_id, channel_id)


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
    result = await db.execute(
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
    for command, application in result.all():
        key = (application.id, command.name, int(command.command_type))
        if key not in selected and _command_allowed(
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
        commands.append(discord_command(command, application_client_id=application.client_id))
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
        select(BotCommand, BotApplication, BotInstall)
        .join(BotApplication, BotApplication.id == BotCommand.application_id)
        .join(BotInstall, and_(
            BotInstall.application_id == BotApplication.id,
            BotInstall.server_id == channel.channel_id,
            BotInstall.status == "active",
        ))
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
    command, application, install = row
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
    return channel, command, application, install, permissions, role_ids


async def _deliver(db: AsyncSession, interaction: BotInteraction, application: BotApplication) -> tuple[str, int]:
    if application.interactions_endpoint_url:
        try:
            callback_data = await deliver_interaction_http(
                application,
                application.secret.signing_private_key_ciphertext,
                interaction.request_payload,
            )
            from app.schemas.discord import DiscordInteractionCallback
            await apply_initial_callback(db, interaction, DiscordInteractionCallback.model_validate(callback_data))
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
    channel, command, application, install, permissions, role_ids = await _command_context(
        db, channel_id, payload.application_id, command_id, current_user
    )
    membership = await db.scalar(select(ChannelMember).where(
        ChannelMember.channel_id == channel.channel_id,
        ChannelMember.user_id == current_user.id,
    ))
    data = dict(payload.data)
    data.update({"id": str(command.id), "name": command.name, "type": int(command.command_type)})
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
            "user": discord_user(current_user),
            "roles": [str(item) for item in role_ids],
            "joined_at": membership.joined_at.isoformat() if membership and membership.joined_at else None,
            "deaf": False,
            "mute": False,
            "flags": 0,
            "permissions": str(permissions),
        },
        "token": "",
        "version": 1,
        "app_permissions": str(int(install.permissions or 0)),
        "locale": "ru",
        "guild_locale": "ru",
        "entitlements": [],
        "authorizing_integration_owners": {"0": str(channel.channel_id)},
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
        select(BotApplication, BotInstall)
        .join(BotInstall, and_(
            BotInstall.application_id == BotApplication.id,
            BotInstall.server_id == channel.channel_id,
            BotInstall.status == "active",
        ))
        .options(selectinload(BotApplication.bot_user), selectinload(BotApplication.secret))
        .where(BotApplication.client_id == str(message.application_id), BotApplication.status == "active")
    )
    row = app_result.first()
    if row is None:
        raise HTTPException(status_code=404, detail="Application not found")
    application, install = row
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
        "member": {"user": discord_user(current_user), "roles": [str(item) for item in role_ids], "permissions": str(permissions)},
        "message": discord_message(message, guild_id=channel.channel_id),
        "token": "",
        "version": 1,
        "app_permissions": str(int(install.permissions or 0)),
        "locale": "ru",
        "guild_locale": "ru",
        "entitlements": [],
        "authorizing_integration_owners": {"0": str(channel.channel_id)},
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
        select(BotInteraction, BotApplication, BotInstall)
        .join(BotApplication, BotApplication.id == BotInteraction.application_id)
        .join(BotInstall, and_(
            BotInstall.application_id == BotApplication.id,
            BotInstall.server_id == channel.channel_id,
            BotInstall.status == "active",
        ))
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
    source, application, install = row
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
            "user": discord_user(current_user),
            "roles": [str(item) for item in role_ids],
            "joined_at": membership.joined_at.isoformat() if membership and membership.joined_at else None,
            "deaf": False,
            "mute": False,
            "flags": 0,
            "permissions": str(permissions),
        },
        "token": "",
        "version": 1,
        "app_permissions": str(int(install.permissions or 0)),
        "locale": "ru",
        "guild_locale": "ru",
        "entitlements": [],
        "authorizing_integration_owners": {"0": str(channel.channel_id)},
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
