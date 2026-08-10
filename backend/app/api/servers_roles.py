"""Bounded route group extracted from servers.py."""

from .servers_shared import *  # noqa: F401,F403

router = APIRouter()

@router.get("/{server_id}/roles")
async def list_server_roles(
    server_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await require_membership(db, server_id, current_user)
    await ensure_default_role(db, server_id)

    result = await db.execute(
        select(Role).where(Role.server_id == server_id).order_by(Role.position.desc())
    )
    roles = result.scalars().all()

    counts_result = await db.execute(
        select(MemberRole.role_id, func.count(MemberRole.id))
        .where(MemberRole.server_id == server_id)
        .group_by(MemberRole.role_id)
    )
    counts = {role_id: count for role_id, count in counts_result.all()}

    total_members_result = await db.execute(
        select(func.count(ChannelMember.id)).where(ChannelMember.channel_id == server_id)
    )
    total_members = total_members_result.scalar() or 0

    return {
        "server_id": server_id,
        "roles": [
            {
                **_serialize_role(role),
                "members_count": total_members if role.is_default else counts.get(role.id, 0),
            }
            for role in roles
        ],
    }


@router.post("/{server_id}/roles")
async def create_server_role(
    server_id: int,
    payload: RoleCreate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    server = await get_server(db, server_id)
    actor_permissions = await require_permission(
        db, server_id, current_user, Permission.MANAGE_ROLES
    )
    await ensure_default_role(db, server_id)

    # Нельзя выдать роли права, которых нет у вас самих
    granted = int(payload.permissions) & ~actor_permissions
    if granted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нельзя выдать роли права, которых у вас нет",
        )

    max_position_result = await db.execute(
        select(func.max(Role.position)).where(Role.server_id == server_id)
    )
    next_position = int(max_position_result.scalar() or 0) + 1

    actor_position = await get_top_role_position(
        db, server_id, current_user.id, owner_id=server.owner_id
    )
    if current_user.id != server.owner_id and next_position >= actor_position:
        next_position = max(1, actor_position - 1)

    role = Role(
        server_id=server_id,
        name=payload.name.strip(),
        color=payload.color,
        position=next_position,
        permissions=int(payload.permissions),
        legacy_permissions=miscord_permissions_to_legacy(int(payload.permissions)),
        is_default=False,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.ROLE_CREATE,
        target_type="role",
        target_id=role.id,
        target_name=role.name,
        changes={"permissions": int(role.permissions), "color": role.color},
    )

    payload_role = {**_serialize_role(role), "members_count": 0}
    await notify_server(
        db,
        server_id,
        {"type": "server_role_created", "data": {"server_id": server_id, "role": payload_role}},
    )
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server_id,
        "GUILD_ROLE_CREATE",
        {"guild_id": str(server_id), "role": miscord_role(role, guild_id=server_id)},
    )

    return payload_role


@router.patch("/{server_id}/roles/reorder")
async def reorder_server_roles(
    server_id: int,
    payload: RoleReorderRequest,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    """Порядок ролей сверху вниз. Роль @everyone всегда остаётся внизу."""
    await require_permission(db, server_id, current_user, Permission.MANAGE_ROLES)

    result = await db.execute(
        select(Role).where(Role.server_id == server_id, Role.is_default == False)  # noqa: E712
    )
    roles = {role.id: role for role in result.scalars().all()}

    ordered_ids = [role_id for role_id in payload.role_ids if role_id in roles]
    if len(ordered_ids) != len(roles):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Список должен содержать все роли сервера, кроме @everyone",
        )

    # Первый элемент — самая высокая роль
    total = len(ordered_ids)
    for index, role_id in enumerate(ordered_ids):
        roles[role_id].position = total - index

    await db.commit()

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.ROLE_REORDER,
        target_type="server",
        target_id=server_id,
        changes={"order": ordered_ids},
    )

    await notify_server(
        db,
        server_id,
        {"type": "server_roles_reordered", "data": {"server_id": server_id, "order": ordered_ids}},
    )
    for updated_role in roles.values():
        await bot_event_dispatcher.dispatch_guild_event(
            db,
            server_id,
            "GUILD_ROLE_UPDATE",
            {"guild_id": str(server_id), "role": miscord_role(updated_role, guild_id=server_id)},
        )

    return {"detail": "Порядок ролей обновлён", "order": ordered_ids}


@router.patch("/{server_id}/roles/{role_id}")
async def update_server_role(
    server_id: int,
    role_id: int,
    payload: RoleUpdate,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    server = await get_server(db, server_id)
    actor_permissions = await require_permission(
        db, server_id, current_user, Permission.MANAGE_ROLES
    )
    role = await _get_role_or_404(db, server_id, role_id)
    if role.managed_by_bot_application_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Managed bot roles cannot be edited manually",
        )

    if current_user.id != server.owner_id:
        actor_position = await get_top_role_position(
            db, server_id, current_user.id, owner_id=server.owner_id
        )
        if int(role.position or 0) >= actor_position:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Нельзя изменять роль, которая не ниже вашей",
            )

    updates = payload.model_dump(exclude_unset=True)

    if "permissions" in updates and updates["permissions"] is not None:
        new_permissions = int(updates["permissions"])
        added = new_permissions & ~int(role.permissions or 0)
        if added & ~actor_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Нельзя выдать роли права, которых у вас нет",
            )
        role.permissions = new_permissions
        role.legacy_permissions = miscord_permissions_to_legacy(new_permissions)

    if "name" in updates and updates["name"]:
        if role.is_default:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Роль @everyone нельзя переименовать",
            )
        role.name = updates["name"].strip()

    if "color" in updates:
        if role.is_default and updates["color"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="У роли @everyone не может быть цвета",
            )
        role.color = updates["color"]

    await db.commit()
    await db.refresh(role)

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.ROLE_UPDATE,
        target_type="role",
        target_id=role.id,
        target_name=role.name,
        changes=updates,
    )

    role_payload = _serialize_role(role)
    await notify_server(
        db,
        server_id,
        {"type": "server_role_updated", "data": {"server_id": server_id, "role": role_payload}},
    )
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server_id,
        "GUILD_ROLE_UPDATE",
        {"guild_id": str(server_id), "role": miscord_role(role, guild_id=server_id)},
    )

    return role_payload


@router.delete("/{server_id}/roles/{role_id}")
async def delete_server_role(
    server_id: int,
    role_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    server = await get_server(db, server_id)
    await require_permission(db, server_id, current_user, Permission.MANAGE_ROLES)
    role = await _get_role_or_404(db, server_id, role_id)
    if role.managed_by_bot_application_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Remove the bot integration to delete its managed role",
        )

    if role.is_default:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Роль @everyone нельзя удалить",
        )

    if current_user.id != server.owner_id:
        actor_position = await get_top_role_position(
            db, server_id, current_user.id, owner_id=server.owner_id
        )
        if int(role.position or 0) >= actor_position:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Нельзя удалить роль, которая не ниже вашей",
            )

    role_name = role.name
    await db.execute(delete(MemberRole).where(MemberRole.role_id == role_id))
    await db.execute(delete(Role).where(Role.id == role_id))
    await db.commit()

    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.ROLE_DELETE,
        target_type="role",
        target_id=role_id,
        target_name=role_name,
    )

    await notify_server(
        db,
        server_id,
        {"type": "server_role_deleted", "data": {"server_id": server_id, "role_id": role_id}},
    )
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server_id,
        "GUILD_ROLE_DELETE",
        {"guild_id": str(server_id), "role_id": str(role_id)},
    )

    return {"detail": "Роль удалена", "role_id": role_id}


# --------------------------------------------------------------------------
# Роли участников
# --------------------------------------------------------------------------

async def _assert_can_assign_role(
    db: AsyncSession,
    server: Channel,
    actor: User,
    role: Role,
) -> None:
    if role.managed_by_bot_application_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Managed bot roles cannot be assigned manually",
        )
    if role.is_default:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Роль @everyone есть у всех участников по умолчанию",
        )
    if actor.id == server.owner_id:
        return

    actor_position = await get_top_role_position(
        db, server.id, actor.id, owner_id=server.owner_id
    )
    if int(role.position or 0) >= actor_position:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нельзя выдавать роль, которая не ниже вашей",
        )


@router.put("/{server_id}/members/{user_id}/roles/{role_id}")
async def add_member_role(
    server_id: int,
    user_id: int,
    role_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    server = await get_server(db, server_id)
    await require_permission(db, server_id, current_user, Permission.MANAGE_ROLES)
    role = await _get_role_or_404(db, server_id, role_id)
    await _assert_can_assign_role(db, server, current_user, role)
    await require_hierarchy(
        db,
        server_id,
        current_user,
        user_id,
        owner_id=server.owner_id,
    )

    if not await is_member(db, server_id, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Участник не найден на этом сервере",
        )

    existing = await db.execute(
        select(MemberRole).where(
            MemberRole.role_id == role_id, MemberRole.user_id == user_id
        )
    )
    if existing.scalar_one_or_none() is None:
        db.add(MemberRole(server_id=server_id, role_id=role_id, user_id=user_id))
        await db.commit()

    target = await _get_user_or_404(db, user_id)
    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.MEMBER_ROLE_ADD,
        target_type="member",
        target_id=user_id,
        target_name=target.display_name or target.username,
        changes={"role_id": role_id, "role_name": role.name},
    )

    return await _member_roles_response(db, server_id, user_id)


@router.delete("/{server_id}/members/{user_id}/roles/{role_id}")
async def remove_member_role(
    server_id: int,
    user_id: int,
    role_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    server = await get_server(db, server_id)
    await require_permission(db, server_id, current_user, Permission.MANAGE_ROLES)
    role = await _get_role_or_404(db, server_id, role_id)
    await _assert_can_assign_role(db, server, current_user, role)
    await require_hierarchy(
        db,
        server_id,
        current_user,
        user_id,
        owner_id=server.owner_id,
    )

    await db.execute(
        delete(MemberRole).where(
            and_(MemberRole.role_id == role_id, MemberRole.user_id == user_id)
        )
    )
    await db.commit()

    target = await _get_user_or_404(db, user_id)
    await log_audit(
        db,
        server_id,
        current_user,
        AuditAction.MEMBER_ROLE_REMOVE,
        target_type="member",
        target_id=user_id,
        target_name=target.display_name or target.username,
        changes={"role_id": role_id, "role_name": role.name},
    )

    return await _member_roles_response(db, server_id, user_id)


async def _member_roles_response(db: AsyncSession, server_id: int, user_id: int) -> dict:
    role_map = await _load_member_roles_map(db, server_id)
    roles = role_map.get(user_id, [])
    payload = {
        "server_id": server_id,
        "user_id": user_id,
        "roles": [_serialize_role(role) for role in roles],
        "role_ids": [role.id for role in roles],
        "color": next((role.color for role in roles if role.color), None),
    }

    await notify_server(db, server_id, {"type": "server_member_roles_updated", "data": payload})
    await bot_event_dispatcher.dispatch_guild_event(
        db,
        server_id,
        "GUILD_MEMBER_UPDATE",
        await _miscord_member_update(db, server_id, user_id),
        required_intent=INTENT_GUILD_MEMBERS,
    )
    return payload


# --------------------------------------------------------------------------
# Приглашения сервера
# --------------------------------------------------------------------------
