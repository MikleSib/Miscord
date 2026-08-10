"""Routes extracted mechanically from miscord_api.py; keep below 600 lines."""

from .miscord_api_shared import *  # noqa: F401,F403

router = APIRouter()

@router.get("/users/@me")
async def get_current_user(identity: tuple[User, BotPrincipal | OAuthPrincipal] = Depends(get_miscord_identity)):
    return miscord_user(identity[0])


@router.get("/oauth2/applications/@me")
@router.get("/applications/@me")
async def get_current_application(principal: BotPrincipal = Depends(get_miscord_bot)):
    return _application_payload(principal.application)


@router.get("/users/{user_id}")
async def get_user(
    user_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if user is None:
        raise MiscordAPIError(404, 10013, "Unknown User")
    return miscord_user(user)


@router.get("/users/@me/guilds")
async def get_current_user_guilds(
    identity: tuple[User, BotPrincipal | OAuthPrincipal] = Depends(get_miscord_identity),
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
    identity: tuple[User, BotPrincipal | OAuthPrincipal] = Depends(get_miscord_identity),
):
    _, principal = identity
    if not isinstance(principal, OAuthPrincipal) or "connections" not in principal.scopes:
        raise MISSING_ACCESS()
    return []


@router.get("/guilds/{guild_id}")
async def get_guild(
    guild_id: int,
    with_counts: bool = Query(default=False),
    principal: BotPrincipal = Depends(get_miscord_bot),
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
        "roles": [miscord_role(role, guild_id=guild_id) for role in roles_result.scalars().all()],
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
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    guild, _, _ = await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_GUILD)
    if "name" in payload:
        name = str(payload["name"] or "").strip()
        if not 2 <= len(name) <= 100:
            raise MiscordAPIError(400, 50035, "Guild name must be 2-100 characters")
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
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _active_install(db, principal, guild_id)
    text_result = await db.execute(select(TextChannel).where(TextChannel.channel_id == guild_id, TextChannel.is_hidden.is_(False)))
    voice_result = await db.execute(select(VoiceChannel).where(VoiceChannel.channel_id == guild_id))
    output = []
    for channel in text_result.scalars().all():
        output.append(miscord_channel(channel, guild_id=guild_id, overwrites=await _channel_overwrites(db, guild_id, channel.id, "text")))
    for channel in voice_result.scalars().all():
        output.append(miscord_channel(channel, guild_id=guild_id, overwrites=await _channel_overwrites(db, guild_id, channel.id, "voice")))
    return sorted(output, key=lambda item: (item["position"], item["id"]))


@router.post("/guilds/{guild_id}/channels", status_code=201)
async def create_guild_channel(
    guild_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_CHANNELS)
    name = str(payload.get("name") or "").strip()
    if not 1 <= len(name) <= 100:
        raise MiscordAPIError(400, 50035, "Channel name must be 1-100 characters")
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
        raise MiscordAPIError(400, 50035, "Only guild text and voice channels are supported")
    db.add(channel)
    await db.commit()
    await db.refresh(channel)
    response = miscord_channel(channel, guild_id=guild_id, overwrites=[])
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "CHANNEL_CREATE", response)
    return response


@router.get("/channels/{channel_id}")
async def get_channel(
    channel_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    text_channel = await db.get(TextChannel, channel_id)
    if text_channel is not None and not text_channel.is_hidden:
        await _active_install(db, principal, text_channel.channel_id)
        return miscord_channel(
            text_channel,
            guild_id=text_channel.channel_id,
            overwrites=await _channel_overwrites(db, text_channel.channel_id, channel_id, "text"),
        )
    voice_channel = await _voice_channel(db, channel_id)
    if voice_channel is not None:
        await _active_install(db, principal, voice_channel.channel_id)
        return miscord_channel(
            voice_channel,
            guild_id=voice_channel.channel_id,
            overwrites=await _channel_overwrites(db, voice_channel.channel_id, channel_id, "voice"),
        )
    raise UNKNOWN_CHANNEL()


@router.patch("/channels/{channel_id}")
async def modify_channel(
    channel_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
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
            raise MiscordAPIError(400, 50035, "Channel name must be 1-100 characters")
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
    response = miscord_channel(
        channel,
        guild_id=channel.channel_id,
        overwrites=await _channel_overwrites(db, channel.channel_id, channel.id, kind),
    )
    await bot_event_dispatcher.dispatch_guild_event(db, channel.channel_id, "CHANNEL_UPDATE", response)
    return response


@router.delete("/channels/{channel_id}")
async def delete_channel(
    channel_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
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
    response = miscord_channel(
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
    principal: BotPrincipal = Depends(get_miscord_bot),
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
            raise MiscordAPIError(404, 10011, "Unknown Role")
    else:
        membership = await db.scalar(select(ChannelMember.id).where(
            ChannelMember.channel_id == guild_id,
            ChannelMember.user_id == overwrite_id,
        ))
        if membership is None:
            raise MiscordAPIError(404, 10007, "Unknown Member")
    try:
        allow = int(payload.get("allow") or 0)
        deny = int(payload.get("deny") or 0)
    except (TypeError, ValueError) as exc:
        raise MiscordAPIError(400, 50035, "allow and deny must be integer strings") from exc
    if allow < 0 or deny < 0 or allow & deny:
        raise MiscordAPIError(400, 50035, "Invalid permission overwrite")
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
    overwrite.legacy_allow = miscord_permissions_to_legacy(allow)
    overwrite.legacy_deny = miscord_permissions_to_legacy(deny)
    await db.commit()
    updated = miscord_channel(
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
    principal: BotPrincipal = Depends(get_miscord_bot),
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
    updated = miscord_channel(
        channel,
        guild_id=guild_id,
        overwrites=await _channel_overwrites(db, guild_id, channel_id, kind.value),
    )
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "CHANNEL_UPDATE", updated)
    return Response(status_code=204)
