"""Bounded route group extracted from servers.py."""

from .servers_shared import *  # noqa: F401,F403

router = APIRouter()

@router.get("/permissions/catalog")
async def get_permissions_catalog():
    """Справочник прав для интерфейса настроек ролей."""
    return {
        "permissions": PERMISSION_CATALOG,
        "groups": PERMISSION_GROUPS,
        "all": ALL_PERMISSIONS,
        "default": DEFAULT_PERMISSIONS,
    }


# --------------------------------------------------------------------------
# Приглашения по коду (глобальные маршруты — объявлены до /{server_id}/...)
# --------------------------------------------------------------------------

@router.get("/invites/{code}")
async def get_invite_preview(
    code: str,
    current_user: Optional[User] = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    """Превью приглашения. Доступно и без авторизации."""
    result = await db.execute(
        select(Invite).options(selectinload(Invite.inviter)).where(Invite.code == code)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Приглашение не найдено или отозвано",
        )

    server_result = await db.execute(select(Channel).where(Channel.id == invite.server_id))
    server = server_result.scalar_one_or_none()
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сервер больше не существует",
        )

    if _invite_is_expired(invite):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Срок действия приглашения истёк",
        )

    if not await _invite_allowed_for_server(db, server, invite):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Сервер закрыт. Это приглашение больше не действует",
        )

    members_count = await db.execute(
        select(func.count(ChannelMember.id)).where(ChannelMember.channel_id == server.id)
    )
    online_count = await db.execute(
        select(func.count(ChannelMember.id))
        .join(User, ChannelMember.user_id == User.id)
        .where(ChannelMember.channel_id == server.id, User.is_online == True)  # noqa: E712
    )

    return {
        "code": invite.code,
        "server_id": server.id,
        "server_name": server.name,
        "server_icon": to_public_media_path(server.icon),
        "server_description": server.description,
        "members_count": members_count.scalar() or 0,
        "online_count": online_count.scalar() or 0,
        "inviter_name": (
            invite.inviter.display_name or invite.inviter.username
        ) if invite.inviter else None,
        "is_expired": False,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        "is_member": bool(
            current_user and await is_member(db, server.id, current_user.id)
        ),
        "is_banned": bool(
            current_user and await _is_banned(db, server.id, current_user.id)
        ),
    }


@router.post("/invites/{code}/accept")
async def accept_invite(
    code: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Присоединиться к серверу по коду приглашения."""
    result = await db.execute(
        select(Invite).options(selectinload(Invite.inviter)).where(Invite.code == code)
    )
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Приглашение не найдено или отозвано",
        )

    if _invite_is_expired(invite):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Срок действия приглашения истёк",
        )

    server = await get_server(db, invite.server_id)

    if not await _invite_allowed_for_server(db, server, invite):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Сервер закрыт. Это приглашение больше не действует",
        )

    if await _is_banned(db, server.id, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Вы заблокированы на этом сервере",
        )

    already_member = await is_member(db, server.id, current_user.id)
    if already_member:
        return {"detail": "Вы уже участник сервера", "server_id": server.id, "already_member": True}

    invited_by_name = (
        (invite.inviter.display_name or invite.inviter.username)
        if invite.inviter
        else None
    )

    # Блокируем строку инвайта — чтобы не превысить max_uses при гонке
    locked = await db.execute(
        select(Invite).where(Invite.id == invite.id).with_for_update()
    )
    invite = locked.scalar_one()
    if invite.max_uses is not None and int(invite.uses or 0) >= int(invite.max_uses):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Приглашение больше недоступно",
        )

    await add_member_and_notify(
        db,
        server.id,
        current_user,
        invited_by=invited_by_name,
    )

    invite.uses = int(invite.uses or 0) + 1
    await db.commit()

    await log_audit(
        db,
        server.id,
        current_user,
        AuditAction.MEMBER_JOIN,
        target_type="member",
        target_id=current_user.id,
        target_name=current_user.display_name or current_user.username,
        changes={"invite_code": invite.code},
    )

    return {"detail": "Вы присоединились к серверу", "server_id": server.id, "already_member": False}


@router.delete("/invites/{code}")
async def delete_invite(
    code: str,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Отозвать приглашение: автор — своё, либо право «Управлять приглашениями»."""
    result = await db.execute(select(Invite).where(Invite.code == code))
    invite = result.scalar_one_or_none()
    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Приглашение не найдено",
        )

    server = await require_membership(db, invite.server_id, current_user)
    permissions = await get_member_permissions(
        db, server.id, current_user.id, owner_id=server.owner_id
    )
    is_author = invite.inviter_id == current_user.id
    if not is_author and not has_permission(permissions, Permission.MANAGE_INVITES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав, чтобы отозвать это приглашение",
        )

    event_inviter = (
        current_user
        if invite.inviter_id == current_user.id
        else (await db.get(User, invite.inviter_id) if invite.inviter_id is not None else None)
    )
    await db.execute(delete(Invite).where(Invite.id == invite.id))
    await db.commit()

    await log_audit(
        db,
        server.id,
        current_user,
        AuditAction.INVITE_DELETE,
        target_type="invite",
        target_id=invite.id,
        target_name=invite.code,
    )

    await notify_server(
        db,
        server.id,
        {"type": "server_invite_deleted", "data": {"server_id": server.id, "code": invite.code}},
    )
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server.id,
        "INVITE_DELETE",
        _miscord_invite(invite, inviter=event_inviter),
        required_intent=INTENT_GUILD_INVITES,
    )

    return {"detail": "Приглашение отозвано", "code": invite.code}


# --------------------------------------------------------------------------
# Мои права на сервере
# --------------------------------------------------------------------------

@router.get("/{server_id}/me")
async def get_my_server_membership(
    server_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Права текущего пользователя на сервере — источник истины для интерфейса."""
    server = await require_membership(db, server_id, current_user)
    permissions = await get_member_permissions(
        db, server_id, current_user.id, owner_id=server.owner_id
    )
    top_position = await get_top_role_position(
        db, server_id, current_user.id, owner_id=server.owner_id
    )
    roles = await _load_member_roles_map(db, server_id)

    return {
        "server_id": server_id,
        "user_id": current_user.id,
        "is_owner": current_user.id == server.owner_id,
        "permissions": permissions,
        "top_role_position": top_position,
        "roles": [_serialize_role(role) for role in roles.get(current_user.id, [])],
    }


# --------------------------------------------------------------------------
# Уведомления (персональные, на каждого пользователя)
# --------------------------------------------------------------------------

@router.get("/{server_id}/me/notifications")
async def get_my_notification_settings(
    server_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await require_membership(db, server_id, current_user)
    settings = await get_notification_settings(db, server_id, current_user.id)
    return {"server_id": server_id, **settings}


@router.patch("/{server_id}/me/notifications")
async def update_my_notification_settings(
    server_id: int,
    payload: NotificationSettingsUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await require_membership(db, server_id, current_user)
    try:
        settings = await upsert_notification_settings(
            db,
            server_id,
            current_user.id,
            payload.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"server_id": server_id, **settings}


@router.put("/{server_id}/me/notifications/channels/{text_channel_id}")
async def upsert_my_channel_notification_override(
    server_id: int,
    text_channel_id: int,
    payload: ChannelNotificationOverrideUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await require_membership(db, server_id, current_user)

    channel_exists = await db.execute(
        select(TextChannel.id).where(
            TextChannel.id == text_channel_id,
            TextChannel.channel_id == server_id,
            TextChannel.is_hidden.is_(False),
        )
    )
    if channel_exists.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Канал не найден на этом сервере",
        )

    try:
        settings = await upsert_channel_override(
            db,
            server_id,
            current_user.id,
            text_channel_id,
            payload.level,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"server_id": server_id, **settings}


@router.delete("/{server_id}/me/notifications/channels/{text_channel_id}")
async def delete_my_channel_notification_override(
    server_id: int,
    text_channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await require_membership(db, server_id, current_user)
    settings = await delete_channel_override(
        db, server_id, current_user.id, text_channel_id
    )
    return {"server_id": server_id, **settings}


# --------------------------------------------------------------------------
# Участники
# --------------------------------------------------------------------------
