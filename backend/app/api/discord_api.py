from __future__ import annotations

from datetime import datetime, timedelta, timezone
import secrets
from typing import Any

from fastapi import APIRouter, Body, Depends, Header, Query, Request, Response
from pydantic import ValidationError
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.discord_errors import (
    DiscordAPIError,
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
    discord_permissions_to_legacy,
    get_member_permissions,
    get_top_role_position,
    has_permission,
)
from app.db.database import get_db
from app.models import (
    BotApplication,
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
from app.schemas.discord import DiscordApplicationCommandPayload, DiscordMessageCreate, DiscordMessageUpdate
from app.schemas.webhook import WebhookTokenUpdate
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
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
from app.services.discord_serializers import (
    discord_channel,
    discord_command,
    discord_message,
    discord_role,
    discord_user,
)
from app.services.webhook_security import generate_webhook_token, hash_webhook_token
from app.websocket.connection_manager import manager


router = APIRouter()


def _validation_error(exc: ValidationError) -> DiscordAPIError:
    errors: dict[str, Any] = {}
    for item in exc.errors(include_url=False):
        path = ".".join(str(part) for part in item.get("loc", ())) or "_errors"
        errors[path] = {"_errors": [{"code": item.get("type", "BASE_TYPE_INVALID"), "message": item["msg"]}]}
    return DiscordAPIError(400, 50035, "Invalid Form Body", errors=errors)


async def get_discord_bot(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> BotPrincipal:
    if not settings.BOT_PLATFORM_ENABLED:
        raise DiscordAPIError(404, 0, "404: Not Found")
    if not authorization or not authorization.startswith("Bot "):
        raise DiscordAPIError(401, 0, "401: Unauthorized", headers={"WWW-Authenticate": "Bot"})
    try:
        return await get_bot_principal_by_token(authorization[4:].strip(), db)
    except Exception as exc:
        raise DiscordAPIError(401, 0, "401: Unauthorized", headers={"WWW-Authenticate": "Bot"}) from exc


async def get_discord_identity(
    authorization: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> tuple[User, BotPrincipal | OAuthPrincipal]:
    if authorization and authorization.startswith("Bot "):
        principal = await get_discord_bot(authorization=authorization, db=db)
        return principal.bot_user, principal
    if authorization and authorization.startswith("Bearer "):
        principal = await oauth_principal_from_token(authorization[7:].strip(), db)
        if principal is not None and principal.user is not None and "identify" in principal.scopes:
            return principal.user, principal
    raise DiscordAPIError(401, 0, "401: Unauthorized", headers={"WWW-Authenticate": "Bearer"})


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
        "bot": discord_user(application.bot_user),
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
        raise DiscordAPIError(404, 10011, "Unknown Role")
    if role.is_default or role.managed_by_bot_application_id is not None:
        raise MISSING_PERMISSIONS()
    top_position = await get_top_role_position(db, guild_id, principal.bot_user.id)
    if int(role.position or 0) >= int(top_position or 0):
        raise MISSING_PERMISSIONS()


@router.get("/gateway")
async def get_gateway(request: Request):
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.client.host
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme).split(",", 1)[0].strip()
    return {"url": f"{'wss' if proto == 'https' else 'ws'}://{host}/gateway"}


@router.get("/gateway/bot")
async def get_gateway_bot(request: Request, principal: BotPrincipal = Depends(get_discord_bot)):
    payload = await get_gateway(request)
    payload.update({
        "shards": 1,
        "session_start_limit": {
            "total": 1000,
            "remaining": await bot_event_dispatcher.identify_remaining(principal.application.id),
            "reset_after": 60_000,
            "max_concurrency": 1,
        },
    })
    return payload


@router.get("/users/@me")
async def get_current_user(identity: tuple[User, BotPrincipal | OAuthPrincipal] = Depends(get_discord_identity)):
    return discord_user(identity[0])


@router.get("/oauth2/applications/@me")
@router.get("/applications/@me")
async def get_current_application(principal: BotPrincipal = Depends(get_discord_bot)):
    return _application_payload(principal.application)


@router.get("/users/{user_id}")
async def get_user(
    user_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if user is None:
        raise DiscordAPIError(404, 10013, "Unknown User")
    return discord_user(user)


@router.get("/users/@me/guilds")
async def get_current_user_guilds(
    identity: tuple[User, BotPrincipal | OAuthPrincipal] = Depends(get_discord_identity),
    db: AsyncSession = Depends(get_db),
):
    user, principal = identity
    if isinstance(principal, OAuthPrincipal):
        if "guilds" not in principal.scopes:
            raise MISSING_ACCESS()
        result = await db.execute(
            select(Channel).join(ChannelMember, ChannelMember.channel_id == Channel.id).where(
                ChannelMember.user_id == user.id
            ).order_by(Channel.id)
        )
        guilds = []
        for guild in result.scalars().all():
            guilds.append({
                "id": str(guild.id),
                "name": guild.name,
                "icon": guild.icon,
                "banner": guild.banner,
                "owner": guild.owner_id == user.id,
                "permissions": str(await get_member_permissions(db, guild.id, user.id)),
                "features": [],
            })
        return guilds
    result = await db.execute(
        select(BotInstall, Channel)
        .join(Channel, Channel.id == BotInstall.server_id)
        .where(BotInstall.application_id == principal.application.id, BotInstall.status == "active")
        .order_by(Channel.id)
    )
    return [
        {
            "id": str(guild.id),
            "name": guild.name,
            "icon": guild.icon,
            "banner": guild.banner,
            "owner": guild.owner_id == principal.bot_user.id,
            "permissions": str(int(install.permissions or 0)),
            "features": [],
            "approximate_member_count": None,
            "approximate_presence_count": None,
        }
        for install, guild in result.all()
    ]


@router.get("/users/@me/connections")
async def get_current_user_connections(
    identity: tuple[User, BotPrincipal | OAuthPrincipal] = Depends(get_discord_identity),
):
    _, principal = identity
    if not isinstance(principal, OAuthPrincipal) or "connections" not in principal.scopes:
        raise MISSING_ACCESS()
    return []


@router.get("/guilds/{guild_id}")
async def get_guild(
    guild_id: int,
    with_counts: bool = Query(default=False),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    install = await _active_install(db, principal, guild_id)
    guild = await _guild(db, guild_id)
    member_count = await db.scalar(select(func.count(ChannelMember.id)).where(ChannelMember.channel_id == guild_id))
    roles_result = await db.execute(select(Role).where(Role.server_id == guild_id).order_by(Role.position))
    payload = {
        "id": str(guild.id),
        "name": guild.name,
        "icon": guild.icon,
        "description": guild.description,
        "splash": None,
        "discovery_splash": None,
        "owner_id": str(guild.owner_id),
        "afk_channel_id": None,
        "afk_timeout": 300,
        "widget_enabled": False,
        "widget_channel_id": None,
        "verification_level": 0,
        "default_message_notifications": 0,
        "explicit_content_filter": 0,
        "roles": [discord_role(role, guild_id=guild_id) for role in roles_result.scalars().all()],
        "emojis": [],
        "features": [],
        "mfa_level": 0,
        "application_id": None,
        "system_channel_id": None,
        "system_channel_flags": 0,
        "rules_channel_id": None,
        "max_presences": None,
        "max_members": 250000,
        "vanity_url_code": None,
        "banner": guild.banner,
        "premium_tier": 0,
        "premium_subscription_count": 0,
        "preferred_locale": "ru",
        "public_updates_channel_id": None,
        "max_video_channel_users": 25,
        "max_stage_video_channel_users": 0,
        "approximate_member_count": int(member_count or 0) if with_counts else None,
        "approximate_presence_count": None,
        "nsfw_level": 0,
        "stickers": [],
        "premium_progress_bar_enabled": False,
        "safety_alerts_channel_id": None,
        "permissions": str(int(install.permissions or 0)),
    }
    return payload


@router.patch("/guilds/{guild_id}")
async def modify_guild(
    guild_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    guild, _, _ = await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_GUILD)
    if "name" in payload:
        name = str(payload["name"] or "").strip()
        if not 2 <= len(name) <= 100:
            raise DiscordAPIError(400, 50035, "Guild name must be 2-100 characters")
        guild.name = name
    if "description" in payload:
        description = str(payload["description"] or "").strip()
        guild.description = description[:1000] or None
    for field in ("icon", "banner"):
        if field in payload:
            value = str(payload[field] or "").strip()
            setattr(guild, field, value[:2048] or None)
    await db.commit()
    event = {
        "id": str(guild.id),
        "name": guild.name,
        "icon": guild.icon,
        "description": guild.description,
        "banner": guild.banner,
    }
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "GUILD_UPDATE", event)
    return event


@router.get("/guilds/{guild_id}/channels")
async def get_guild_channels(
    guild_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _active_install(db, principal, guild_id)
    text_result = await db.execute(select(TextChannel).where(TextChannel.channel_id == guild_id, TextChannel.is_hidden.is_(False)))
    voice_result = await db.execute(select(VoiceChannel).where(VoiceChannel.channel_id == guild_id))
    output = []
    for channel in text_result.scalars().all():
        output.append(discord_channel(channel, guild_id=guild_id, overwrites=await _channel_overwrites(db, guild_id, channel.id, "text")))
    for channel in voice_result.scalars().all():
        output.append(discord_channel(channel, guild_id=guild_id, overwrites=await _channel_overwrites(db, guild_id, channel.id, "voice")))
    return sorted(output, key=lambda item: (item["position"], item["id"]))


@router.post("/guilds/{guild_id}/channels", status_code=201)
async def create_guild_channel(
    guild_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_CHANNELS)
    name = str(payload.get("name") or "").strip()
    if not 1 <= len(name) <= 100:
        raise DiscordAPIError(400, 50035, "Channel name must be 1-100 characters")
    channel_type = int(payload.get("type", 0))
    position = max(0, int(payload.get("position") or 0))
    if channel_type == 0:
        channel: TextChannel | VoiceChannel = TextChannel(
            channel_id=guild_id,
            name=name,
            position=position,
            slow_mode_seconds=max(0, min(21600, int(payload.get("rate_limit_per_user") or 0))),
        )
        kind = "text"
    elif channel_type == 2:
        channel = VoiceChannel(
            channel_id=guild_id,
            name=name,
            position=position,
            bitrate=max(8, min(96, int(payload.get("bitrate") or 64000) // 1000)),
            max_users=max(0, min(99, int(payload.get("user_limit") or 0))),
        )
        kind = "voice"
    else:
        raise DiscordAPIError(400, 50035, "Only guild text and voice channels are supported")
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    response = discord_channel(channel, guild_id=guild_id, overwrites=[])
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "CHANNEL_CREATE", response)
    return response


@router.get("/channels/{channel_id}")
async def get_channel(
    channel_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    text_channel = await db.get(TextChannel, channel_id)
    if text_channel is not None and not text_channel.is_hidden:
        await _active_install(db, principal, text_channel.channel_id)
        return discord_channel(
            text_channel,
            guild_id=text_channel.channel_id,
            overwrites=await _channel_overwrites(db, text_channel.channel_id, channel_id, "text"),
        )
    voice_channel = await _voice_channel(db, channel_id)
    if voice_channel is not None:
        await _active_install(db, principal, voice_channel.channel_id)
        return discord_channel(
            voice_channel,
            guild_id=voice_channel.channel_id,
            overwrites=await _channel_overwrites(db, voice_channel.channel_id, channel_id, "voice"),
        )
    raise UNKNOWN_CHANNEL()


@router.patch("/channels/{channel_id}")
async def modify_channel(
    channel_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel: TextChannel | VoiceChannel | None = await db.get(TextChannel, channel_id)
    kind = "text"
    if channel is None:
        channel = await db.get(VoiceChannel, channel_id)
        kind = "voice"
    if channel is None:
        raise UNKNOWN_CHANNEL()
    await _require_guild_permission(db, principal, channel.channel_id, Permission.MANAGE_CHANNELS)
    if "name" in payload:
        name = str(payload["name"] or "").strip()
        if not 1 <= len(name) <= 100:
            raise DiscordAPIError(400, 50035, "Channel name must be 1-100 characters")
        channel.name = name
    if "position" in payload:
        channel.position = max(0, int(payload["position"] or 0))
    if isinstance(channel, TextChannel) and "rate_limit_per_user" in payload:
        channel.slow_mode_seconds = max(0, min(21600, int(payload["rate_limit_per_user"] or 0)))
    if isinstance(channel, VoiceChannel):
        if "bitrate" in payload:
            channel.bitrate = max(8, min(96, int(payload["bitrate"] or 64000) // 1000))
        if "user_limit" in payload:
            channel.max_users = max(0, min(99, int(payload["user_limit"] or 0)))
    await db.commit()
    response = discord_channel(
        channel,
        guild_id=channel.channel_id,
        overwrites=await _channel_overwrites(db, channel.channel_id, channel.id, kind),
    )
    await bot_event_dispatcher.dispatch_guild_event(db, channel.channel_id, "CHANNEL_UPDATE", response)
    return response


@router.delete("/channels/{channel_id}")
async def delete_channel(
    channel_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel: TextChannel | VoiceChannel | None = await db.get(TextChannel, channel_id)
    kind = "text"
    if channel is None:
        channel = await db.get(VoiceChannel, channel_id)
        kind = "voice"
    if channel is None:
        raise UNKNOWN_CHANNEL()
    guild_id = int(channel.channel_id)
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_CHANNELS)
    response = discord_channel(
        channel,
        guild_id=guild_id,
        overwrites=await _channel_overwrites(db, guild_id, channel.id, kind),
    )
    await db.execute(delete(ChannelPermissionOverwrite).where(
        ChannelPermissionOverwrite.server_id == guild_id,
        ChannelPermissionOverwrite.channel_id == channel_id,
        ChannelPermissionOverwrite.channel_kind == (ChannelKind.TEXT if kind == "text" else ChannelKind.VOICE),
    ))
    await db.delete(channel)
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "CHANNEL_DELETE", response)
    return response


@router.put("/channels/{channel_id}/permissions/{overwrite_id}", status_code=204)
async def edit_channel_permissions(
    channel_id: int,
    overwrite_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel: TextChannel | VoiceChannel | None = await db.get(TextChannel, channel_id)
    kind = ChannelKind.TEXT
    if channel is None:
        channel = await db.get(VoiceChannel, channel_id)
        kind = ChannelKind.VOICE
    if channel is None:
        raise UNKNOWN_CHANNEL()
    guild_id = int(channel.channel_id)
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    target_type = OverwriteTargetType.ROLE if int(payload.get("type", 0)) == 0 else OverwriteTargetType.MEMBER
    if target_type == OverwriteTargetType.ROLE:
        role = await db.get(Role, overwrite_id)
        if role is None or role.server_id != guild_id:
            raise DiscordAPIError(404, 10011, "Unknown Role")
    else:
        membership = await db.scalar(select(ChannelMember.id).where(
            ChannelMember.channel_id == guild_id,
            ChannelMember.user_id == overwrite_id,
        ))
        if membership is None:
            raise DiscordAPIError(404, 10007, "Unknown Member")
    try:
        allow = int(payload.get("allow") or 0)
        deny = int(payload.get("deny") or 0)
    except (TypeError, ValueError) as exc:
        raise DiscordAPIError(400, 50035, "allow and deny must be integer strings") from exc
    if allow < 0 or deny < 0 or allow & deny:
        raise DiscordAPIError(400, 50035, "Invalid permission overwrite")
    overwrite = await db.scalar(select(ChannelPermissionOverwrite).where(
        ChannelPermissionOverwrite.channel_kind == kind,
        ChannelPermissionOverwrite.channel_id == channel_id,
        ChannelPermissionOverwrite.target_type == target_type,
        ChannelPermissionOverwrite.target_id == overwrite_id,
    ))
    if overwrite is None:
        overwrite = ChannelPermissionOverwrite(
            server_id=guild_id,
            channel_kind=kind,
            channel_id=channel_id,
            target_type=target_type,
            target_id=overwrite_id,
        )
        db.add(overwrite)
    overwrite.allow = allow
    overwrite.deny = deny
    overwrite.legacy_allow = discord_permissions_to_legacy(allow)
    overwrite.legacy_deny = discord_permissions_to_legacy(deny)
    await db.commit()
    updated = discord_channel(
        channel,
        guild_id=guild_id,
        overwrites=await _channel_overwrites(db, guild_id, channel_id, kind.value),
    )
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "CHANNEL_UPDATE", updated)
    return Response(status_code=204)


@router.delete("/channels/{channel_id}/permissions/{overwrite_id}", status_code=204)
async def delete_channel_permissions(
    channel_id: int,
    overwrite_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel: TextChannel | VoiceChannel | None = await db.get(TextChannel, channel_id)
    kind = ChannelKind.TEXT
    if channel is None:
        channel = await db.get(VoiceChannel, channel_id)
        kind = ChannelKind.VOICE
    if channel is None:
        raise UNKNOWN_CHANNEL()
    guild_id = int(channel.channel_id)
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    await db.execute(delete(ChannelPermissionOverwrite).where(
        ChannelPermissionOverwrite.channel_kind == kind,
        ChannelPermissionOverwrite.channel_id == channel_id,
        ChannelPermissionOverwrite.target_id == overwrite_id,
    ))
    await db.commit()
    updated = discord_channel(
        channel,
        guild_id=guild_id,
        overwrites=await _channel_overwrites(db, guild_id, channel_id, kind.value),
    )
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "CHANNEL_UPDATE", updated)
    return Response(status_code=204)


def _discord_webhook(webhook: Webhook, token: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": str(webhook.id),
        "type": 1,
        "guild_id": str(webhook.server_id),
        "channel_id": str(webhook.text_channel_id),
        "user": None,
        "name": webhook.name,
        "avatar": webhook.avatar_url,
        "application_id": None,
        "source_guild": None,
        "source_channel": None,
        "url": None,
    }
    if token is not None:
        payload["token"] = token
        payload["url"] = f"{settings.SERVER_HOST.rstrip('/')}/api/v10/webhooks/{webhook.id}/{token}"
    return payload


async def _managed_bot_webhook(db: AsyncSession, principal: BotPrincipal, webhook_id: int) -> Webhook:
    webhook = await db.get(Webhook, webhook_id)
    if webhook is None:
        raise DiscordAPIError(404, 10015, "Unknown Webhook")
    await _require_bot_text_channel(db, principal, webhook.text_channel_id, permission=Permission.MANAGE_WEBHOOKS)
    return webhook


@router.post("/channels/{channel_id}/webhooks", status_code=200)
async def create_channel_webhook(
    channel_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_WEBHOOKS)
    name = str(payload.get("name") or "").strip()
    if not 1 <= len(name) <= 80 or any(value in name.casefold() for value in ("discord", "miscord", "system", "official")):
        raise DiscordAPIError(400, 50035, "Invalid webhook name")
    channel_count = await db.scalar(select(func.count(Webhook.id)).where(Webhook.text_channel_id == channel_id))
    if int(channel_count or 0) >= 15:
        raise DiscordAPIError(400, 30007, "Maximum number of webhooks reached")
    token = generate_webhook_token()
    webhook = Webhook(
        server_id=channel.channel_id,
        text_channel_id=channel.id,
        name=name,
        avatar_url=str(payload.get("avatar") or "")[:2048] or None,
        token_hash=hash_webhook_token(token),
        token_ciphertext="",
        created_by_id=principal.bot_user.id,
    )
    db.add(webhook)
    await db.commit()
    await db.refresh(webhook)
    await bot_event_dispatcher.dispatch_guild_event(db, channel.channel_id, "WEBHOOKS_UPDATE", {
        "guild_id": str(channel.channel_id),
        "channel_id": str(channel.id),
    })
    return _discord_webhook(webhook, token)


@router.get("/channels/{channel_id}/webhooks")
async def get_channel_webhooks(
    channel_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_WEBHOOKS)
    result = await db.execute(select(Webhook).where(Webhook.text_channel_id == channel_id).order_by(Webhook.id))
    return [_discord_webhook(webhook) for webhook in result.scalars().all()]


@router.get("/guilds/{guild_id}/webhooks")
async def get_guild_webhooks(
    guild_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_WEBHOOKS)
    result = await db.execute(select(Webhook).where(Webhook.server_id == guild_id).order_by(Webhook.id))
    return [_discord_webhook(webhook) for webhook in result.scalars().all()]


@router.get("/webhooks/{webhook_id}")
async def get_webhook(
    webhook_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    return _discord_webhook(await _managed_bot_webhook(db, principal, webhook_id))


@router.patch("/webhooks/{webhook_id}")
async def modify_webhook(
    webhook_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    webhook = await _managed_bot_webhook(db, principal, webhook_id)
    previous_channel_id = webhook.text_channel_id
    if "name" in payload:
        name = str(payload["name"] or "").strip()
        if not 1 <= len(name) <= 80:
            raise DiscordAPIError(400, 50035, "Invalid webhook name")
        webhook.name = name
    if "avatar" in payload:
        webhook.avatar_url = str(payload["avatar"] or "")[:2048] or None
    if "channel_id" in payload:
        try:
            target_id = int(payload["channel_id"])
        except (TypeError, ValueError) as exc:
            raise DiscordAPIError(400, 50035, "Invalid channel_id") from exc
        target, _, _ = await _require_bot_text_channel(db, principal, target_id, permission=Permission.MANAGE_WEBHOOKS)
        if target.channel_id != webhook.server_id:
            raise DiscordAPIError(400, 50035, "A webhook cannot be moved to another guild")
        webhook.text_channel_id = target.id
    await db.commit()
    for changed_channel_id in {previous_channel_id, webhook.text_channel_id}:
        await bot_event_dispatcher.dispatch_guild_event(db, webhook.server_id, "WEBHOOKS_UPDATE", {
            "guild_id": str(webhook.server_id),
            "channel_id": str(changed_channel_id),
        })
    return _discord_webhook(webhook)


@router.delete("/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    webhook = await _managed_bot_webhook(db, principal, webhook_id)
    guild_id = webhook.server_id
    channel_id = webhook.text_channel_id
    await db.delete(webhook)
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "WEBHOOKS_UPDATE", {
        "guild_id": str(guild_id),
        "channel_id": str(channel_id),
    })
    return Response(status_code=204)


@router.get("/webhooks/{webhook_id}/{token}")
async def get_webhook_with_token(webhook_id: int, token: str, db: AsyncSession = Depends(get_db)):
    from app.api.webhooks import get_webhook_with_token as implementation
    return await implementation(webhook_id=webhook_id, token=token, db=db)


@router.patch("/webhooks/{webhook_id}/{token}")
async def modify_webhook_with_token(
    webhook_id: int,
    token: str,
    payload: WebhookTokenUpdate,
    db: AsyncSession = Depends(get_db),
):
    from app.api.webhooks import update_webhook_with_token as implementation
    return await implementation(payload=payload, webhook_id=webhook_id, token=token, db=db)


@router.delete("/webhooks/{webhook_id}/{token}", status_code=204)
async def delete_webhook_with_token(webhook_id: int, token: str, db: AsyncSession = Depends(get_db)):
    from app.api.webhooks import delete_webhook_with_token as implementation
    return await implementation(webhook_id=webhook_id, token=token, db=db)


async def _interaction_webhook(db: AsyncSession, application_id: int, token: str):
    try:
        return await load_interaction_by_token(db, str(application_id), token)
    except DiscordAPIError as exc:
        if exc.code == 10062:
            return None
        raise


@router.post("/webhooks/{webhook_id}/{token}")
async def execute_webhook(
    request: Request,
    webhook_id: int,
    token: str,
    wait: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    interaction_pair = await _interaction_webhook(db, webhook_id, token)
    if interaction_pair is not None:
        interaction, application = interaction_pair
        try:
            payload = DiscordMessageCreate.model_validate(await request.json())
        except (ValidationError, ValueError) as exc:
            if isinstance(exc, ValidationError):
                raise _validation_error(exc) from exc
            raise DiscordAPIError(400, 50035, "Invalid JSON body") from exc
        message = await create_followup(db, interaction, application, payload.model_dump(exclude_unset=True))
        return discord_message(message, guild_id=interaction.guild_id)
    from app.api.webhooks import execute_webhook as implementation
    return await implementation(request=request, webhook_id=webhook_id, token=token, wait=wait, db=db)


@router.get("/webhooks/{webhook_id}/{token}/messages/{message_id}")
async def get_webhook_message(webhook_id: int, token: str, message_id: str, db: AsyncSession = Depends(get_db)):
    interaction_pair = await _interaction_webhook(db, webhook_id, token)
    if interaction_pair is not None:
        interaction, _ = interaction_pair
        if message_id == "@original":
            return discord_message(await get_original_response(db, interaction), guild_id=interaction.guild_id)
        try:
            numeric_id = int(message_id)
        except ValueError as exc:
            raise UNKNOWN_MESSAGE() from exc
        link = await db.scalar(select(BotInteractionMessage.id).where(
            BotInteractionMessage.interaction_id == interaction.id,
            BotInteractionMessage.message_id == numeric_id,
            BotInteractionMessage.is_original.is_(False),
        ))
        if link is None:
            raise UNKNOWN_MESSAGE()
        return discord_message(await load_response_message(db, numeric_id), guild_id=interaction.guild_id)
    try:
        numeric_id = int(message_id)
    except ValueError as exc:
        raise UNKNOWN_MESSAGE() from exc
    from app.api.webhooks import get_webhook_message as implementation
    return await implementation(webhook_id=webhook_id, token=token, message_id=numeric_id, db=db)


@router.patch("/webhooks/{webhook_id}/{token}/messages/{message_id}")
async def edit_webhook_message(
    request: Request,
    webhook_id: int,
    token: str,
    message_id: str,
    db: AsyncSession = Depends(get_db),
):
    interaction_pair = await _interaction_webhook(db, webhook_id, token)
    if interaction_pair is not None:
        interaction, _ = interaction_pair
        try:
            payload = DiscordMessageUpdate.model_validate(await request.json())
        except (ValidationError, ValueError) as exc:
            if isinstance(exc, ValidationError):
                raise _validation_error(exc) from exc
            raise DiscordAPIError(400, 50035, "Invalid JSON body") from exc
        changes = payload.model_dump(exclude_unset=True)
        if message_id == "@original":
            message = await edit_original_response(db, interaction, changes)
        else:
            try:
                numeric_id = int(message_id)
            except ValueError as exc:
                raise UNKNOWN_MESSAGE() from exc
            link = await db.scalar(select(BotInteractionMessage.id).where(
                BotInteractionMessage.interaction_id == interaction.id,
                BotInteractionMessage.message_id == numeric_id,
                BotInteractionMessage.is_original.is_(False),
            ))
            if link is None:
                raise UNKNOWN_MESSAGE()
            message = await update_response_message(db, interaction, await load_response_message(db, numeric_id), changes)
        return discord_message(message, guild_id=interaction.guild_id)
    try:
        numeric_id = int(message_id)
    except ValueError as exc:
        raise UNKNOWN_MESSAGE() from exc
    from app.api.webhooks import edit_webhook_message as implementation
    return await implementation(request=request, webhook_id=webhook_id, token=token, message_id=numeric_id, db=db)


@router.delete("/webhooks/{webhook_id}/{token}/messages/{message_id}", status_code=204)
async def delete_webhook_message(webhook_id: int, token: str, message_id: str, db: AsyncSession = Depends(get_db)):
    interaction_pair = await _interaction_webhook(db, webhook_id, token)
    if interaction_pair is not None:
        interaction, _ = interaction_pair
        if message_id == "@original":
            message = await get_original_response(db, interaction)
        else:
            try:
                numeric_id = int(message_id)
            except ValueError as exc:
                raise UNKNOWN_MESSAGE() from exc
            link = await db.scalar(select(BotInteractionMessage.id).where(
                BotInteractionMessage.interaction_id == interaction.id,
                BotInteractionMessage.message_id == numeric_id,
                BotInteractionMessage.is_original.is_(False),
            ))
            if link is None:
                raise UNKNOWN_MESSAGE()
            message = await load_response_message(db, numeric_id)
        await delete_response_message(db, interaction, message)
        return Response(status_code=204)
    try:
        numeric_id = int(message_id)
    except ValueError as exc:
        raise UNKNOWN_MESSAGE() from exc
    from app.api.webhooks import delete_webhook_message as implementation
    return await implementation(webhook_id=webhook_id, token=token, message_id=numeric_id, db=db)


async def _discord_invite_payload(db: AsyncSession, invite: Invite) -> dict[str, Any]:
    guild = await _guild(db, invite.server_id)
    channel = await db.get(TextChannel, invite.target_text_channel_id) if invite.target_text_channel_id else None
    inviter = await db.get(User, invite.inviter_id) if invite.inviter_id else None
    created_at = invite.created_at
    max_age = 0
    if invite.expires_at and created_at:
        expires = invite.expires_at if invite.expires_at.tzinfo else invite.expires_at.replace(tzinfo=timezone.utc)
        created = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        max_age = max(0, int((expires - created).total_seconds()))
    return {
        "type": 0,
        "code": invite.code,
        "guild": {"id": str(guild.id), "name": guild.name, "icon": guild.icon, "features": []},
        "channel": ({"id": str(channel.id), "name": channel.name, "type": 0} if channel else None),
        "inviter": discord_user(inviter) if inviter else None,
        "target_type": None,
        "approximate_presence_count": None,
        "approximate_member_count": None,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        "uses": int(invite.uses or 0),
        "max_uses": int(invite.max_uses or 0),
        "max_age": max_age,
        "temporary": False,
        "created_at": invite.created_at.isoformat() if invite.created_at else None,
    }


async def _new_invite_code(db: AsyncSession) -> str:
    for _ in range(10):
        code = secrets.token_urlsafe(8).replace("-", "").replace("_", "")[:10]
        if not await db.scalar(select(Invite.id).where(Invite.code == code)):
            return code
    raise DiscordAPIError(500, 0, "Could not create invite")


@router.get("/invites/{code}")
async def get_invite(code: str, db: AsyncSession = Depends(get_db)):
    invite = await db.scalar(select(Invite).where(Invite.code == code))
    now = datetime.now(timezone.utc)
    if invite is None or (invite.expires_at and (invite.expires_at if invite.expires_at.tzinfo else invite.expires_at.replace(tzinfo=timezone.utc)) <= now):
        raise DiscordAPIError(404, 10006, "Unknown Invite")
    return await _discord_invite_payload(db, invite)


@router.post("/channels/{channel_id}/invites", status_code=200)
async def create_channel_invite(
    channel_id: int,
    payload: dict[str, Any] = Body(default={}),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.CREATE_INSTANT_INVITE)
    max_age = max(0, min(604800, int(payload.get("max_age") or 86400)))
    max_uses = max(0, min(100, int(payload.get("max_uses") or 0)))
    unique = bool(payload.get("unique"))
    if not unique:
        now = datetime.now(timezone.utc)
        result = await db.execute(select(Invite).where(
            Invite.server_id == channel.channel_id,
            Invite.target_text_channel_id == channel_id,
            or_(Invite.expires_at.is_(None), Invite.expires_at > now),
        ).order_by(Invite.id.desc()).limit(1))
        existing = result.scalar_one_or_none()
        if existing is not None and (not existing.max_uses or existing.uses < existing.max_uses):
            return await _discord_invite_payload(db, existing)
    invite = Invite(
        code=await _new_invite_code(db),
        server_id=channel.channel_id,
        inviter_id=principal.bot_user.id,
        target_text_channel_id=channel_id,
        max_uses=max_uses or None,
        uses=0,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=max_age) if max_age else None,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    response = await _discord_invite_payload(db, invite)
    await bot_event_dispatcher.dispatch_guild_event(db, channel.channel_id, "INVITE_CREATE", response)
    return response


@router.get("/channels/{channel_id}/invites")
async def get_channel_invites(
    channel_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_CHANNELS)
    result = await db.execute(select(Invite).where(Invite.target_text_channel_id == channel_id).order_by(Invite.id))
    return [await _discord_invite_payload(db, invite) for invite in result.scalars().all()]


@router.get("/guilds/{guild_id}/invites")
async def get_guild_invites(
    guild_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_GUILD)
    result = await db.execute(select(Invite).where(Invite.server_id == guild_id).order_by(Invite.id))
    return [await _discord_invite_payload(db, invite) for invite in result.scalars().all()]


@router.delete("/invites/{code}")
async def delete_invite(
    code: str,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    invite = await db.scalar(select(Invite).where(Invite.code == code))
    if invite is None:
        raise DiscordAPIError(404, 10006, "Unknown Invite")
    await _require_guild_permission(db, principal, invite.server_id, Permission.MANAGE_GUILD)
    response = await _discord_invite_payload(db, invite)
    guild_id = invite.server_id
    await db.delete(invite)
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "INVITE_DELETE", {"channel_id": response["channel"]["id"] if response["channel"] else None, "guild_id": str(guild_id), "code": code})
    return response


@router.get("/guilds/{guild_id}/roles")
async def get_guild_roles(
    guild_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _active_install(db, principal, guild_id)
    result = await db.execute(select(Role).where(Role.server_id == guild_id).order_by(Role.position))
    return [discord_role(role, guild_id=guild_id) for role in result.scalars().all()]


def _role_color(value: Any) -> str | None:
    try:
        color = int(value or 0)
    except (TypeError, ValueError) as exc:
        raise DiscordAPIError(400, 50035, "Role color must be an integer") from exc
    if color < 0 or color > 0xFFFFFF:
        raise DiscordAPIError(400, 50035, "Role color is outside the RGB range")
    return f"#{color:06x}" if color else None


def _role_permissions(value: Any) -> int:
    try:
        permissions = int(value or 0)
    except (TypeError, ValueError) as exc:
        raise DiscordAPIError(400, 50035, "permissions must be an integer string") from exc
    if permissions < 0 or permissions & ~ALL_PERMISSIONS:
        raise DiscordAPIError(400, 50035, "Invalid permissions")
    return permissions


@router.post("/guilds/{guild_id}/roles", status_code=200)
async def create_guild_role(
    guild_id: int,
    payload: dict[str, Any] = Body(default={}),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    top_position = await get_top_role_position(db, guild_id, principal.bot_user.id)
    if top_position <= 1:
        raise MISSING_PERMISSIONS()
    name = str(payload.get("name") or "new role").strip()
    if not 1 <= len(name) <= 100:
        raise DiscordAPIError(400, 50035, "Role name must be 1-100 characters")
    permissions = _role_permissions(payload.get("permissions"))
    role = Role(
        server_id=guild_id,
        name=name,
        color=_role_color(payload.get("color")),
        position=max(1, top_position - 1),
        permissions=permissions,
        legacy_permissions=discord_permissions_to_legacy(permissions),
        is_default=False,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    response = discord_role(role, guild_id=guild_id)
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "GUILD_ROLE_CREATE", {"guild_id": str(guild_id), "role": response})
    return response


@router.patch("/guilds/{guild_id}/roles/{role_id}")
async def modify_guild_role(
    guild_id: int,
    role_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    role = await db.get(Role, role_id)
    if role is None:
        raise DiscordAPIError(404, 10011, "Unknown Role")
    await _role_target_allowed(db, principal, guild_id, role)
    if "name" in payload:
        name = str(payload["name"] or "").strip()
        if not 1 <= len(name) <= 100:
            raise DiscordAPIError(400, 50035, "Role name must be 1-100 characters")
        role.name = name
    if "color" in payload or "colors" in payload:
        color_value = payload.get("color")
        if color_value is None and isinstance(payload.get("colors"), dict):
            color_value = payload["colors"].get("primary_color")
        role.color = _role_color(color_value)
    if "permissions" in payload:
        permissions = _role_permissions(payload["permissions"])
        own_permissions = await get_member_permissions(db, guild_id, principal.bot_user.id)
        if not has_permission(own_permissions, Permission.ADMINISTRATOR) and permissions & ~own_permissions:
            raise MISSING_PERMISSIONS()
        role.permissions = permissions
        role.legacy_permissions = discord_permissions_to_legacy(permissions)
    await db.commit()
    response = discord_role(role, guild_id=guild_id)
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "GUILD_ROLE_UPDATE", {"guild_id": str(guild_id), "role": response})
    return response


@router.delete("/guilds/{guild_id}/roles/{role_id}", status_code=204)
async def delete_guild_role(
    guild_id: int,
    role_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    role = await db.get(Role, role_id)
    if role is None:
        raise DiscordAPIError(404, 10011, "Unknown Role")
    await _role_target_allowed(db, principal, guild_id, role)
    await db.delete(role)
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "GUILD_ROLE_DELETE", {"guild_id": str(guild_id), "role_id": str(role_id)})
    return Response(status_code=204)


async def _guild_member_payload(db: AsyncSession, guild_id: int, user: User) -> dict[str, Any]:
    membership_result = await db.execute(
        select(ChannelMember).where(ChannelMember.channel_id == guild_id, ChannelMember.user_id == user.id)
    )
    membership = membership_result.scalar_one_or_none()
    if membership is None:
        raise DiscordAPIError(404, 10007, "Unknown Member")
    roles_result = await db.execute(
        select(MemberRole.role_id).where(MemberRole.server_id == guild_id, MemberRole.user_id == user.id)
    )
    return {
        "user": discord_user(user),
        "nick": membership.nickname,
        "avatar": None,
        "banner": None,
        "roles": [str(item) for item in roles_result.scalars().all()],
        "joined_at": membership.joined_at.isoformat() if membership.joined_at else None,
        "premium_since": None,
        "deaf": False,
        "mute": False,
        "flags": 0,
        "pending": False,
        "permissions": str(await get_member_permissions(db, guild_id, user.id)),
        "communication_disabled_until": None,
        "avatar_decoration_data": None,
    }


@router.get("/guilds/{guild_id}/members/@me")
async def get_current_member(
    guild_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _active_install(db, principal, guild_id)
    return await _guild_member_payload(db, guild_id, principal.bot_user)


@router.get("/guilds/{guild_id}/members/{user_id}")
async def get_guild_member(
    guild_id: int,
    user_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _active_install(db, principal, guild_id)
    user = await db.get(User, user_id)
    if user is None:
        raise DiscordAPIError(404, 10007, "Unknown Member")
    return await _guild_member_payload(db, guild_id, user)


@router.get("/guilds/{guild_id}/members")
async def list_guild_members(
    guild_id: int,
    limit: int = Query(default=1, ge=1, le=1000),
    after: int = Query(default=0, ge=0),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _active_install(db, principal, guild_id)
    result = await db.execute(
        select(User)
        .join(ChannelMember, ChannelMember.user_id == User.id)
        .where(ChannelMember.channel_id == guild_id, User.id > after)
        .order_by(User.id)
        .limit(limit)
    )
    return [await _guild_member_payload(db, guild_id, user) for user in result.scalars().all()]


async def _member_target_allowed(
    db: AsyncSession,
    principal: BotPrincipal,
    guild: Channel,
    target_user_id: int,
) -> None:
    if target_user_id in {guild.owner_id, principal.bot_user.id}:
        raise MISSING_PERMISSIONS()
    actor_position = await get_top_role_position(db, guild.id, principal.bot_user.id, owner_id=guild.owner_id)
    target_position = await get_top_role_position(db, guild.id, target_user_id, owner_id=guild.owner_id)
    if target_position >= actor_position:
        raise MISSING_PERMISSIONS()


@router.put("/guilds/{guild_id}/members/{user_id}/roles/{role_id}", status_code=204)
async def add_guild_member_role(
    guild_id: int,
    user_id: int,
    role_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    guild, _, _ = await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    membership = await db.scalar(select(ChannelMember.id).where(
        ChannelMember.channel_id == guild_id,
        ChannelMember.user_id == user_id,
    ))
    if membership is None:
        raise DiscordAPIError(404, 10007, "Unknown Member")
    role = await db.get(Role, role_id)
    if role is None:
        raise DiscordAPIError(404, 10011, "Unknown Role")
    await _role_target_allowed(db, principal, guild_id, role)
    if user_id != principal.bot_user.id:
        await _member_target_allowed(db, principal, guild, user_id)
    existing = await db.scalar(select(MemberRole.id).where(
        MemberRole.server_id == guild_id,
        MemberRole.user_id == user_id,
        MemberRole.role_id == role_id,
    ))
    if existing is None:
        db.add(MemberRole(server_id=guild_id, user_id=user_id, role_id=role_id))
        await db.commit()
    user = await db.get(User, user_id)
    if user is not None:
        member = await _guild_member_payload(db, guild_id, user)
        member["guild_id"] = str(guild_id)
        await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "GUILD_MEMBER_UPDATE", member, required_intent=1 << 1)
    return Response(status_code=204)


@router.delete("/guilds/{guild_id}/members/{user_id}/roles/{role_id}", status_code=204)
async def remove_guild_member_role(
    guild_id: int,
    user_id: int,
    role_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    guild, _, _ = await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    membership = await db.scalar(select(ChannelMember.id).where(
        ChannelMember.channel_id == guild_id,
        ChannelMember.user_id == user_id,
    ))
    if membership is None:
        raise DiscordAPIError(404, 10007, "Unknown Member")
    role = await db.get(Role, role_id)
    if role is None:
        raise DiscordAPIError(404, 10011, "Unknown Role")
    await _role_target_allowed(db, principal, guild_id, role)
    if user_id != principal.bot_user.id:
        await _member_target_allowed(db, principal, guild, user_id)
    await db.execute(delete(MemberRole).where(
        MemberRole.server_id == guild_id,
        MemberRole.user_id == user_id,
        MemberRole.role_id == role_id,
    ))
    await db.commit()
    user = await db.get(User, user_id)
    if user is not None:
        member = await _guild_member_payload(db, guild_id, user)
        member["guild_id"] = str(guild_id)
        await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "GUILD_MEMBER_UPDATE", member, required_intent=1 << 1)
    return Response(status_code=204)


@router.delete("/guilds/{guild_id}/members/{user_id}", status_code=204)
async def remove_guild_member(
    guild_id: int,
    user_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    guild, _, _ = await _require_guild_permission(db, principal, guild_id, Permission.KICK_MEMBERS)
    await _member_target_allowed(db, principal, guild, user_id)
    membership = await db.scalar(select(ChannelMember.id).where(
        ChannelMember.channel_id == guild_id,
        ChannelMember.user_id == user_id,
    ))
    if membership is None:
        raise DiscordAPIError(404, 10007, "Unknown Member")
    await db.execute(delete(MemberRole).where(MemberRole.server_id == guild_id, MemberRole.user_id == user_id))
    await db.execute(delete(ChannelMember).where(ChannelMember.channel_id == guild_id, ChannelMember.user_id == user_id))
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        guild_id,
        "GUILD_MEMBER_REMOVE",
        {"guild_id": str(guild_id), "user": {"id": str(user_id)}},
        required_intent=1 << 1,
    )
    return Response(status_code=204)


def _ban_payload(ban: ServerBan) -> dict[str, Any]:
    return {"reason": ban.reason, "user": discord_user(ban.user)}


@router.get("/guilds/{guild_id}/bans")
async def get_guild_bans(
    guild_id: int,
    limit: int = Query(default=1000, ge=1, le=1000),
    before: int | None = Query(default=None),
    after: int | None = Query(default=None),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.BAN_MEMBERS)
    if before is not None and after is not None:
        raise DiscordAPIError(400, 50035, "before and after are mutually exclusive")
    query = select(ServerBan).options(selectinload(ServerBan.user)).where(ServerBan.server_id == guild_id)
    if before is not None:
        query = query.where(ServerBan.user_id < before).order_by(ServerBan.user_id.desc())
    elif after is not None:
        query = query.where(ServerBan.user_id > after).order_by(ServerBan.user_id.asc())
    else:
        query = query.order_by(ServerBan.user_id.asc())
    result = await db.execute(query.limit(limit))
    return [_ban_payload(item) for item in result.scalars().all()]


@router.get("/guilds/{guild_id}/bans/{user_id}")
async def get_guild_ban(
    guild_id: int,
    user_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.BAN_MEMBERS)
    result = await db.execute(select(ServerBan).options(selectinload(ServerBan.user)).where(
        ServerBan.server_id == guild_id,
        ServerBan.user_id == user_id,
    ))
    ban = result.scalar_one_or_none()
    if ban is None:
        raise DiscordAPIError(404, 10026, "Unknown Ban")
    return _ban_payload(ban)


@router.put("/guilds/{guild_id}/bans/{user_id}", status_code=204)
async def create_guild_ban(
    guild_id: int,
    user_id: int,
    payload: dict[str, Any] = Body(default={}),
    audit_reason: str | None = Header(default=None, alias="X-Audit-Log-Reason"),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    guild, _, _ = await _require_guild_permission(db, principal, guild_id, Permission.BAN_MEMBERS)
    await _member_target_allowed(db, principal, guild, user_id)
    user = await db.get(User, user_id)
    if user is None:
        raise DiscordAPIError(404, 10013, "Unknown User")
    ban = await db.scalar(select(ServerBan).where(ServerBan.server_id == guild_id, ServerBan.user_id == user_id))
    if ban is None:
        ban = ServerBan(server_id=guild_id, user_id=user_id, moderator_id=principal.bot_user.id)
        db.add(ban)
    ban.reason = (audit_reason or str(payload.get("reason") or ""))[:512] or None
    await db.execute(delete(MemberRole).where(MemberRole.server_id == guild_id, MemberRole.user_id == user_id))
    await db.execute(delete(ChannelMember).where(ChannelMember.channel_id == guild_id, ChannelMember.user_id == user_id))
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        guild_id,
        "GUILD_BAN_ADD",
        {"guild_id": str(guild_id), "user": discord_user(user)},
        required_intent=1 << 2,
    )
    return Response(status_code=204)


@router.delete("/guilds/{guild_id}/bans/{user_id}", status_code=204)
async def remove_guild_ban(
    guild_id: int,
    user_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.BAN_MEMBERS)
    result = await db.execute(select(ServerBan).options(selectinload(ServerBan.user)).where(
        ServerBan.server_id == guild_id,
        ServerBan.user_id == user_id,
    ))
    ban = result.scalar_one_or_none()
    if ban is None:
        raise DiscordAPIError(404, 10026, "Unknown Ban")
    user_payload = discord_user(ban.user)
    await db.delete(ban)
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        guild_id,
        "GUILD_BAN_REMOVE",
        {"guild_id": str(guild_id), "user": user_payload},
        required_intent=1 << 2,
    )
    return Response(status_code=204)


@router.get("/channels/{channel_id}/messages")
async def get_channel_messages(
    channel_id: int,
    around: int | None = Query(default=None),
    before: int | None = Query(default=None),
    after: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.READ_MESSAGE_HISTORY)
    if sum(value is not None for value in (around, before, after)) > 1:
        raise DiscordAPIError(400, 50035, "Only one of around, before, or after may be provided")
    query = select(Message).options(
        selectinload(Message.author),
        selectinload(Message.attachments),
        selectinload(Message.reactions),
        selectinload(Message.reply_to).selectinload(Message.author),
        selectinload(Message.reply_to).selectinload(Message.attachments),
        selectinload(Message.reply_to).selectinload(Message.reactions),
    ).where(
        Message.text_channel_id == channel_id,
        Message.is_deleted.is_(False),
        or_(Message.ephemeral_user_id.is_(None), Message.ephemeral_user_id == principal.bot_user.id),
    )
    if around is not None:
        half = max(1, limit // 2)
        query = query.where(Message.id.between(max(0, around - half), around + half)).order_by(Message.id.desc())
    elif before is not None:
        query = query.where(Message.id < before).order_by(Message.id.desc())
    elif after is not None:
        query = query.where(Message.id > after).order_by(Message.id.asc())
    else:
        query = query.order_by(Message.id.desc())
    result = await db.execute(query.limit(limit))
    messages = list(result.scalars().unique().all())
    if after is not None:
        messages.reverse()
    return [discord_message(item, guild_id=channel.channel_id) for item in messages]


@router.get("/channels/{channel_id}/messages/{message_id}")
async def get_channel_message(
    channel_id: int,
    message_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.READ_MESSAGE_HISTORY)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id or message.is_deleted:
        raise UNKNOWN_MESSAGE()
    return discord_message(message, guild_id=channel.channel_id)


@router.post("/channels/{channel_id}/messages", status_code=200)
async def create_message(
    channel_id: int,
    raw_payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = DiscordMessageCreate.model_validate(raw_payload)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.SEND_MESSAGES)
    nonce = str(payload.nonce)[:36] if payload.nonce is not None else None
    if nonce:
        existing_result = await db.execute(
            select(Message).where(Message.author_id == principal.bot_user.id, Message.client_nonce == nonce)
        )
        existing = existing_result.scalar_one_or_none()
        if existing is not None:
            if payload.enforce_nonce:
                return discord_message(await _message(db, existing.id), guild_id=channel.channel_id)
            nonce = None
    reply_to_id = None
    if payload.message_reference and payload.message_reference.get("message_id"):
        try:
            reply_to_id = int(payload.message_reference["message_id"])
        except (TypeError, ValueError) as exc:
            raise DiscordAPIError(400, 50035, "Invalid message reference") from exc
        referenced = await _message(db, reply_to_id)
        if referenced.text_channel_id != channel_id:
            raise UNKNOWN_MESSAGE()
    message = Message(
        author_id=principal.bot_user.id,
        text_channel_id=channel_id,
        content=payload.content.strip() if payload.content else None,
        embeds=payload.embeds,
        components=payload.components,
        poll=payload.poll,
        flags=payload.flags,
        tts=payload.tts,
        client_nonce=nonce,
        reply_to_id=reply_to_id,
        application_id=principal.application.client_id,
    )
    db.add(message)
    await db.commit()
    loaded = await _message(db, message.id)
    internal = bot_event_dispatcher.internal_message_payload(loaded)
    await manager.send_to_channel(channel_id, {"type": "new_message", "data": internal})
    await bot_event_dispatcher.dispatch_message_create(db, loaded)
    return discord_message(loaded, guild_id=channel.channel_id)


@router.patch("/channels/{channel_id}/messages/{message_id}")
async def edit_message(
    channel_id: int,
    message_id: int,
    raw_payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = DiscordMessageUpdate.model_validate(raw_payload)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.SEND_MESSAGES)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id or message.author_id != principal.bot_user.id:
        raise UNKNOWN_MESSAGE()
    changes = payload.model_dump(exclude_unset=True)
    for field in ("content", "embeds", "flags", "components"):
        if field in changes:
            setattr(message, field, changes[field])
    message.is_edited = True
    await db.commit()
    loaded = await _message(db, message.id)
    internal = bot_event_dispatcher.internal_message_payload(loaded)
    await manager.send_to_channel(channel_id, {"type": "message_edited", "data": internal})
    await bot_event_dispatcher.dispatch_message_update(db, loaded)
    return discord_message(loaded, guild_id=channel.channel_id)


@router.delete("/channels/{channel_id}/messages/{message_id}", status_code=204)
async def delete_message(
    channel_id: int,
    message_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, permissions = await _require_bot_text_channel(db, principal, channel_id)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    if message.author_id != principal.bot_user.id and not has_permission(permissions, Permission.MANAGE_MESSAGES):
        raise MISSING_PERMISSIONS()
    await db.delete(message)
    await db.commit()
    await manager.send_to_channel(channel_id, {"type": "message_deleted", "data": {"message_id": message_id, "text_channel_id": channel_id}})
    await bot_event_dispatcher.dispatch_message_delete(db, message_id, channel_id)
    return Response(status_code=204)


@router.put("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me", status_code=204)
async def create_reaction(
    channel_id: int,
    message_id: int,
    emoji: str,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id, permission=Permission.ADD_REACTIONS)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    existing = await db.scalar(select(Reaction.id).where(
        Reaction.message_id == message_id,
        Reaction.user_id == principal.bot_user.id,
        Reaction.emoji == emoji,
    ))
    if existing is None:
        db.add(Reaction(message_id=message_id, user_id=principal.bot_user.id, emoji=emoji[:10]))
        await db.commit()
    await bot_event_dispatcher.dispatch_message_reaction_add(db, message, principal.bot_user, emoji)
    return Response(status_code=204)


@router.delete("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me", status_code=204)
async def delete_own_reaction(
    channel_id: int,
    message_id: int,
    emoji: str,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    await db.execute(delete(Reaction).where(
        Reaction.message_id == message_id,
        Reaction.user_id == principal.bot_user.id,
        Reaction.emoji == emoji,
    ))
    await db.commit()
    await bot_event_dispatcher.dispatch_message_reaction_remove(db, message, principal.bot_user, emoji)
    return Response(status_code=204)


@router.get("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}")
async def get_reactions(
    channel_id: int,
    message_id: int,
    emoji: str,
    limit: int = Query(default=25, ge=1, le=100),
    after: int = Query(default=0, ge=0),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id, permission=Permission.READ_MESSAGE_HISTORY)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    result = await db.execute(
        select(User)
        .join(Reaction, Reaction.user_id == User.id)
        .where(Reaction.message_id == message_id, Reaction.emoji == emoji, User.id > after)
        .order_by(User.id)
        .limit(limit)
    )
    return [discord_user(user) for user in result.scalars().all()]


@router.delete("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}/{user_id}", status_code=204)
async def delete_user_reaction(
    channel_id: int,
    message_id: int,
    emoji: str,
    user_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_MESSAGES)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    user = await db.get(User, user_id)
    await db.execute(delete(Reaction).where(
        Reaction.message_id == message_id,
        Reaction.user_id == user_id,
        Reaction.emoji == emoji,
    ))
    await db.commit()
    if user is not None:
        await bot_event_dispatcher.dispatch_message_reaction_remove(db, message, user, emoji)
    return Response(status_code=204)


@router.delete("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}", status_code=204)
async def delete_all_reactions_for_emoji(
    channel_id: int,
    message_id: int,
    emoji: str,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_MESSAGES)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    await db.execute(delete(Reaction).where(Reaction.message_id == message_id, Reaction.emoji == emoji))
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(db, channel.channel_id, "MESSAGE_REACTION_REMOVE_EMOJI", {
        "channel_id": str(channel_id),
        "message_id": str(message_id),
        "guild_id": str(channel.channel_id),
        "emoji": {"id": None, "name": emoji},
    }, required_intent=1 << 10)
    return Response(status_code=204)


@router.delete("/channels/{channel_id}/messages/{message_id}/reactions", status_code=204)
async def delete_all_reactions(
    channel_id: int,
    message_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    channel, _, _ = await _require_bot_text_channel(db, principal, channel_id, permission=Permission.MANAGE_MESSAGES)
    message = await _message(db, message_id)
    if message.text_channel_id != channel_id:
        raise UNKNOWN_MESSAGE()
    await db.execute(delete(Reaction).where(Reaction.message_id == message_id))
    await db.commit()
    await bot_event_dispatcher.dispatch_guild_event(db, channel.channel_id, "MESSAGE_REACTION_REMOVE_ALL", {
        "channel_id": str(channel_id),
        "message_id": str(message_id),
        "guild_id": str(channel.channel_id),
    }, required_intent=1 << 10)
    return Response(status_code=204)


def _command_scope(application_id: int, guild_id: int | None) -> list[Any]:
    clauses: list[Any] = [BotCommand.application_id == application_id]
    clauses.append(BotCommand.server_id == guild_id if guild_id is not None else BotCommand.server_id.is_(None))
    return clauses


async def _upsert_command(
    db: AsyncSession,
    principal: BotPrincipal,
    payload: DiscordApplicationCommandPayload,
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
            raise DiscordAPIError(400, 30032, "Maximum number of application commands reached")
        command = BotCommand(application_id=principal.application.id, server_id=guild_id)
        db.add(command)
    command.name = payload.name
    command.description = payload.description
    command.command_type = payload.type
    command.name_localizations = payload.name_localizations
    command.description_localizations = payload.description_localizations
    command.default_member_permissions = int(payload.default_member_permissions) if payload.default_member_permissions is not None else None
    command.legacy_default_member_permissions = (
        discord_permissions_to_legacy(command.default_member_permissions)
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
    return [discord_command(item, application_client_id=principal.application.client_id) for item in result.scalars().all()]


@router.get("/applications/{application_id}/commands")
async def list_global_commands(
    application_id: str,
    with_localizations: bool = Query(default=False),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    return await _list_commands(db, principal, None)


@router.get("/applications/{application_id}/guilds/{guild_id}/commands")
async def list_guild_commands(
    application_id: str,
    guild_id: int,
    with_localizations: bool = Query(default=False),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    return await _list_commands(db, principal, guild_id)


@router.post("/applications/{application_id}/commands")
async def create_global_command(
    application_id: str,
    raw_payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    try:
        payload = DiscordApplicationCommandPayload.model_validate(raw_payload)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    command, created = await _upsert_command(db, principal, payload, guild_id=None)
    return discord_command(command, application_client_id=principal.application.client_id)


@router.post("/applications/{application_id}/guilds/{guild_id}/commands")
async def create_guild_command(
    application_id: str,
    guild_id: int,
    raw_payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    try:
        payload = DiscordApplicationCommandPayload.model_validate(raw_payload)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    command, created = await _upsert_command(db, principal, payload, guild_id=guild_id)
    return discord_command(command, application_client_id=principal.application.client_id)


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
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    await _active_install(db, principal, guild_id)
    result = await db.execute(select(BotCommand).where(
        BotCommand.application_id == principal.application.id,
        BotCommand.is_enabled.is_(True),
        or_(BotCommand.server_id == guild_id, BotCommand.server_id.is_(None)),
    ).order_by(BotCommand.id))
    return [_command_permissions_payload(command, application_id, guild_id) for command in result.scalars().all()]


async def _guild_permission_command(
    db: AsyncSession,
    principal: BotPrincipal,
    guild_id: int,
    command_id: int,
) -> BotCommand:
    command = await db.scalar(select(BotCommand).where(
        BotCommand.application_id == principal.application.id,
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
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    await _active_install(db, principal, guild_id)
    command = await _guild_permission_command(db, principal, guild_id, command_id)
    return _command_permissions_payload(command, application_id, guild_id)


@router.put("/applications/{application_id}/guilds/{guild_id}/commands/{command_id}/permissions")
async def edit_application_command_permissions(
    application_id: str,
    guild_id: int,
    command_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_GUILD)
    command = await _guild_permission_command(db, principal, guild_id, command_id)
    raw_permissions = payload.get("permissions")
    if not isinstance(raw_permissions, list) or len(raw_permissions) > 100:
        raise DiscordAPIError(400, 50035, "permissions must be an array with at most 100 entries")
    cleaned: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for item in raw_permissions:
        if not isinstance(item, dict):
            raise DiscordAPIError(400, 50035, "Each command permission must be an object")
        try:
            permission_type = int(item.get("type"))
            target_id = str(int(item.get("id")))
        except (TypeError, ValueError) as exc:
            raise DiscordAPIError(400, 50035, "Invalid command permission target") from exc
        if permission_type not in {1, 2, 3} or (permission_type, target_id) in seen:
            raise DiscordAPIError(400, 50035, "Invalid or duplicate command permission target")
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
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    return discord_command(await _get_command(db, principal, command_id, None), application_client_id=principal.application.client_id)


@router.get("/applications/{application_id}/guilds/{guild_id}/commands/{command_id}")
async def get_guild_command(
    application_id: str,
    guild_id: int,
    command_id: int,
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    await _active_install(db, principal, guild_id)
    return discord_command(await _get_command(db, principal, command_id, guild_id), application_client_id=principal.application.client_id)


async def _edit_command(
    db: AsyncSession,
    principal: BotPrincipal,
    command_id: int,
    guild_id: int | None,
    raw_payload: dict[str, Any],
) -> dict[str, Any]:
    command = await _get_command(db, principal, command_id, guild_id)
    current = discord_command(command, application_client_id=principal.application.client_id)
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
        payload = DiscordApplicationCommandPayload.model_validate(merged)
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
        discord_permissions_to_legacy(command.default_member_permissions)
        if command.default_member_permissions is not None
        else None
    )
    command.dm_permission = True if payload.dm_permission is None else payload.dm_permission
    command.nsfw = payload.nsfw
    command.integration_types = payload.integration_types
    command.contexts = payload.contexts
    command.version += 1
    await db.commit()
    return discord_command(command, application_client_id=principal.application.client_id)


@router.patch("/applications/{application_id}/commands/{command_id}")
async def edit_global_command(
    application_id: str,
    command_id: int,
    raw_payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
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
    principal: BotPrincipal = Depends(get_discord_bot),
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
    principal: BotPrincipal = Depends(get_discord_bot),
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
    principal: BotPrincipal = Depends(get_discord_bot),
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
    parsed: list[DiscordApplicationCommandPayload] = []
    try:
        parsed = [DiscordApplicationCommandPayload.model_validate(item) for item in raw_payload]
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    keys = [(item.name, item.type) for item in parsed]
    if len(keys) != len(set(keys)):
        raise DiscordAPIError(400, 50035, "Command names and types must be unique")
    existing_result = await db.execute(select(BotCommand).where(*_command_scope(principal.application.id, guild_id)))
    existing = {(item.name, int(item.command_type)): item for item in existing_result.scalars().all()}
    output = []
    for item in parsed:
        command, _ = await _upsert_command(db, principal, item, guild_id=guild_id)
        output.append(discord_command(command, application_client_id=principal.application.client_id))
    remove_ids = [item.id for key, item in existing.items() if key not in set(keys)]
    if remove_ids:
        await db.execute(delete(BotCommand).where(BotCommand.id.in_(remove_ids)))
        await db.commit()
    return output


@router.put("/applications/{application_id}/commands")
async def bulk_overwrite_global_commands(
    application_id: str,
    raw_payload: list[dict[str, Any]] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    return await _bulk_overwrite(db, principal, None, raw_payload)


@router.put("/applications/{application_id}/guilds/{guild_id}/commands")
async def bulk_overwrite_guild_commands(
    application_id: str,
    guild_id: int,
    raw_payload: list[dict[str, Any]] = Body(...),
    principal: BotPrincipal = Depends(get_discord_bot),
    db: AsyncSession = Depends(get_db),
):
    _require_application(principal, application_id)
    await _active_install(db, principal, guild_id)
    return await _bulk_overwrite(db, principal, guild_id, raw_payload)
