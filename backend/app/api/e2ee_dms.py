from __future__ import annotations

import base64
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db
from app.models import DirectMessage, SecretDmSession, User, UserE2eeDevice
from app.schemas.e2ee import (
    E2eeDeviceRegister,
    E2eeDeviceResponse,
    SecretDmMessageResponse,
    SecretDmSessionCreate,
    SecretDmSessionResponse,
)
from app.services.communication_safety import can_send_dm
from app.websocket.connection_manager import manager

router = APIRouter()


def _decode_b64(value: str, label: str, maximum: int) -> bytes:
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, base64.binascii.Error) as error:
        raise HTTPException(status_code=422, detail=f"Invalid {label}") from error
    if not raw or len(raw) > maximum or base64.b64encode(raw).decode("ascii") != value:
        raise HTTPException(status_code=422, detail=f"Invalid {label}")
    return raw


def _uuid(value: str, label: str) -> str:
    try:
        parsed = uuid.UUID(value)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"Invalid {label}") from error
    if str(parsed) != value:
        raise HTTPException(status_code=422, detail=f"Invalid {label}")
    return value


def _pair(first: int, second: int) -> tuple[int, int]:
    return (first, second) if first < second else (second, first)


async def _allowed(db: AsyncSession, current: User, peer_id: int) -> None:
    allowed, reason = await can_send_dm(db, current.id, peer_id)
    if not allowed:
        raise HTTPException(status_code=403, detail=reason or "Direct messages are unavailable")


def _device_response(device: UserE2eeDevice) -> E2eeDeviceResponse:
    return E2eeDeviceResponse(
        device_id=device.id,
        credential_id=device.credential_id,
        key_package=base64.b64encode(device.key_package).decode("ascii"),
        key_package_id=device.key_package_id,
        signature_public_key=base64.b64encode(device.signature_public_key).decode("ascii"),
    )


async def _current_device(db: AsyncSession, user_id: int) -> UserE2eeDevice | None:
    return (await db.execute(select(UserE2eeDevice).where(
        UserE2eeDevice.user_id == user_id,
        UserE2eeDevice.revoked_at.is_(None),
    ).order_by(UserE2eeDevice.last_seen_at.desc()).limit(1))).scalar_one_or_none()


@router.put("/devices/@me", response_model=E2eeDeviceResponse)
async def register_device(
    payload: E2eeDeviceRegister,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Account-level row lock makes revocation + replacement one atomic
    # single-device transition even when two browser tabs register together.
    await db.execute(select(User).where(User.id == current.id).with_for_update())
    device_id = _uuid(payload.device_id, "device id")
    if payload.credential_id != f"user:{current.id}:device:{device_id}":
        raise HTTPException(status_code=422, detail="Credential does not belong to this account")
    package = _decode_b64(payload.key_package, "MLS key package", 24576)
    signature_key = _decode_b64(payload.signature_public_key, "signature key", 256)
    now = datetime.now(timezone.utc)
    await db.execute(update(UserE2eeDevice).where(
        UserE2eeDevice.user_id == current.id,
        UserE2eeDevice.id != device_id,
        UserE2eeDevice.revoked_at.is_(None),
    ).values(revoked_at=now))
    device = await db.get(UserE2eeDevice, device_id)
    if device and device.user_id != current.id:
        raise HTTPException(status_code=409, detail="Device id is already registered")
    if not device:
        device = UserE2eeDevice(id=device_id, user_id=current.id)
        db.add(device)
    device.credential_id = payload.credential_id
    device.key_package = package
    device.key_package_id = str(uuid.uuid4())
    device.key_package_claimed_at = None
    device.signature_public_key = signature_key
    device.revoked_at = None
    device.last_seen_at = now
    await db.commit()
    return _device_response(device)


@router.get("/devices/@me", response_model=E2eeDeviceResponse | None)
async def get_own_device(current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    device = await _current_device(db, current.id)
    return _device_response(device) if device else None


@router.get("/users/{peer_id}/device", response_model=E2eeDeviceResponse)
async def get_peer_device(
    peer_id: int,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _allowed(db, current, peer_id)
    device = await _current_device(db, peer_id)
    if not device:
        raise HTTPException(status_code=409, detail="Recipient has not enabled end-to-end encryption")
    return _device_response(device)


async def _active_session(db: AsyncSession, first: int, second: int) -> SecretDmSession | None:
    low, high = _pair(first, second)
    return (await db.execute(select(SecretDmSession).where(
        SecretDmSession.user_low_id == low,
        SecretDmSession.user_high_id == high,
        SecretDmSession.active.is_(True),
    ))).scalar_one_or_none()


async def _session_response(
    db: AsyncSession, session: SecretDmSession, current: User,
) -> SecretDmSessionResponse:
    founder = await db.get(UserE2eeDevice, session.founder_device_id)
    local = await _current_device(db, current.id)
    local_expected = session.founder_device_id if founder and founder.user_id == current.id else session.recipient_device_id
    return SecretDmSessionResponse(
        session_id=session.id,
        founder_user_id=founder.user_id if founder else 0,
        founder_device_id=session.founder_device_id,
        recipient_device_id=session.recipient_device_id,
        welcome=base64.b64encode(session.welcome).decode("ascii"),
        ratchet_tree=base64.b64encode(session.ratchet_tree).decode("ascii"),
        local_device_id=local.id if local else None,
        device_matches=bool(local and local.id == local_expected),
    )


@router.get("/dms/{peer_id}/session", response_model=SecretDmSessionResponse | None)
async def get_session(peer_id: int, current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _allowed(db, current, peer_id)
    session = await _active_session(db, current.id, peer_id)
    return await _session_response(db, session, current) if session else None


@router.post("/dms/{peer_id}/session", response_model=SecretDmSessionResponse, status_code=201)
async def create_session(
    peer_id: int,
    payload: SecretDmSessionCreate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _allowed(db, current, peer_id)
    session_id = _uuid(payload.session_id, "session id")
    founder_id = _uuid(payload.founder_device_id, "founder device id")
    recipient_id = _uuid(payload.recipient_device_id, "recipient device id")
    key_package_id = _uuid(payload.recipient_key_package_id, "recipient key package id")
    founder = await db.get(UserE2eeDevice, founder_id)
    recipient = (await db.execute(select(UserE2eeDevice).where(
        UserE2eeDevice.id == recipient_id,
    ).with_for_update())).scalar_one_or_none()
    if not founder or founder.user_id != current.id or founder.revoked_at is not None:
        raise HTTPException(status_code=409, detail="Founder device is no longer active")
    if not recipient or recipient.user_id != peer_id or recipient.revoked_at is not None:
        raise HTTPException(status_code=409, detail="Recipient encryption device changed")
    if recipient.key_package_id != key_package_id or recipient.key_package_claimed_at is not None:
        raise HTTPException(status_code=409, detail="Recipient key package was already used; fetch a fresh key")
    if await _active_session(db, current.id, peer_id):
        raise HTTPException(status_code=409, detail="A secret session already exists")
    low, high = _pair(current.id, peer_id)
    session = SecretDmSession(
        id=session_id, user_low_id=low, user_high_id=high,
        founder_device_id=founder_id, recipient_device_id=recipient_id,
        welcome=_decode_b64(payload.welcome, "MLS welcome", 262144),
        ratchet_tree=_decode_b64(payload.ratchet_tree, "MLS ratchet tree", 1048576),
    )
    db.add(session)
    recipient.key_package_claimed_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A secret session already exists") from error
    response = await _session_response(db, session, current)
    await manager.send_to_user(peer_id, {"type": "secret_dm_session", "data": response.model_dump()})
    return response


@router.delete("/dms/{peer_id}/session", status_code=204)
async def reset_session(peer_id: int, current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _allowed(db, current, peer_id)
    session = await _active_session(db, current.id, peer_id)
    if session:
        session.active = False
        session.closed_at = datetime.now(timezone.utc)
        await db.commit()
        await manager.send_to_user(peer_id, {"type": "secret_dm_session_reset", "data": {"peer_id": current.id}})


@router.get("/dms/{peer_id}/messages", response_model=list[SecretDmMessageResponse])
async def get_secret_messages(
    peer_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _allowed(db, current, peer_id)
    session = await _active_session(db, current.id, peer_id)
    if not session:
        return []
    rows = (await db.execute(select(DirectMessage).where(
        DirectMessage.secret_session_id == session.id,
        or_(
            and_(DirectMessage.sender_id == current.id, DirectMessage.recipient_id == peer_id),
            and_(DirectMessage.sender_id == peer_id, DirectMessage.recipient_id == current.id),
        ),
    ).order_by(DirectMessage.timestamp.desc()).offset(skip).limit(limit))).scalars().all()
    return [SecretDmMessageResponse(
        id=row.id, client_nonce=row.client_nonce,
        timestamp=(row.timestamp.replace(tzinfo=timezone.utc) if row.timestamp.tzinfo is None else row.timestamp).isoformat(),
        sender_id=row.sender_id, recipient_id=row.recipient_id,
        encryption_version=row.encryption_version,
        ciphertext=base64.b64encode(row.ciphertext).decode("ascii"),
        secret_session_id=row.secret_session_id, sender_device_id=row.sender_device_id,
    ) for row in reversed(rows)]
