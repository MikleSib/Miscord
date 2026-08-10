"""Routes extracted mechanically from miscord_api.py; keep below 600 lines."""

from .miscord_api_shared import *  # noqa: F401,F403

router = APIRouter()

@router.get("/guilds/{guild_id}/roles")
async def get_guild_roles(
    guild_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _active_install(db, principal, guild_id)
    result = await db.execute(select(Role).where(Role.server_id == guild_id).order_by(Role.position))
    return [miscord_role(role, guild_id=guild_id) for role in result.scalars().all()]


def _role_color(value: Any) -> str | None:
    try:
        color = int(value or 0)
    except (TypeError, ValueError) as exc:
        raise MiscordAPIError(400, 50035, "Role color must be an integer") from exc
    if color < 0 or color > 0xFFFFFF:
        raise MiscordAPIError(400, 50035, "Role color is outside the RGB range")
    return f"#{color:06x}" if color else None


def _role_permissions(value: Any) -> int:
    try:
        permissions = int(value or 0)
    except (TypeError, ValueError) as exc:
        raise MiscordAPIError(400, 50035, "permissions must be an integer string") from exc
    if permissions < 0 or permissions & ~ALL_PERMISSIONS:
        raise MiscordAPIError(400, 50035, "Invalid permissions")
    return permissions


@router.post("/guilds/{guild_id}/roles", status_code=200)
async def create_guild_role(
    guild_id: int,
    payload: dict[str, Any] = Body(default={}),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    top_position = await get_top_role_position(db, guild_id, principal.bot_user.id)
    if top_position <= 1:
        raise MISSING_PERMISSIONS()
    name = str(payload.get("name") or "new role").strip()
    if not 1 <= len(name) <= 100:
        raise MiscordAPIError(400, 50035, "Role name must be 1-100 characters")
    permissions = _role_permissions(payload.get("permissions"))
    role = Role(
        server_id=guild_id,
        name=name,
        color=_role_color(payload.get("color")),
        position=max(1, top_position - 1),
        permissions=permissions,
        legacy_permissions=miscord_permissions_to_legacy(permissions),
        is_default=False,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    response = miscord_role(role, guild_id=guild_id)
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "GUILD_ROLE_CREATE", {"guild_id": str(guild_id), "role": response})
    return response


@router.patch("/guilds/{guild_id}/roles/{role_id}")
async def modify_guild_role(
    guild_id: int,
    role_id: int,
    payload: dict[str, Any] = Body(...),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    role = await db.get(Role, role_id)
    if role is None:
        raise MiscordAPIError(404, 10011, "Unknown Role")
    await _role_target_allowed(db, principal, guild_id, role)
    if "name" in payload:
        name = str(payload["name"] or "").strip()
        if not 1 <= len(name) <= 100:
            raise MiscordAPIError(400, 50035, "Role name must be 1-100 characters")
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
        role.legacy_permissions = miscord_permissions_to_legacy(permissions)
    await db.commit()
    response = miscord_role(role, guild_id=guild_id)
    await bot_event_dispatcher.dispatch_guild_event(db, guild_id, "GUILD_ROLE_UPDATE", {"guild_id": str(guild_id), "role": response})
    return response


@router.delete("/guilds/{guild_id}/roles/{role_id}", status_code=204)
async def delete_guild_role(
    guild_id: int,
    role_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    role = await db.get(Role, role_id)
    if role is None:
        raise MiscordAPIError(404, 10011, "Unknown Role")
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
        raise MiscordAPIError(404, 10007, "Unknown Member")
    roles_result = await db.execute(
        select(MemberRole.role_id).where(MemberRole.server_id == guild_id, MemberRole.user_id == user.id)
    )
    return {
        "user": miscord_user(user),
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
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _active_install(db, principal, guild_id)
    return await _guild_member_payload(db, guild_id, principal.bot_user)


@router.get("/guilds/{guild_id}/members/{user_id}")
async def get_guild_member(
    guild_id: int,
    user_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _active_install(db, principal, guild_id)
    user = await db.get(User, user_id)
    if user is None:
        raise MiscordAPIError(404, 10007, "Unknown Member")
    return await _guild_member_payload(db, guild_id, user)


@router.get("/guilds/{guild_id}/members")
async def list_guild_members(
    guild_id: int,
    limit: int = Query(default=1, ge=1, le=1000),
    after: int = Query(default=0, ge=0),
    principal: BotPrincipal = Depends(get_miscord_bot),
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
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    guild, _, _ = await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    membership = await db.scalar(select(ChannelMember.id).where(
        ChannelMember.channel_id == guild_id,
        ChannelMember.user_id == user_id,
    ))
    if membership is None:
        raise MiscordAPIError(404, 10007, "Unknown Member")
    role = await db.get(Role, role_id)
    if role is None:
        raise MiscordAPIError(404, 10011, "Unknown Role")
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
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    guild, _, _ = await _require_guild_permission(db, principal, guild_id, Permission.MANAGE_ROLES)
    membership = await db.scalar(select(ChannelMember.id).where(
        ChannelMember.channel_id == guild_id,
        ChannelMember.user_id == user_id,
    ))
    if membership is None:
        raise MiscordAPIError(404, 10007, "Unknown Member")
    role = await db.get(Role, role_id)
    if role is None:
        raise MiscordAPIError(404, 10011, "Unknown Role")
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
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    guild, _, _ = await _require_guild_permission(db, principal, guild_id, Permission.KICK_MEMBERS)
    await _member_target_allowed(db, principal, guild, user_id)
    membership = await db.scalar(select(ChannelMember.id).where(
        ChannelMember.channel_id == guild_id,
        ChannelMember.user_id == user_id,
    ))
    if membership is None:
        raise MiscordAPIError(404, 10007, "Unknown Member")
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
    return {"reason": ban.reason, "user": miscord_user(ban.user)}


@router.get("/guilds/{guild_id}/bans")
async def get_guild_bans(
    guild_id: int,
    limit: int = Query(default=1000, ge=1, le=1000),
    before: int | None = Query(default=None),
    after: int | None = Query(default=None),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.BAN_MEMBERS)
    if before is not None and after is not None:
        raise MiscordAPIError(400, 50035, "before and after are mutually exclusive")
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
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.BAN_MEMBERS)
    result = await db.execute(select(ServerBan).options(selectinload(ServerBan.user)).where(
        ServerBan.server_id == guild_id,
        ServerBan.user_id == user_id,
    ))
    ban = result.scalar_one_or_none()
    if ban is None:
        raise MiscordAPIError(404, 10026, "Unknown Ban")
    return _ban_payload(ban)


@router.put("/guilds/{guild_id}/bans/{user_id}", status_code=204)
async def create_guild_ban(
    guild_id: int,
    user_id: int,
    payload: dict[str, Any] = Body(default={}),
    audit_reason: str | None = Header(default=None, alias="X-Audit-Log-Reason"),
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    guild, _, _ = await _require_guild_permission(db, principal, guild_id, Permission.BAN_MEMBERS)
    await _member_target_allowed(db, principal, guild, user_id)
    user = await db.get(User, user_id)
    if user is None:
        raise MiscordAPIError(404, 10013, "Unknown User")
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
        {"guild_id": str(guild_id), "user": miscord_user(user)},
        required_intent=1 << 2,
    )
    return Response(status_code=204)


@router.delete("/guilds/{guild_id}/bans/{user_id}", status_code=204)
async def remove_guild_ban(
    guild_id: int,
    user_id: int,
    principal: BotPrincipal = Depends(get_miscord_bot),
    db: AsyncSession = Depends(get_db),
):
    await _require_guild_permission(db, principal, guild_id, Permission.BAN_MEMBERS)
    result = await db.execute(select(ServerBan).options(selectinload(ServerBan.user)).where(
        ServerBan.server_id == guild_id,
        ServerBan.user_id == user_id,
    ))
    ban = result.scalar_one_or_none()
    if ban is None:
        raise MiscordAPIError(404, 10026, "Unknown Ban")
    user_payload = miscord_user(ban.user)
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
