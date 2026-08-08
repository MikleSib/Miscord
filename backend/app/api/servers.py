"""Управление сервером Miscord: роли, участники, баны, приглашения и аудит.

Смонтирован на /api/servers. «Сервер» в проекте — это модель Channel.
"""

import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_active_user, get_optional_user
from app.core.media import to_public_media_path
from app.core.permissions import (
    ALL_PERMISSIONS,
    DEFAULT_PERMISSIONS,
    OWNER_POSITION,
    PERMISSION_CATALOG,
    PERMISSION_GROUPS,
    Permission,
    miscord_permissions_to_legacy,
    ensure_default_role,
    get_default_role,
    get_member_permissions,
    get_server,
    get_top_role_position,
    has_permission,
    is_member,
    require_membership,
    require_permission,
    require_hierarchy,
)
from app.db.database import get_db
from app.models import (
    AuditLog,
    Channel,
    ChannelMember,
    Invite,
    MemberRole,
    Role,
    ServerBan,
    TextChannel,
    User,
)
from app.schemas.server import (
    BanCreate,
    ChannelNotificationOverrideUpdate,
    InviteCreate,
    MemberUpdate,
    NotificationSettingsUpdate,
    RoleCreate,
    RoleReorderRequest,
    RoleUpdate,
    TransferOwnershipRequest,
)
from app.services.notification_settings import (
    delete_channel_override,
    get_settings as get_notification_settings,
    upsert_channel_override,
    upsert_settings as upsert_notification_settings,
)
from app.services.audit_service import AuditAction, log_audit
from app.services.bot_event_dispatcher import (
    INTENT_GUILD_INVITES,
    INTENT_GUILD_MEMBERS,
    INTENT_GUILD_MODERATION,
    dispatcher as bot_event_dispatcher,
)
from app.services.miscord_serializers import miscord_role, miscord_user
from app.services.server_events import notify_server, notify_users
from app.services.server_membership import (
    add_member_and_notify,
    remove_member_rows,
    serialize_member_user,
)

router = APIRouter()

INVITE_ALPHABET = string.ascii_letters + string.digits


# --------------------------------------------------------------------------
# Вспомогательные функции
# --------------------------------------------------------------------------

def _serialize_role(role: Role) -> dict:
    return {
        "id": role.id,
        "server_id": role.server_id,
        "name": role.name,
        "color": role.color,
        "position": int(role.position or 0),
        "permissions": int(role.permissions or 0),
        "is_default": bool(role.is_default),
        "created_at": role.created_at.isoformat() if role.created_at else None,
    }


async def _load_member_roles_map(db: AsyncSession, server_id: int) -> dict[int, list[Role]]:
    """Роли всех участников сервера одним запросом."""
    result = await db.execute(
        select(MemberRole.user_id, Role)
        .join(Role, MemberRole.role_id == Role.id)
        .where(MemberRole.server_id == server_id)
        .order_by(Role.position.desc())
    )
    mapping: dict[int, list[Role]] = {}
    for user_id, role in result.all():
        mapping.setdefault(user_id, []).append(role)
    return mapping


async def _miscord_member_update(db: AsyncSession, server_id: int, user_id: int) -> dict:
    user = await _get_user_or_404(db, user_id)
    membership = await db.scalar(select(ChannelMember).where(
        ChannelMember.channel_id == server_id,
        ChannelMember.user_id == user_id,
    ))
    role_ids = (await db.execute(select(MemberRole.role_id).where(
        MemberRole.server_id == server_id,
        MemberRole.user_id == user_id,
    ))).scalars().all()
    return {
        "guild_id": str(server_id),
        "roles": [str(role_id) for role_id in role_ids],
        "user": miscord_user(user),
        "nick": membership.nickname if membership else None,
        "avatar": None,
        "joined_at": membership.joined_at.isoformat() if membership and membership.joined_at else None,
        "deaf": False,
        "mute": False,
        "flags": 0,
        "pending": False,
        "communication_disabled_until": None,
    }


async def _serialize_members(db: AsyncSession, server: Channel) -> list[dict]:
    result = await db.execute(
        select(ChannelMember, User)
        .join(User, ChannelMember.user_id == User.id)
        .where(ChannelMember.channel_id == server.id)
    )
    rows = result.all()

    role_map = await _load_member_roles_map(db, server.id)
    default_role = await get_default_role(db, server.id)
    base_permissions = int(default_role.permissions) if default_role else DEFAULT_PERMISSIONS

    members: list[dict] = []
    for membership, user in rows:
        roles = role_map.get(user.id, [])
        is_owner = user.id == server.owner_id

        if is_owner:
            permissions = ALL_PERMISSIONS
        else:
            permissions = base_permissions
            for role in roles:
                permissions |= int(role.permissions or 0)
            if permissions & int(Permission.ADMINISTRATOR):
                permissions = ALL_PERMISSIONS

        members.append(
            {
                **serialize_member_user(user, nickname=membership.nickname),
                "user_id": user.id,
                "joined_at": membership.joined_at.isoformat() if membership.joined_at else None,
                "is_owner": is_owner,
                "roles": [_serialize_role(role) for role in roles],
                "role_ids": [role.id for role in roles],
                "color": next((role.color for role in roles if role.color), None),
                "top_role_position": OWNER_POSITION if is_owner else max(
                    (int(role.position or 0) for role in roles), default=0
                ),
                "permissions": permissions,
            }
        )

    members.sort(
        key=lambda item: (
            0 if item["is_owner"] else 1,
            -item["top_role_position"],
            (item["display_name"] or item["username"] or "").lower(),
        )
    )
    return members


async def _generate_invite_code(db: AsyncSession, length: int = 8) -> str:
    for _ in range(10):
        code = "".join(secrets.choice(INVITE_ALPHABET) for _ in range(length))
        existing = await db.execute(select(Invite.id).where(Invite.code == code))
        if existing.scalar_one_or_none() is None:
            return code
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Не удалось сгенерировать код приглашения",
    )


def _invite_is_expired(invite: Invite) -> bool:
    if invite.expires_at and invite.expires_at <= datetime.now(timezone.utc):
        return True
    if invite.max_uses and int(invite.uses or 0) >= int(invite.max_uses):
        return True
    return False


async def _invite_allowed_for_server(
    db: AsyncSession,
    server: Channel,
    invite: Invite,
) -> bool:
    """Можно ли войти по этому приглашению на текущих настройках сервера.

    На открытом сервере действуют любые неистёкшие ссылки.
    На закрытом — только ссылки от владельца или участника с правом CREATE_INVITE.
    Так «старые» ссылки, созданные когда сервер был открыт обычным участником,
    перестают работать после закрытия.
    """
    if bool(server.is_public):
        return True

    if invite.inviter_id is None:
        return False
    if invite.inviter_id == server.owner_id:
        return True

    # Приглашающий мог покинуть сервер — тогда ссылка больше недействительна
    if not await is_member(db, server.id, invite.inviter_id):
        return False

    permissions = await get_member_permissions(
        db, server.id, invite.inviter_id, owner_id=server.owner_id
    )
    return has_permission(permissions, Permission.CREATE_INVITE)


async def revoke_server_invites(db: AsyncSession, server_id: int) -> int:
    """Отзывает все приглашения сервера. Возвращает число удалённых ссылок."""
    result = await db.execute(delete(Invite).where(Invite.server_id == server_id))
    return int(result.rowcount or 0)


def _serialize_invite(invite: Invite, *, inviter: Optional[User] = None) -> dict:
    return {
        "id": invite.id,
        "code": invite.code,
        "server_id": invite.server_id,
        "inviter_id": invite.inviter_id,
        "inviter": {
            "id": inviter.id,
            "username": inviter.display_name or inviter.username,
            "avatar_url": inviter.avatar_url,
        } if inviter else None,
        "target_text_channel_id": invite.target_text_channel_id,
        "max_uses": invite.max_uses,
        "uses": int(invite.uses or 0),
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
        "created_at": invite.created_at.isoformat() if invite.created_at else None,
        "is_expired": _invite_is_expired(invite),
    }


def _miscord_invite(invite: Invite, *, inviter: Optional[User] = None) -> dict:
    max_age = 0
    if invite.expires_at and invite.created_at:
        expires_at = invite.expires_at if invite.expires_at.tzinfo else invite.expires_at.replace(tzinfo=timezone.utc)
        created_at = invite.created_at if invite.created_at.tzinfo else invite.created_at.replace(tzinfo=timezone.utc)
        max_age = max(0, int((expires_at - created_at).total_seconds()))
    return {
        "channel_id": str(invite.target_text_channel_id) if invite.target_text_channel_id else None,
        "code": invite.code,
        "created_at": invite.created_at.isoformat() if invite.created_at else None,
        "guild_id": str(invite.server_id),
        "inviter": miscord_user(inviter) if inviter else None,
        "max_age": max_age,
        "max_uses": int(invite.max_uses or 0),
        "target_type": 0,
        "temporary": False,
        "uses": int(invite.uses or 0),
    }


async def _get_user_or_404(db: AsyncSession, user_id: int) -> User:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Пользователь не найден",
        )
    return user


async def _get_role_or_404(db: AsyncSession, server_id: int, role_id: int) -> Role:
    result = await db.execute(
        select(Role).where(Role.id == role_id, Role.server_id == server_id)
    )
    role = result.scalar_one_or_none()
    if not role:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Роль не найдена",
        )
    return role


async def _is_banned(db: AsyncSession, server_id: int, user_id: int) -> bool:
    result = await db.execute(
        select(ServerBan.id).where(
            ServerBan.server_id == server_id, ServerBan.user_id == user_id
        )
    )
    return result.scalar_one_or_none() is not None


# --------------------------------------------------------------------------
# Мета: справочник прав (без привязки к серверу)
# --------------------------------------------------------------------------

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
