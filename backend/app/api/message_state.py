from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_current_active_user
from app.db.database import get_db
from app.models import ChannelReadState, Message, MessageDraft, SavedMessage, TextChannel, User
from app.services.channel_permissions import can_view_channel
from app.services.message_serializer import serialize_channel_message
from app.services.thread_access import THREAD_KINDS, can_access_thread
from app.websocket.connection_manager import manager


router = APIRouter()


class DraftPayload(BaseModel):
    content: str = Field(default="", max_length=5000)
    attachment_refs: list[str] = Field(default_factory=list, max_length=10)


class ReadPayload(BaseModel):
    message_id: int | None = None


class SavedPayload(BaseModel):
    note: str | None = Field(default=None, max_length=500)


async def _channel_access(db: AsyncSession, channel_id: int, user: User) -> TextChannel:
    channel = await db.get(TextChannel, channel_id)
    if not channel or channel.is_hidden:
        raise HTTPException(status_code=404, detail="Канал не найден")
    if channel.kind in THREAD_KINDS:
        if not await can_access_thread(db, channel, user):
            raise HTTPException(status_code=404, detail="Канал не найден")
    elif not await can_view_channel(
        db, channel.channel_id, user.id, "text", channel.id,
    ):
        raise HTTPException(status_code=404, detail="Канал не найден")
    return channel


@router.get("/users/@me/drafts")
async def list_drafts(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(select(MessageDraft).where(
        MessageDraft.user_id == current_user.id,
    ).order_by(MessageDraft.updated_at.desc()))).scalars().all()
    result = []
    for item in rows:
        try:
            await _channel_access(db, item.channel_id, current_user)
        except HTTPException:
            continue
        result.append({
            "channel_id": item.channel_id,
            "content": item.content,
            "attachment_refs": item.attachment_refs or [],
            "updated_at": item.updated_at,
        })
    return result


@router.put("/users/@me/drafts/{channel_id}")
async def save_draft(
    channel_id: int,
    payload: DraftPayload,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await _channel_access(db, channel_id, current_user)
    if not payload.content and not payload.attachment_refs:
        await db.execute(delete(MessageDraft).where(
            MessageDraft.user_id == current_user.id, MessageDraft.channel_id == channel_id,
        ))
        await db.commit()
        return {"deleted": True}
    stmt = insert(MessageDraft).values(
        user_id=current_user.id, channel_id=channel_id,
        content=payload.content, attachment_refs=payload.attachment_refs,
    ).on_conflict_do_update(
        constraint="uq_message_draft_user_channel",
        set_={
            "content": payload.content,
            "attachment_refs": payload.attachment_refs,
            "updated_at": datetime.now(timezone.utc),
        },
    ).returning(MessageDraft)
    item = (await db.execute(stmt)).scalar_one()
    await db.commit()
    await manager.send_to_user(current_user.id, {
        "type": "draft_update",
        "data": {"channel_id": channel_id, "content": item.content, "attachment_refs": item.attachment_refs},
    })
    return {"channel_id": channel_id, "content": item.content, "attachment_refs": item.attachment_refs}


@router.delete("/users/@me/drafts/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(
    channel_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(MessageDraft).where(
        MessageDraft.user_id == current_user.id, MessageDraft.channel_id == channel_id,
    ))
    await db.commit()


@router.get("/users/@me/read-states")
async def list_read_states(
    server_id: int | None = Query(default=None),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(ChannelReadState).join(TextChannel, TextChannel.id == ChannelReadState.channel_id).where(
        ChannelReadState.user_id == current_user.id,
    )
    if server_id is not None:
        stmt = stmt.where(TextChannel.channel_id == server_id)
    rows = (await db.execute(stmt)).scalars().all()
    return [{
        "channel_id": item.channel_id,
        "last_read_message_id": item.last_read_message_id,
        "updated_at": item.updated_at,
    } for item in rows]


@router.get("/users/@me/unreads")
async def list_unreads(
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(
            TextChannel.id, TextChannel.channel_id, TextChannel.name,
            func.max(Message.id).label("latest_message_id"),
            ChannelReadState.last_read_message_id,
        )
        .join(Message, Message.text_channel_id == TextChannel.id)
        .outerjoin(ChannelReadState, and_(
            ChannelReadState.channel_id == TextChannel.id,
            ChannelReadState.user_id == current_user.id,
        ))
        .where(Message.is_deleted.is_(False), TextChannel.is_hidden.is_(False))
        .group_by(TextChannel.id, ChannelReadState.last_read_message_id)
        .having(func.max(Message.id) > func.coalesce(ChannelReadState.last_read_message_id, 0))
        .order_by(func.max(Message.id).desc())
        .limit(500)
    )).all()
    result = []
    for channel_id, server_id, channel_name, message_id, _last_read in rows:
        try:
            await _channel_access(db, channel_id, current_user)
        except HTTPException:
            continue
        result.append({
            "message_id": message_id, "text_channel_id": channel_id,
            "server_id": server_id, "channel_name": channel_name,
        })
    return result


@router.put("/users/@me/read-states/{channel_id}")
async def mark_read(
    channel_id: int,
    payload: ReadPayload,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await _channel_access(db, channel_id, current_user)
    if payload.message_id is not None:
        message = await db.get(Message, payload.message_id)
        if not message or message.text_channel_id != channel_id or message.is_deleted:
            raise HTTPException(status_code=400, detail="Сообщение не принадлежит каналу")
    stmt = insert(ChannelReadState).values(
        user_id=current_user.id, channel_id=channel_id,
        last_read_message_id=payload.message_id,
    ).on_conflict_do_update(
        constraint="uq_channel_read_user_channel",
        set_={"last_read_message_id": payload.message_id, "updated_at": datetime.now(timezone.utc)},
    )
    await db.execute(stmt)
    await db.commit()
    data = {"channel_id": channel_id, "last_read_message_id": payload.message_id}
    await manager.send_to_user(current_user.id, {"type": "read_state_update", "data": data})
    return data


async def _message_access(db: AsyncSession, message_id: int, user: User) -> Message:
    message = (await db.execute(select(Message).options(
        selectinload(Message.author), selectinload(Message.attachments),
    ).where(Message.id == message_id, Message.is_deleted.is_(False)))).scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="Сообщение не найдено")
    await _channel_access(db, message.text_channel_id, user)
    return message


@router.get("/users/@me/saved-messages")
async def list_saved_messages(
    before_id: int | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SavedMessage, Message).join(Message, Message.id == SavedMessage.message_id).where(
        SavedMessage.user_id == current_user.id, Message.is_deleted.is_(False),
    )
    if before_id:
        stmt = stmt.where(SavedMessage.id < before_id)
    rows = (await db.execute(stmt.options(
        selectinload(Message.author), selectinload(Message.attachments),
    ).order_by(SavedMessage.id.desc()).limit(limit))).all()
    result = []
    for saved, message in rows:
        try:
            channel = await _channel_access(db, message.text_channel_id, current_user)
        except HTTPException:
            continue
        result.append({
            "id": saved.id, "note": saved.note, "created_at": saved.created_at,
            "server_id": channel.channel_id, "message": serialize_channel_message(message, include_reply=False),
        })
    return result


@router.put("/users/@me/saved-messages/{message_id}")
async def save_message(
    message_id: int,
    payload: SavedPayload,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await _message_access(db, message_id, current_user)
    stmt = insert(SavedMessage).values(
        user_id=current_user.id, message_id=message_id, note=payload.note,
    ).on_conflict_do_update(
        constraint="uq_saved_message_user_message", set_={"note": payload.note},
    ).returning(SavedMessage.id, SavedMessage.created_at)
    row = (await db.execute(stmt)).one()
    await db.commit()
    return {"id": row.id, "message_id": message_id, "note": payload.note, "created_at": row.created_at}


@router.delete("/users/@me/saved-messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unsave_message(
    message_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(SavedMessage).where(
        SavedMessage.user_id == current_user.id, SavedMessage.message_id == message_id,
    ))
    await db.commit()
