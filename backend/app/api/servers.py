"""Bounded facade plus invite/audit routes kept for stable imports."""

from . import servers_access
from . import servers_members
from . import servers_roles
from .servers_shared import *  # noqa: F401,F403

router = APIRouter()
router.include_router(servers_access.router)
router.include_router(servers_members.router)
router.include_router(servers_roles.router)

@router.get("/{server_id}/invites")
async def list_server_invites(
    server_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    server = await require_membership(db, server_id, current_user)
    permissions = await get_member_permissions(
        db, server_id, current_user.id, owner_id=server.owner_id
    )
    can_manage = has_permission(permissions, Permission.MANAGE_INVITES)
    if not can_manage and not has_permission(permissions, Permission.CREATE_INVITE):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав для просмотра приглашений",
        )

    query = (
        select(Invite)
        .options(selectinload(Invite.inviter))
        .where(Invite.server_id == server_id)
        .order_by(Invite.created_at.desc())
    )
    # Без права управления пользователь видит только свои приглашения
    if not can_manage:
        query = query.where(Invite.inviter_id == current_user.id)

    result = await db.execute(query)
    invites = result.scalars().all()

    return {
        "server_id": server_id,
        "can_manage": can_manage,
        "invites": [_serialize_invite(invite, inviter=invite.inviter) for invite in invites],
    }


@router.post("/{server_id}/invites")
async def create_server_invite(
    server_id: int,
    payload: InviteCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    # На открытом сервере приглашать может любой участник.
    # На закрытом — только с правом CREATE_INVITE (или владелец).
    server = await require_membership(db, server_id, current_user)
    if not bool(server.is_public):
        await require_permission(db, server_id, current_user, Permission.CREATE_INVITE)

    target_channel_id = payload.target_text_channel_id
    if target_channel_id is not None:
        exists = await db.execute(
            select(TextChannel.id).where(
                TextChannel.id == target_channel_id,
                TextChannel.channel_id == server_id,
                TextChannel.is_hidden.is_(False),
            )
        )
        if exists.scalar_one_or_none() is None:
            target_channel_id = None

    expires_at = None
    if payload.max_age_seconds:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=payload.max_age_seconds)

    if not payload.unique:
        reusable_invite = await find_reusable_invite(
            db,
            server_id=server_id,
            inviter_id=current_user.id,
            target_text_channel_id=target_channel_id,
            max_age_seconds=payload.max_age_seconds,
            max_uses=payload.max_uses,
        )
        if reusable_invite is not None:
            return _serialize_invite(reusable_invite, inviter=current_user)

    invite = Invite(
        code=await _generate_invite_code(db),
        server_id=server_id,
        inviter_id=current_user.id,
        target_text_channel_id=target_channel_id,
        max_uses=payload.max_uses or None,
        uses=0,
        expires_at=expires_at,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.INVITE_CREATE,
        target_type="invite",
        target_id=invite.id,
        target_name=invite.code,
        changes={"max_uses": invite.max_uses, "expires_at": invite.expires_at.isoformat() if invite.expires_at else None},
    )

    invite_payload = _serialize_invite(invite, inviter=current_user)
    await notify_server(
        db,
        server_id,
        {"type": "server_invite_created", "data": {"server_id": server_id, "invite": invite_payload}},
        exclude_user_id=current_user.id,
    )
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server_id,
        "INVITE_CREATE",
        _miscord_invite(invite, inviter=current_user),
        required_intent=INTENT_GUILD_INVITES,
    )

    return invite_payload


# --------------------------------------------------------------------------
# Журнал аудита
# --------------------------------------------------------------------------

@router.get("/{server_id}/audit-logs")
async def list_audit_logs(
    server_id: int,
    limit: int = Query(default=50, ge=1, le=100),
    before: Optional[int] = Query(default=None),
    action: Optional[str] = Query(default=None),
    actor_id: Optional[int] = Query(default=None),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await require_permission(db, server_id, current_user, Permission.VIEW_AUDIT_LOG)

    query = (
        select(AuditLog)
        .options(selectinload(AuditLog.actor))
        .where(AuditLog.server_id == server_id)
    )
    if before:
        query = query.where(AuditLog.id < before)
    if action:
        query = query.where(AuditLog.action == action)
    if actor_id:
        query = query.where(AuditLog.actor_id == actor_id)

    query = query.order_by(AuditLog.id.desc()).limit(limit)
    result = await db.execute(query)
    entries = result.scalars().all()

    return {
        "server_id": server_id,
        "entries": [
            {
                "id": entry.id,
                "action": entry.action,
                "target_type": entry.target_type,
                "target_id": entry.target_id,
                "target_name": entry.target_name,
                "changes": entry.changes,
                "reason": entry.reason,
                "created_at": entry.created_at.isoformat() if entry.created_at else None,
                "actor": {
                    "id": entry.actor.id,
                    "username": entry.actor.display_name or entry.actor.username,
                    "avatar_url": entry.actor.avatar_url,
                } if entry.actor else None,
            }
            for entry in entries
        ],
        "has_more": len(entries) == limit,
    }
