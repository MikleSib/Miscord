from __future__ import annotations

import base64
import hmac
import uuid
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DirectMessage, SecretDmSession, UserE2eeDevice
from app.services.communication_safety import can_send_dm
from app.services.rate_limit import enforce_message_antispam, rate_limit_payload
from app.websocket.unified_dm import send_message_failure


def _decode_ciphertext(value: Any) -> bytes | None:
    if not isinstance(value, str) or len(value) > 50000:
        return None
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, base64.binascii.Error):
        return None
    if not 24 <= len(raw) <= 32768 or base64.b64encode(raw).decode("ascii") != value:
        return None
    return raw


def _canonical_uuid(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        return None
    return value if str(parsed) == value else None


async def _active_session(
    db: AsyncSession, session_id: str, sender_id: int, recipient_id: int,
) -> SecretDmSession | None:
    return (await db.execute(select(SecretDmSession).where(
        SecretDmSession.id == session_id,
        SecretDmSession.active.is_(True),
        or_(
            and_(SecretDmSession.user_low_id == sender_id, SecretDmSession.user_high_id == recipient_id),
            and_(SecretDmSession.user_low_id == recipient_id, SecretDmSession.user_high_id == sender_id),
        ),
    ))).scalar_one_or_none()


async def handle_secret_dm_message(user, message_data: dict, db: AsyncSession, manager) -> None:
    client_nonce = message_data.get("client_nonce")
    try:
        recipient_id = int(message_data.get("recipient_id"))
    except (TypeError, ValueError):
        recipient_id = 0
    session_id = _canonical_uuid(message_data.get("session_id"))
    sender_device_id = _canonical_uuid(message_data.get("sender_device_id"))
    client_nonce = _canonical_uuid(client_nonce)
    ciphertext = _decode_ciphertext(message_data.get("ciphertext"))
    if not recipient_id or not ciphertext or not session_id or not sender_device_id or not client_nonce:
        await send_message_failure(user.id, client_nonce, "invalid_secret_message", "Invalid encrypted message")
        return
    allowed, reason = await can_send_dm(db, user.id, recipient_id)
    if not allowed:
        await send_message_failure(user.id, client_nonce, "dm_forbidden", reason or "Direct messages are unavailable")
        return
    session = await _active_session(db, session_id, user.id, recipient_id)
    device = await db.get(UserE2eeDevice, sender_device_id)
    if not session or not device or device.user_id != user.id or device.revoked_at is not None:
        await send_message_failure(user.id, client_nonce, "secret_session_invalid", "Secret session must be re-established")
        return
    expected_device = session.founder_device_id if device.id == session.founder_device_id else session.recipient_device_id
    if device.id != expected_device:
        await send_message_failure(user.id, client_nonce, "secret_device_changed", "Encryption device changed")
        return
    existing = (await db.execute(select(DirectMessage).where(
        DirectMessage.sender_id == user.id,
        DirectMessage.client_nonce == client_nonce,
    ))).scalar_one_or_none()
    if existing:
        same = (
            existing.recipient_id == recipient_id
            and existing.secret_session_id == session_id
            and existing.ciphertext is not None
            and hmac.compare_digest(existing.ciphertext, ciphertext)
        )
        if not same:
            await send_message_failure(user.id, client_nonce, "nonce_conflict", "Message nonce was already used")
            return
        await manager.send_to_user(user.id, {
            "type": "message_ack", "data": {"id": existing.id, "client_nonce": client_nonce},
        })
        return
    allowed_rate, retry_after, rate_message = enforce_message_antispam(
        user.id,
        dest_key=f"secret-dm:{min(user.id, recipient_id)}:{max(user.id, recipient_id)}",
        content=f"encrypted:{client_nonce}",
    )
    if not allowed_rate:
        await send_message_failure(user.id, client_nonce, "rate_limited", rate_message, True, retry_after)
        await manager.send_to_user(user.id, rate_limit_payload(
            message=rate_message, retry_after_seconds=retry_after,
            scope="secret_dm", recipient_id=recipient_id,
        ))
        return
    message = DirectMessage(
        client_nonce=client_nonce,
        sender_id=user.id,
        recipient_id=recipient_id,
        content=None,
        encryption_version=1,
        ciphertext=ciphertext,
        secret_session_id=session_id,
        sender_device_id=sender_device_id,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    timestamp = message.timestamp.isoformat()
    payload = {
        "type": "secret_dm",
        "data": {
            "id": message.id,
            "client_nonce": client_nonce,
            "timestamp": timestamp,
            "sender_id": user.id,
            "recipient_id": recipient_id,
            "encryption_version": 1,
            "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
            "secret_session_id": session_id,
            "sender_device_id": sender_device_id,
        },
    }
    await manager.send_to_user(recipient_id, payload)
    await manager.send_to_user(user.id, payload)
