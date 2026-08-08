from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.bot import BotSession
from app.services.bot_event_dispatcher import INTENT_DEFAULTS, dispatcher as bot_event_dispatcher
from app.services.bot_security import get_bot_principal_by_token


OP_DISPATCH = 0
OP_HEARTBEAT = 1
OP_IDENTIFY = 2
OP_RECONNECT = 7
OP_RESUME = 6
OP_INVALID_SESSION = 9
OP_HELLO = 10
OP_HEARTBEAT_ACK = 11


def _coerce_dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _coerce_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _clean_token(value: str | None) -> str:
    if not value:
        return ""
    token = str(value).strip()
    if token.startswith("Bot "):
        token = token[4:].strip()
    return token


async def _load_bot_session(db: AsyncSession, application_id: int, session_id: str) -> BotSession | None:
    result = await db.execute(
        select(BotSession).where(
            BotSession.application_id == application_id,
            BotSession.session_id == session_id,
        )
    )
    return result.scalar_one_or_none()


async def _touch_session(db: AsyncSession, session_id: str, sequence: int | None = None) -> None:
    values = {"last_heartbeat_at": datetime.now(timezone.utc), "is_active": True}
    if sequence is not None:
        values["sequence"] = sequence
    await db.execute(update(BotSession).where(BotSession.session_id == session_id).values(**values))
    await db.commit()


async def _mark_session_inactive(db: AsyncSession, session_id: str) -> None:
    await db.execute(
        update(BotSession)
        .where(BotSession.session_id == session_id)
        .values(is_active=False, is_resumable=True)
    )
    await db.commit()


async def _send_invalid_session(websocket: WebSocket, resumable: bool) -> None:
    await websocket.send_text(json.dumps({"op": OP_INVALID_SESSION, "d": {"resumable": resumable}}))


async def _identify_session(
    websocket: WebSocket,
    db: AsyncSession,
    token: str,
    intents: int | None,
) -> tuple[int, str] | None:
    if not token:
        await _send_invalid_session(websocket, False)
        return None

    principal = await get_bot_principal_by_token(token, db)
    requested_intents = _coerce_int(intents, INTENT_DEFAULTS)
    if requested_intents < 0:
        requested_intents = INTENT_DEFAULTS

    current_session_id = secrets.token_urlsafe(24)
    session = BotSession(
        application_id=principal.application.id,
        session_id=current_session_id,
        intents=requested_intents,
        sequence=0,
        is_active=True,
        is_resumable=True,
        last_heartbeat_at=datetime.now(timezone.utc),
    )
    db.add(session)
    await db.commit()

    await bot_event_dispatcher.register(
        principal.application.id,
        websocket,
        session_id=current_session_id,
        intents=requested_intents,
        sequence=0,
    )
    await websocket.send_text(json.dumps(bot_event_dispatcher._ready_payload(current_session_id)))

    return principal.application.id, current_session_id


async def _resume_session(
    websocket: WebSocket,
    db: AsyncSession,
    token: str,
    session_id: str,
    sequence: int | None = None,
) -> tuple[int, str] | None:
    if not token or not session_id:
        await _send_invalid_session(websocket, False)
        return None

    principal = await get_bot_principal_by_token(token, db)
    existing = await _load_bot_session(db, principal.application.id, session_id)
    if not existing or not existing.is_resumable:
        await _send_invalid_session(websocket, False)
        return None

    requested_sequence = _coerce_int(sequence, int(existing.sequence or 0))
    existing.is_active = True
    existing.sequence = max(int(existing.sequence or 0), requested_sequence)
    existing.last_heartbeat_at = datetime.now(timezone.utc)
    await db.commit()

    await bot_event_dispatcher.register(
        principal.application.id,
        websocket,
        session_id=existing.session_id,
        intents=int(existing.intents or INTENT_DEFAULTS),
        sequence=int(existing.sequence or 0),
    )
    await websocket.send_text(json.dumps(bot_event_dispatcher._resumed_payload()))
    return principal.application.id, existing.session_id


async def websocket_gateway_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    if not settings.BOT_PLATFORM_ENABLED:
        await _send_invalid_session(websocket, False)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await bot_event_dispatcher.hello(websocket)

    db: AsyncSession | None = None
    current_session_id: str | None = None
    current_application_id: int | None = None
    identified = False

    try:
        db = AsyncSessionLocal()
        while True:
            raw = await websocket.receive_text()
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.close(code=status.WS_1002_PROTOCOL_ERROR)
                return

            if not isinstance(payload, dict):
                await _send_invalid_session(websocket, False)
                continue

            op = _coerce_int(payload.get("op"), -1)
            data = _coerce_dict(payload.get("d"))
            sequence = payload.get("s")

            if op == OP_HELLO:
                continue

            if op == OP_HEARTBEAT:
                await bot_event_dispatcher.heartbeat_ack(websocket)
                if current_session_id and db is not None:
                    await bot_event_dispatcher.touch(current_session_id)
                    await _touch_session(db, current_session_id, _coerce_int(sequence, None))
                continue

            if op == OP_RECONNECT:
                await websocket.close(code=4000)
                return

            if op == OP_RESUME:
                token = _clean_token(data.get("token") if isinstance(data.get("token"), str) else None)
                session_id = str(data.get("session_id") or "")
                try:
                    result = await _resume_session(
                        websocket,
                        db,
                        token,
                        session_id,
                        _coerce_int(data.get("seq"), None),
                    )
                except HTTPException as exc:
                    await _send_invalid_session(websocket, False)
                    await websocket.close(code=4004 if exc.status_code == 401 else status.WS_1008_POLICY_VIOLATION)
                    return
                except Exception:
                    await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
                    return

                if result is None:
                    await websocket.close(code=4000)
                    return
                current_application_id, current_session_id = result
                identified = True
                continue

            if op == OP_IDENTIFY:
                if identified:
                    await _send_invalid_session(websocket, False)
                    await websocket.close(code=4000)
                    return

                token = _clean_token(data.get("token") if isinstance(data.get("token"), str) else None)
                try:
                    result = await _identify_session(websocket, db, token, data.get("intents"))
                except HTTPException as exc:
                    await _send_invalid_session(websocket, False)
                    await websocket.close(code=4004 if exc.status_code == 401 else status.WS_1008_POLICY_VIOLATION)
                    return
                except Exception:
                    await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
                    return

                if result is None:
                    continue
                current_application_id, current_session_id = result
                identified = True
                continue

            if not identified:
                await _send_invalid_session(websocket, False)
                await websocket.close(code=4000)
                return

    except WebSocketDisconnect:
        pass
    except HTTPException as exc:
        await _send_invalid_session(websocket, False)
        await websocket.close(code=4004 if exc.status_code == 401 else status.WS_1008_POLICY_VIOLATION)
    except Exception as exc:
        print(f"[BotGateway] error: {exc}")
        try:
            await _send_invalid_session(websocket, False)
        except Exception:
            pass
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except Exception:
            pass
    finally:
        if db is not None and current_session_id is not None:
            await bot_event_dispatcher.unregister(current_session_id)
            try:
                await _mark_session_inactive(db, current_session_id)
            except Exception:
                pass
            await db.close()
