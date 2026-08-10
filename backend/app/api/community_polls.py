from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.dependencies import get_current_active_user
from app.db.database import get_db
from app.models import Channel, PollAnswer, PollVote, User
from app.services.bot_event_dispatcher import dispatcher as bot_dispatcher
from app.services.polls import (
    can_close_poll,
    cast_vote,
    close_expired_poll,
    is_poll_closed,
    load_poll_context,
    remove_vote,
    serialize_poll,
)
from app.services.realtime_events import enqueue_realtime_event

router = APIRouter()


def _require_feature() -> None:
    if not settings.POLLS_ENABLED:
        raise HTTPException(status_code=404, detail="Опросы пока недоступны")


async def _dispatch_vote(db: AsyncSession, event_name: str, poll_id: int, answer_id: int, user_id: int, server_id: int) -> None:
    await bot_dispatcher.dispatch_guild_event(
        db,
        server_id,
        event_name,
        {"poll_id": str(poll_id), "answer_id": str(answer_id), "user_id": str(user_id), "guild_id": str(server_id)},
    )


@router.get("/polls/{poll_id}")
async def get_poll(
    poll_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    poll, _message, channel = await load_poll_context(db, poll_id, user, lock=True)
    if await close_expired_poll(db, poll, channel.id):
        await db.commit()
    return await serialize_poll(db, poll, user.id)


@router.put("/polls/{poll_id}/answers/{answer_id}/@me")
async def vote_poll(
    poll_id: int,
    answer_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    poll, _message, channel = await load_poll_context(db, poll_id, user, lock=True)
    await cast_vote(db, poll, answer_id, user.id)
    enqueue_realtime_event(db, event_type="POLL_STATE_UPDATE", data={"poll_id": poll.id, "closed": False}, topic="channel", target_id=channel.id)
    await db.commit()
    await _dispatch_vote(db, "MESSAGE_POLL_VOTE_ADD", poll.id, answer_id, user.id, channel.channel_id)
    return await serialize_poll(db, poll, user.id)


@router.delete("/polls/{poll_id}/answers/{answer_id}/@me")
async def unvote_poll(
    poll_id: int,
    answer_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    poll, _message, channel = await load_poll_context(db, poll_id, user, lock=True)
    await remove_vote(db, poll, answer_id, user.id)
    enqueue_realtime_event(db, event_type="POLL_STATE_UPDATE", data={"poll_id": poll.id, "closed": False}, topic="channel", target_id=channel.id)
    await db.commit()
    await _dispatch_vote(db, "MESSAGE_POLL_VOTE_REMOVE", poll.id, answer_id, user.id, channel.channel_id)
    return await serialize_poll(db, poll, user.id)


@router.post("/polls/{poll_id}/close")
async def close_poll(
    poll_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    poll, message, channel = await load_poll_context(db, poll_id, user, lock=True)
    if not await can_close_poll(db, poll, message, user):
        raise HTTPException(status_code=403, detail="Нет права завершить опрос")
    if poll.closed_at is None:
        poll.closed_at = datetime.now(timezone.utc)
        enqueue_realtime_event(db, event_type="POLL_STATE_UPDATE", data={"poll_id": poll.id, "closed": True}, topic="channel", target_id=channel.id)
        await db.commit()
    return await serialize_poll(db, poll, user.id)


@router.get("/polls/{poll_id}/answers/{answer_id}/voters")
async def list_poll_voters(
    poll_id: int,
    answer_id: int,
    user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _require_feature()
    poll, _message, _channel = await load_poll_context(db, poll_id, user)
    if not is_poll_closed(poll):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Участники скрыты до завершения опроса")
    answer = await db.scalar(select(PollAnswer.id).where(PollAnswer.id == answer_id, PollAnswer.poll_id == poll.id))
    if answer is None:
        raise HTTPException(status_code=404, detail="Вариант ответа не найден")
    rows = (await db.execute(select(User).join(PollVote, PollVote.user_id == User.id).where(PollVote.poll_id == poll.id, PollVote.answer_id == answer_id).order_by(PollVote.created_at))).scalars().all()
    return [{"id": item.id, "username": item.username, "display_name": item.display_name, "avatar_url": item.avatar_url} for item in rows]
