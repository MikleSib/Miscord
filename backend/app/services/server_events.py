"""Рассылка WebSocket-событий участникам сервера.

Уведомления идут через персональные соединения (`/ws/notifications`,
`/ws/unified`), поэтому событие сервера — это цикл по его участникам.
"""

from typing import Iterable, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import ChannelMember
from app.websocket.connection_manager import manager


async def get_server_member_ids(db: AsyncSession, server_id: int) -> list[int]:
    result = await db.execute(
        select(ChannelMember.user_id).where(ChannelMember.channel_id == server_id)
    )
    return [row[0] for row in result.fetchall()]


async def notify_server(
    db: AsyncSession,
    server_id: int,
    message: dict,
    *,
    exclude_user_id: Optional[int] = None,
    extra_user_ids: Optional[Iterable[int]] = None,
) -> None:
    """Отправляет событие всем участникам сервера.

    Сбой рассылки не должен ломать уже выполненное действие, поэтому все
    ошибки поглощаются.
    """
    try:
        recipient_ids = set(await get_server_member_ids(db, server_id))
    except Exception as exc:  # noqa: BLE001
        print(f"[ServerEvents] Не удалось получить участников {server_id}: {exc}")
        return

    if extra_user_ids:
        recipient_ids.update(extra_user_ids)
    if exclude_user_id is not None:
        recipient_ids.discard(exclude_user_id)

    for user_id in recipient_ids:
        try:
            await manager.send_to_user(user_id, message)
        except Exception as exc:  # noqa: BLE001
            print(f"[ServerEvents] Не удалось отправить {message.get('type')} пользователю {user_id}: {exc}")


async def notify_users(user_ids: Iterable[int], message: dict) -> None:
    for user_id in user_ids:
        try:
            await manager.send_to_user(user_id, message)
        except Exception as exc:  # noqa: BLE001
            print(f"[ServerEvents] Не удалось отправить {message.get('type')} пользователю {user_id}: {exc}")
