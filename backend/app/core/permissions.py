"""Права сервера в виде битовой маски (по образцу Discord).

Единая точка проверки прав. До появления этого модуля единственной проверкой
во всём проекте было сравнение `channel.owner_id == current_user.id`.
"""

from enum import IntFlag
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Channel, ChannelMember, MemberRole, Role, User

# Позиция роли владельца — выше любой реальной роли
OWNER_POSITION = 1 << 30


class Permission(IntFlag):
    VIEW_CHANNELS = 1 << 0
    SEND_MESSAGES = 1 << 1
    MANAGE_MESSAGES = 1 << 2
    MANAGE_CHANNELS = 1 << 3
    MANAGE_SERVER = 1 << 4
    MANAGE_ROLES = 1 << 5
    KICK_MEMBERS = 1 << 6
    BAN_MEMBERS = 1 << 7
    CREATE_INVITE = 1 << 8
    MANAGE_INVITES = 1 << 9
    VIEW_AUDIT_LOG = 1 << 10
    MANAGE_NICKNAMES = 1 << 11
    MUTE_MEMBERS = 1 << 12
    DEAFEN_MEMBERS = 1 << 13
    MOVE_MEMBERS = 1 << 14
    ADMINISTRATOR = 1 << 15


ALL_PERMISSIONS = 0
for _perm in Permission:
    ALL_PERMISSIONS |= int(_perm)

# Права роли @everyone по умолчанию
DEFAULT_PERMISSIONS = int(
    Permission.VIEW_CHANNELS
    | Permission.SEND_MESSAGES
    | Permission.CREATE_INVITE
)

# Метаданные для фронтенда: ключ, подпись, описание, группа
PERMISSION_CATALOG = [
    {
        "key": "ADMINISTRATOR",
        "value": int(Permission.ADMINISTRATOR),
        "label": "Администратор",
        "description": "Полный доступ ко всем возможностям сервера. Выдавайте осторожно.",
        "group": "general",
    },
    {
        "key": "MANAGE_SERVER",
        "value": int(Permission.MANAGE_SERVER),
        "label": "Управлять сервером",
        "description": "Изменять название, описание, иконку и баннер сервера.",
        "group": "general",
    },
    {
        "key": "MANAGE_ROLES",
        "value": int(Permission.MANAGE_ROLES),
        "label": "Управлять ролями",
        "description": "Создавать и изменять роли ниже своей, выдавать их участникам.",
        "group": "general",
    },
    {
        "key": "MANAGE_CHANNELS",
        "value": int(Permission.MANAGE_CHANNELS),
        "label": "Управлять каналами",
        "description": "Создавать, переименовывать и удалять каналы.",
        "group": "general",
    },
    {
        "key": "VIEW_AUDIT_LOG",
        "value": int(Permission.VIEW_AUDIT_LOG),
        "label": "Просмотр журнала аудита",
        "description": "Видеть историю действий на сервере.",
        "group": "general",
    },
    {
        "key": "VIEW_CHANNELS",
        "value": int(Permission.VIEW_CHANNELS),
        "label": "Просмотр каналов",
        "description": "Видеть каналы сервера.",
        "group": "text",
    },
    {
        "key": "SEND_MESSAGES",
        "value": int(Permission.SEND_MESSAGES),
        "label": "Отправлять сообщения",
        "description": "Писать в текстовые каналы сервера.",
        "group": "text",
    },
    {
        "key": "MANAGE_MESSAGES",
        "value": int(Permission.MANAGE_MESSAGES),
        "label": "Управлять сообщениями",
        "description": "Удалять сообщения других участников.",
        "group": "text",
    },
    {
        "key": "CREATE_INVITE",
        "value": int(Permission.CREATE_INVITE),
        "label": "Создавать приглашения",
        "description": "Создавать ссылки-приглашения на сервер.",
        "group": "members",
    },
    {
        "key": "MANAGE_INVITES",
        "value": int(Permission.MANAGE_INVITES),
        "label": "Управлять приглашениями",
        "description": "Видеть и отзывать любые приглашения сервера.",
        "group": "members",
    },
    {
        "key": "MANAGE_NICKNAMES",
        "value": int(Permission.MANAGE_NICKNAMES),
        "label": "Управлять никнеймами",
        "description": "Изменять серверные никнеймы других участников.",
        "group": "members",
    },
    {
        "key": "KICK_MEMBERS",
        "value": int(Permission.KICK_MEMBERS),
        "label": "Исключать участников",
        "description": "Удалять участников с сервера. Они смогут вернуться по приглашению.",
        "group": "moderation",
    },
    {
        "key": "BAN_MEMBERS",
        "value": int(Permission.BAN_MEMBERS),
        "label": "Блокировать участников",
        "description": "Навсегда блокировать участникам доступ к серверу.",
        "group": "moderation",
    },
    {
        "key": "MUTE_MEMBERS",
        "value": int(Permission.MUTE_MEMBERS),
        "label": "Отключать микрофон",
        "description": "Заглушать участников в голосовых каналах.",
        "group": "voice",
    },
    {
        "key": "DEAFEN_MEMBERS",
        "value": int(Permission.DEAFEN_MEMBERS),
        "label": "Отключать звук",
        "description": "Отключать участникам звук в голосовых каналах.",
        "group": "voice",
    },
    {
        "key": "MOVE_MEMBERS",
        "value": int(Permission.MOVE_MEMBERS),
        "label": "Перемещать участников",
        "description": "Перемещать участников между голосовыми каналами и отключать их.",
        "group": "voice",
    },
]

PERMISSION_GROUPS = [
    {"key": "general", "label": "Основные права сервера"},
    {"key": "members", "label": "Участники"},
    {"key": "text", "label": "Текстовые каналы"},
    {"key": "voice", "label": "Голосовые каналы"},
    {"key": "moderation", "label": "Модерация"},
]


async def get_server(db: AsyncSession, server_id: int) -> Channel:
    result = await db.execute(select(Channel).where(Channel.id == server_id))
    server = result.scalar_one_or_none()
    if not server:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Сервер не найден",
        )
    return server


async def is_member(db: AsyncSession, server_id: int, user_id: int) -> bool:
    result = await db.execute(
        select(ChannelMember.id).where(
            ChannelMember.channel_id == server_id,
            ChannelMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none() is not None


async def get_member_roles(db: AsyncSession, server_id: int, user_id: int) -> list[Role]:
    result = await db.execute(
        select(Role)
        .join(MemberRole, MemberRole.role_id == Role.id)
        .where(MemberRole.server_id == server_id, MemberRole.user_id == user_id)
        .order_by(Role.position.desc())
    )
    return list(result.scalars().all())


async def get_default_role(db: AsyncSession, server_id: int) -> Optional[Role]:
    """Роль @everyone сервера. Если их несколько (старый баг) — берём самую раннюю."""
    result = await db.execute(
        select(Role)
        .where(Role.server_id == server_id, Role.is_default == True)  # noqa: E712
        .order_by(Role.id.asc())
    )
    return result.scalars().first()


async def _dedupe_default_roles(db: AsyncSession, server_id: int) -> Optional[Role]:
    """Оставляет одну роль @everyone, удаляет лишние дубликаты."""
    result = await db.execute(
        select(Role)
        .where(Role.server_id == server_id, Role.is_default == True)  # noqa: E712
        .order_by(Role.id.asc())
    )
    roles = list(result.scalars().all())
    if not roles:
        return None

    keeper = roles[0]
    duplicate_ids = [role.id for role in roles[1:]]
    if duplicate_ids:
        await db.execute(delete(Role).where(Role.id.in_(duplicate_ids)))
        await db.commit()

    return keeper


async def ensure_default_role(db: AsyncSession, server_id: int) -> Role:
    """Возвращает роль @everyone сервера, создавая её при необходимости.

    Нужно для серверов, созданных до появления системы ролей.
    """
    existing = await _dedupe_default_roles(db, server_id)
    if existing:
        return existing

    role = Role(
        server_id=server_id,
        name="@everyone",
        color=None,
        position=0,
        permissions=DEFAULT_PERMISSIONS,
        is_default=True,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return role


async def get_member_permissions(
    db: AsyncSession,
    server_id: int,
    user_id: int,
    *,
    owner_id: Optional[int] = None,
) -> int:
    """Итоговые права участника: объединение прав всех его ролей + @everyone."""
    if owner_id is None:
        server = await get_server(db, server_id)
        owner_id = server.owner_id

    if user_id == owner_id:
        return ALL_PERMISSIONS

    if not await is_member(db, server_id, user_id):
        return 0

    default_role = await get_default_role(db, server_id)
    # Сервер без ролей (создан до этой функции) — работаем на базовых правах
    total = int(default_role.permissions) if default_role else DEFAULT_PERMISSIONS

    for role in await get_member_roles(db, server_id, user_id):
        total |= int(role.permissions)

    if total & int(Permission.ADMINISTRATOR):
        return ALL_PERMISSIONS

    return total


async def get_top_role_position(
    db: AsyncSession,
    server_id: int,
    user_id: int,
    *,
    owner_id: Optional[int] = None,
) -> int:
    """Позиция высшей роли участника. Владелец всегда выше всех."""
    if owner_id is None:
        server = await get_server(db, server_id)
        owner_id = server.owner_id

    if user_id == owner_id:
        return OWNER_POSITION

    roles = await get_member_roles(db, server_id, user_id)
    if not roles:
        return 0
    return max(int(role.position) for role in roles)


def has_permission(permissions: int, permission: Permission) -> bool:
    if permissions & int(Permission.ADMINISTRATOR):
        return True
    return bool(permissions & int(permission))


async def require_membership(db: AsyncSession, server_id: int, user: User) -> Channel:
    server = await get_server(db, server_id)
    if user.id != server.owner_id and not await is_member(db, server_id, user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Вы не состоите в этом сервере",
        )
    return server


async def require_permission(
    db: AsyncSession,
    server_id: int,
    user: User,
    permission: Permission,
) -> int:
    """Проверяет право участника на сервере. Возвращает его итоговые права."""
    server = await require_membership(db, server_id, user)
    permissions = await get_member_permissions(
        db, server_id, user.id, owner_id=server.owner_id
    )

    if not has_permission(permissions, permission):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав для этого действия",
        )
    return permissions


async def require_hierarchy(
    db: AsyncSession,
    server_id: int,
    actor: User,
    target_user_id: int,
    *,
    owner_id: Optional[int] = None,
) -> None:
    """Нельзя действовать против того, чья высшая роль не ниже вашей."""
    if owner_id is None:
        server = await get_server(db, server_id)
        owner_id = server.owner_id

    if actor.id == owner_id:
        return

    if target_user_id == owner_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Нельзя применить это действие к владельцу сервера",
        )

    actor_position = await get_top_role_position(
        db, server_id, actor.id, owner_id=owner_id
    )
    target_position = await get_top_role_position(
        db, server_id, target_user_id, owner_id=owner_id
    )

    if target_position >= actor_position:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Роль этого участника не ниже вашей — действие недоступно",
        )
