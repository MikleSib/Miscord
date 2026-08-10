"""Bounded route group extracted from servers.py."""

from .servers_shared import *  # noqa: F401,F403

router = APIRouter()

@router.get("/{server_id}/members")
async def list_server_members(
    server_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Подробный список участников: роли, никнеймы, дата вступления."""
    server = await require_membership(db, server_id, current_user)
    await ensure_default_role(db, server_id)
    return {
        "server_id": server_id,
        "owner_id": server.owner_id,
        "members": await _serialize_members(db, server),
    }


@router.patch("/{server_id}/members/{user_id}")
async def update_server_member(
    server_id: int,
    user_id: int,
    payload: MemberUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Изменить серверный никнейм участника."""
    server = await require_membership(db, server_id, current_user)

    if user_id != current_user.id:
        await require_permission(db, server_id, current_user, Permission.MANAGE_NICKNAMES)
        await require_hierarchy(db, server_id, current_user, user_id, owner_id=server.owner_id)

    result = await db.execute(
        select(ChannelMember).where(
            and_(ChannelMember.channel_id == server_id, ChannelMember.user_id == user_id)
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Участник не найден на этом сервере",
        )

    updates = payload.model_dump(exclude_unset=True)
    if "nickname" in updates:
        nickname = updates["nickname"]
        membership.nickname = nickname.strip() if isinstance(nickname, str) and nickname.strip() else None

    await db.commit()
    await db.refresh(membership)

    target = await _get_user_or_404(db, user_id)

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.MEMBER_NICKNAME_UPDATE,
        target_type="member",
        target_id=user_id,
        target_name=target.display_name or target.username,
        changes={"nickname": membership.nickname},
    )

    await notify_server(
        db,
        server_id,
        {
            "type": "server_member_updated",
            "data": {
                "server_id": server_id,
                "user_id": user_id,
                "nickname": membership.nickname,
            },
        },
    )
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server_id,
        "GUILD_MEMBER_UPDATE",
        await _miscord_member_update(db, server_id, user_id),
        required_intent=INTENT_GUILD_MEMBERS,
    )

    return {
        "server_id": server_id,
        "user_id": user_id,
        "nickname": membership.nickname,
    }


@router.delete("/{server_id}/members/{user_id}")
async def kick_server_member(
    server_id: int,
    user_id: int,
    reason: Optional[str] = Query(default=None, max_length=512),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Исключить участника с сервера."""
    server = await get_server(db, server_id)
    await require_permission(db, server_id, current_user, Permission.KICK_MEMBERS)

    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Чтобы уйти самому, используйте «Покинуть сервер»",
        )

    await require_hierarchy(db, server_id, current_user, user_id, owner_id=server.owner_id)

    if not await is_member(db, server_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Участник не найден на этом сервере",
        )

    target = await _get_user_or_404(db, user_id)
    await remove_member_rows(db, server_id, user_id)

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.MEMBER_KICK,
        target_type="member",
        target_id=user_id,
        target_name=target.display_name or target.username,
        reason=reason,
    )

    await notify_users(
        [user_id],
        {
            "type": "server_removed",
            "data": {
                "server_id": server_id,
                "server_name": server.name,
                "kind": "kick",
                "reason": reason,
                "by": current_user.display_name or current_user.username,
            },
        },
    )
    await notify_server(
        db,
        server_id,
        {"type": "user_left_channel", "channel_id": server_id, "user_id": user_id},
    )

    return {"detail": "Участник исключён", "user_id": user_id}


@router.post("/{server_id}/transfer-ownership")
async def transfer_server_ownership(
    server_id: int,
    payload: TransferOwnershipRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Передать владение сервером другому участнику (только владелец)."""
    server = await get_server(db, server_id)
    if server.owner_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Передать владение может только текущий владелец",
        )

    if payload.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Вы уже владелец этого сервера",
        )

    if not await is_member(db, server_id, payload.user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Новый владелец должен быть участником сервера",
        )

    new_owner = await _get_user_or_404(db, payload.user_id)
    server.owner_id = new_owner.id
    await db.commit()

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.OWNERSHIP_TRANSFER,
        target_type="member",
        target_id=new_owner.id,
        target_name=new_owner.display_name or new_owner.username,
        changes={"old_owner_id": current_user.id, "new_owner_id": new_owner.id},
    )

    await notify_server(
        db,
        server_id,
        {
            "type": "server_ownership_transferred",
            "data": {
                "server_id": server_id,
                "old_owner_id": current_user.id,
                "new_owner_id": new_owner.id,
                "new_owner_name": new_owner.display_name or new_owner.username,
            },
        },
    )

    return {"detail": "Владение передано", "owner_id": new_owner.id}


# --------------------------------------------------------------------------
# Баны
# --------------------------------------------------------------------------

@router.get("/{server_id}/bans")
async def list_server_bans(
    server_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await require_permission(db, server_id, current_user, Permission.BAN_MEMBERS)

    result = await db.execute(
        select(ServerBan)
        .options(selectinload(ServerBan.user), selectinload(ServerBan.moderator))
        .where(ServerBan.server_id == server_id)
        .order_by(ServerBan.created_at.desc())
    )
    bans = result.scalars().all()

    return {
        "server_id": server_id,
        "bans": [
            {
                "id": ban.id,
                "user_id": ban.user_id,
                "reason": ban.reason,
                "created_at": ban.created_at.isoformat() if ban.created_at else None,
                "user": {
                    "id": ban.user.id,
                    "username": ban.user.display_name or ban.user.username,
                    "display_name": ban.user.display_name,
                    "avatar_url": ban.user.avatar_url,
                } if ban.user else None,
                "moderator": {
                    "id": ban.moderator.id,
                    "username": ban.moderator.display_name or ban.moderator.username,
                } if ban.moderator else None,
            }
            for ban in bans
        ],
    }


@router.post("/{server_id}/bans")
async def create_server_ban(
    server_id: int,
    payload: BanCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Заблокировать пользователя: исключает с сервера и запрещает вход."""
    server = await get_server(db, server_id)
    await require_permission(db, server_id, current_user, Permission.BAN_MEMBERS)

    if payload.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Нельзя заблокировать самого себя",
        )

    await require_hierarchy(
        db, server_id, current_user, payload.user_id, owner_id=server.owner_id
    )

    target = await _get_user_or_404(db, payload.user_id)

    if await _is_banned(db, server_id, payload.user_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пользователь уже заблокирован",
        )

    was_member = await is_member(db, server_id, payload.user_id)
    if was_member:
        await remove_member_rows(db, server_id, payload.user_id)

    db.add(
        ServerBan(
            server_id=server_id,
            user_id=payload.user_id,
            moderator_id=current_user.id,
            reason=payload.reason,
        )
    )
    await db.commit()

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.MEMBER_BAN,
        target_type="member",
        target_id=target.id,
        target_name=target.display_name or target.username,
        reason=payload.reason,
    )

    await notify_users(
        [target.id],
        {
            "type": "server_removed",
            "data": {
                "server_id": server_id,
                "server_name": server.name,
                "kind": "ban",
                "reason": payload.reason,
                "by": current_user.display_name or current_user.username,
            },
        },
    )
    if was_member:
        await notify_server(
            db,
            server_id,
            {"type": "user_left_channel", "channel_id": server_id, "user_id": target.id},
        )
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server_id,
        "GUILD_BAN_ADD",
        {"guild_id": str(server_id), "user": miscord_user(target)},
        required_intent=INTENT_GUILD_MODERATION,
    )

    return {"detail": "Пользователь заблокирован", "user_id": target.id}


@router.delete("/{server_id}/bans/{user_id}")
async def delete_server_ban(
    server_id: int,
    user_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await require_permission(db, server_id, current_user, Permission.BAN_MEMBERS)

    result = await db.execute(
        select(ServerBan).where(
            ServerBan.server_id == server_id, ServerBan.user_id == user_id
        )
    )
    ban = result.scalar_one_or_none()
    if not ban:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Блокировка не найдена",
        )

    target = await _get_user_or_404(db, user_id)
    await db.execute(delete(ServerBan).where(ServerBan.id == ban.id))
    await db.commit()

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.MEMBER_UNBAN,
        target_type="member",
        target_id=user_id,
        target_name=target.display_name or target.username,
    )
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server_id,
        "GUILD_BAN_REMOVE",
        {"guild_id": str(server_id), "user": miscord_user(target)},
        required_intent=INTENT_GUILD_MODERATION,
    )

    return {"detail": "Блокировка снята", "user_id": user_id}


# --------------------------------------------------------------------------
# Роли
# --------------------------------------------------------------------------
