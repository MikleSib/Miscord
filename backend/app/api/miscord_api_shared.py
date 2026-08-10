from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
import secrets
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, Query, Request, Response
from pydantic import ValidationError
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from starlette.datastructures import UploadFile as StarletteUploadFile

from app.core.config import settings
from app.core.miscord_errors import (
    MiscordAPIError,
    MISSING_ACCESS,
    MISSING_PERMISSIONS,
    UNKNOWN_CHANNEL,
    UNKNOWN_COMMAND,
    UNKNOWN_GUILD,
    UNKNOWN_MESSAGE,
)
from app.core.permissions import (
    ALL_PERMISSIONS,
    Permission,
    miscord_permissions_to_legacy,
    get_member_permissions,
    get_top_role_position,
    has_permission,
)
from app.db.database import get_db
from app.models import (
    BotApplication,
    Attachment,
    BotCommand,
    BotInstall,
    BotInteractionMessage,
    Channel,
    ChannelMember,
    ChannelPermissionOverwrite,
    ChannelKind,
    MemberRole,
    Message,
    Invite,
    Reaction,
    Role,
    ServerBan,
    OverwriteTargetType,
    TextChannel,
    User,
    VoiceChannel,
    Webhook,
)
from app.schemas.miscord import MiscordApplicationCommandPayload, MiscordMessageCreate, MiscordMessageUpdate
from app.schemas.poll import PollCreate
from app.schemas.webhook import WebhookTokenUpdate
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.attachment_storage import finalize_staged_file, remove_storage_key, stage_upload
from app.services.clamav import ClamAVUnavailable, MalwareDetected, scan_file
from app.services.bot_security import BotPrincipal, get_bot_principal_by_token
from app.services.bot_oauth import OAuthPrincipal, oauth_principal_from_token
from app.services.bot_interactions import (
    create_followup,
    delete_response_message,
    edit_original_response,
    get_original_response,
    load_interaction_by_token,
    load_response_message,
    update_response_message,
)
from app.services.channel_access import user_can_access_text_channel
from app.services.channel_permissions import get_effective_channel_permissions
from app.services.polls import create_poll_for_message, require_poll_permission, serialize_poll
from app.services.miscord_serializers import (
    miscord_channel,
    miscord_command,
    miscord_message,
    miscord_role,
    miscord_user,
)
from app.services.webhook_security import generate_webhook_token, hash_webhook_token
from app.websocket.connection_manager import manager




def _validation_error(exc: ValidationError) -> MiscordAPIError:
    errors: dict[str, Any] = {}
    for item in exc.errors(include_url=False):
        path = ".".join(str(part) for part in item.get("loc", ())) or "_errors"
        errors[path] = {"_errors": [{"code": item.get("type", "BASE_TYPE_INVALID"), "message": item["msg"]}]}
    return MiscordAPIError(400, 50035, "Invalid Form Body", errors=errors)


async def get_miscord_bot(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> BotPrincipal:
    if not settings.BOT_PLATFORM_ENABLED:
        raise MiscordAPIError(404, 0, "404: Not Found")
    if not authorization or not authorization.startswith("Bot "):
        raise MiscordAPIError(401, 0, "401: Unauthorized", headers={"WWW-Authenticate": "Bot"})
    try:
        return await get_bot_principal_by_token(authorization[4:].strip(), db)
    except Exception as exc:
        raise MiscordAPIError(401, 0, "401: Unauthorized", headers={"WWW-Authenticate": "Bot"}) from exc


async def get_miscord_identity(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> tuple[User, BotPrincipal | OAuthPrincipal]:
    if authorization and authorization.startswith("Bot "):
        principal = await get_miscord_bot(authorization=authorization, db=db)
        return principal.bot_user, principal
    if authorization and authorization.startswith("Bearer "):
        principal = await oauth_principal_from_token(authorization[7:].strip(), db)
        if principal is not None and principal.user is not None and "identify" in principal.scopes:
            return principal.user, principal
    raise MiscordAPIError(401, 0, "401: Unauthorized", headers={"WWW-Authenticate": "Bearer"})


async def get_command_permissions_oauth(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> OAuthPrincipal:
    if not authorization or not authorization.startswith("Bearer "):
        raise MiscordAPIError(401, 0, "401: Unauthorized", headers={"WWW-Authenticate": "Bearer"})
    principal = await oauth_principal_from_token(authorization[7:].strip(), db)
    if (
        principal is None
        or principal.user is None
        or "applications.commands.permissions.update" not in principal.scopes
    ):
        raise MISSING_ACCESS()
    return principal


def _require_application(principal: BotPrincipal, application_id: str) -> None:
    if str(principal.application.client_id) != str(application_id):
        raise MISSING_ACCESS()


def _application_payload(application: BotApplication) -> dict[str, Any]:
    install_params = application.install_params or {
        "scopes": ["bot", "applications.commands"],
        "permissions": str(int(Permission.VIEW_CHANNEL | Permission.SEND_MESSAGES)),
    }
    if install_params.get("permissions") is not None:
        install_params = dict(install_params)
        install_params["permissions"] = str(install_params["permissions"])
    return {
        "id": application.client_id,
        "name": application.name,
        "icon": application.avatar_url,
        "description": application.description or "",
        "rpc_origins": [],
        "bot_public": bool(application.bot_public),
        "bot_require_code_grant": bool(application.bot_require_code_grant),
        "bot": miscord_user(application.bot_user),
        "terms_of_service_url": application.terms_of_service_url,
        "privacy_policy_url": application.privacy_policy_url,
        "verify_key": application.public_key,
        "flags": int(application.flags or 0),
        "approximate_guild_count": None,
        "approximate_user_install_count": 0,
        "redirect_uris": list(application.redirect_uris or []),
        "interactions_endpoint_url": application.interactions_endpoint_url,
        "role_connections_verification_url": None,
        "event_webhooks_url": application.event_webhooks_url,
        "event_webhooks_status": int(application.event_webhooks_status or 1),
        "event_webhooks_types": list(application.event_webhooks_types or []),
        "tags": list(application.tags or []),
        "install_params": install_params,
        "integration_types_config": dict(application.integration_types_config or {}),
        "custom_install_url": application.custom_install_url,
    }


async def _active_install(db: AsyncSession, principal: BotPrincipal, guild_id: int) -> BotInstall:
    result = await db.execute(
        select(BotInstall).where(
            BotInstall.application_id == principal.application.id,
            BotInstall.server_id == guild_id,
            BotInstall.status == "active",
        )
    )
    install = result.scalar_one_or_none()
    if install is None:
        raise MISSING_ACCESS()
    return install


async def _guild(db: AsyncSession, guild_id: int) -> Channel:
    guild = await db.get(Channel, guild_id)
    if guild is None:
        raise UNKNOWN_GUILD()
    return guild


async def _text_channel(db: AsyncSession, channel_id: int) -> TextChannel:
    result = await db.execute(select(TextChannel).where(TextChannel.id == channel_id, TextChannel.is_hidden.is_(False)))
    channel = result.scalar_one_or_none()
    if channel is None:
        raise UNKNOWN_CHANNEL()
    return channel


async def _voice_channel(db: AsyncSession, channel_id: int) -> VoiceChannel | None:
    return await db.get(VoiceChannel, channel_id)


async def _require_bot_text_channel(
    db: AsyncSession,
    principal: BotPrincipal,
    channel_id: int,
    *,
    permission: Permission | None = None,
) -> tuple[TextChannel, BotInstall, int]:
    channel = await _text_channel(db, channel_id)
    install = await _active_install(db, principal, int(channel.channel_id))
    if not await user_can_access_text_channel(
        db,
        principal.bot_user,
        channel,
        need_send=permission == Permission.SEND_MESSAGES,
    ):
        raise MISSING_ACCESS()
    permissions = await get_effective_channel_permissions(
        db,
        channel.channel_id,
        principal.bot_user.id,
        "text",
        channel.id,
    )
    if permission is not None and not has_permission(permissions, permission):
        raise MISSING_PERMISSIONS()
    return channel, install, permissions


async def _message(db: AsyncSession, message_id: int) -> Message:
    result = await db.execute(
        select(Message)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions),
            selectinload(Message.reply_to).selectinload(Message.author),
            selectinload(Message.reply_to).selectinload(Message.attachments),
            selectinload(Message.reply_to).selectinload(Message.reactions),
        )
        .where(Message.id == message_id)
    )
    message = result.scalar_one_or_none()
    if message is None:
        raise UNKNOWN_MESSAGE()
    return message


async def _channel_overwrites(db: AsyncSession, guild_id: int, channel_id: int, kind: str) -> list[ChannelPermissionOverwrite]:
    channel_kind = ChannelKind.TEXT if kind == "text" else ChannelKind.VOICE
    result = await db.execute(
        select(ChannelPermissionOverwrite).where(
            ChannelPermissionOverwrite.server_id == guild_id,
            ChannelPermissionOverwrite.channel_id == channel_id,
            ChannelPermissionOverwrite.channel_kind == channel_kind,
        )
    )
    return list(result.scalars().all())


async def _require_guild_permission(
    db: AsyncSession,
    principal: BotPrincipal,
    guild_id: int,
    permission: Permission,
) -> tuple[Channel, BotInstall, int]:
    install = await _active_install(db, principal, guild_id)
    guild = await _guild(db, guild_id)
    permissions = await get_member_permissions(db, guild_id, principal.bot_user.id, owner_id=guild.owner_id)
    if not has_permission(permissions, permission):
        raise MISSING_PERMISSIONS()
    return guild, install, permissions


async def _role_target_allowed(db: AsyncSession, principal: BotPrincipal, guild_id: int, role: Role) -> None:
    if role.server_id != guild_id:
        raise MiscordAPIError(404, 10011, "Unknown Role")
    if role.is_default or role.managed_by_bot_application_id is not None:
        raise MISSING_PERMISSIONS()
    top_position = await get_top_role_position(db, guild_id, principal.bot_user.id)
    if int(role.position or 0) >= int(top_position or 0):
        raise MISSING_PERMISSIONS()

__all__ = [name for name in globals() if not name.startswith('__')]
