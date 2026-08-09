"""Журнал аудита сервера."""

from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User


class AuditAction:
    SERVER_UPDATE = "server_update"
    CHANNEL_CREATE = "channel_create"
    CHANNEL_UPDATE = "channel_update"
    CHANNEL_DELETE = "channel_delete"
    WEBHOOK_CREATE = "webhook_create"
    WEBHOOK_UPDATE = "webhook_update"
    WEBHOOK_DELETE = "webhook_delete"
    WEBHOOK_TOKEN_RESET = "webhook_token_reset"
    MEMBER_JOIN = "member_join"
    MEMBER_LEAVE = "member_leave"
    MEMBER_KICK = "member_kick"
    MEMBER_BAN = "member_ban"
    MEMBER_UNBAN = "member_unban"
    MEMBER_NICKNAME_UPDATE = "member_nickname_update"
    MEMBER_ROLE_ADD = "member_role_add"
    MEMBER_ROLE_REMOVE = "member_role_remove"
    ROLE_CREATE = "role_create"
    ROLE_UPDATE = "role_update"
    ROLE_DELETE = "role_delete"
    ROLE_REORDER = "role_reorder"
    INVITE_CREATE = "invite_create"
    INVITE_DELETE = "invite_delete"
    OWNERSHIP_TRANSFER = "ownership_transfer"
    MESSAGE_PIN = "message_pin"
    MESSAGE_UNPIN = "message_unpin"
    CHANNEL_CATEGORY_CREATE = "channel_category_create"
    CHANNEL_CATEGORY_UPDATE = "channel_category_update"
    CHANNEL_CATEGORY_DELETE = "channel_category_delete"


async def log_audit(
    db: AsyncSession,
    server_id: int,
    actor: Optional[User],
    action: str,
    *,
    target_type: Optional[str] = None,
    target_id: Optional[int] = None,
    target_name: Optional[str] = None,
    changes: Optional[dict[str, Any]] = None,
    reason: Optional[str] = None,
) -> None:
    """Пишет запись в журнал аудита.

    Никогда не бросает исключение: сбой журналирования не должен ломать
    основное действие, которое уже зафиксировано в базе.
    """
    try:
        entry = AuditLog(
            server_id=server_id,
            actor_id=actor.id if actor else None,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_name=target_name,
            changes=changes,
            reason=reason,
        )
        db.add(entry)
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        print(f"[Audit] Не удалось записать событие {action}: {exc}")
        try:
            await db.rollback()
        except Exception:  # noqa: BLE001
            pass
