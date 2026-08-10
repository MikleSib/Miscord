from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import Permission, has_permission
from app.models import Channel, Message, Poll, PollAnswer, PollVote, TextChannel, User
from app.schemas.poll import PollCreate
from app.services.channel_access import require_text_channel_access, user_can_manage_messages
from app.services.channel_permissions import get_effective_channel_permissions
from app.services.realtime_events import enqueue_realtime_event
from app.services.thread_access import thread_permissions


async def require_poll_permission(db: AsyncSession, channel: TextChannel, user: User) -> None:
    if channel.kind in {"public_thread", "private_thread", "forum_post"}:
        permissions = await thread_permissions(db, channel, user)
    else:
        server = await db.get(Channel, channel.channel_id)
        permissions = await get_effective_channel_permissions(
            db,
            channel.channel_id,
            user.id,
            "text",
            channel.id,
            owner_id=server.owner_id if server else None,
        )
    if not has_permission(permissions, Permission.SEND_POLLS):
        raise HTTPException(status_code=403, detail="Нет права создавать опросы")


async def create_poll_for_message(
    db: AsyncSession,
    *,
    message: Message,
    creator_id: int,
    payload: PollCreate,
) -> Poll:
    poll = Poll(
        message_id=message.id,
        question=payload.question,
        allow_multiselect=payload.allow_multiselect,
        expires_at=datetime.now(timezone.utc) + timedelta(seconds=payload.duration_seconds),
        created_by_id=creator_id,
    )
    db.add(poll)
    await db.flush()
    for position, answer in enumerate(payload.answers):
        db.add(PollAnswer(poll_id=poll.id, text=answer.text, emoji=answer.emoji, position=position))
    return poll


async def load_poll_context(db: AsyncSession, poll_id: int, user: User, *, lock: bool = False):
    statement = select(Poll).where(Poll.id == poll_id)
    if lock:
        statement = statement.with_for_update()
    poll = await db.scalar(statement)
    if not poll:
        raise HTTPException(status_code=404, detail="Опрос не найден")
    message = await db.get(Message, poll.message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Опрос не найден")
    channel = await require_text_channel_access(db, user, message.text_channel_id)
    return poll, message, channel


def is_poll_closed(poll: Poll, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    expires = poll.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    return poll.closed_at is not None or expires <= now


async def close_expired_poll(db: AsyncSession, poll: Poll, channel_id: int) -> bool:
    if poll.closed_at is not None or not is_poll_closed(poll):
        return False
    poll.closed_at = datetime.now(timezone.utc)
    enqueue_realtime_event(
        db,
        event_type="POLL_STATE_UPDATE",
        data={"poll_id": poll.id, "closed": True},
        topic="channel",
        target_id=channel_id,
    )
    return True


async def serialize_poll(db: AsyncSession, poll: Poll, viewer_id: int) -> dict:
    answers = list((await db.execute(select(PollAnswer).where(PollAnswer.poll_id == poll.id).order_by(PollAnswer.position))).scalars().all())
    own_votes = set((await db.execute(select(PollVote.answer_id).where(PollVote.poll_id == poll.id, PollVote.user_id == viewer_id))).scalars().all())
    closed = is_poll_closed(poll)
    counts: Counter[int] = Counter()
    total_voters = 0
    if closed:
        votes = (await db.execute(select(PollVote.answer_id, PollVote.user_id).where(PollVote.poll_id == poll.id))).all()
        counts.update(answer_id for answer_id, _user_id in votes)
        total_voters = len({user_id for _answer_id, user_id in votes})
    return {
        "id": poll.id,
        "message_id": poll.message_id,
        "question": poll.question,
        "allow_multiselect": bool(poll.allow_multiselect),
        "expires_at": poll.expires_at.isoformat(),
        "closed_at": poll.closed_at.isoformat() if poll.closed_at else None,
        "closed": closed,
        "total_voters": total_voters if closed else None,
        "answers": [
            {
                "id": answer.id,
                "text": answer.text,
                "emoji": answer.emoji,
                "position": answer.position,
                "selected": answer.id in own_votes,
                "vote_count": counts[answer.id] if closed else None,
            }
            for answer in answers
        ],
    }


async def cast_vote(db: AsyncSession, poll: Poll, answer_id: int, user_id: int) -> None:
    answer = await db.scalar(select(PollAnswer).where(PollAnswer.id == answer_id, PollAnswer.poll_id == poll.id))
    if not answer:
        raise HTTPException(status_code=404, detail="Вариант ответа не найден")
    if is_poll_closed(poll):
        raise HTTPException(status_code=409, detail="Опрос уже завершён")
    if not poll.allow_multiselect:
        await db.execute(delete(PollVote).where(PollVote.poll_id == poll.id, PollVote.user_id == user_id))
    await db.execute(
        insert(PollVote)
        .values(poll_id=poll.id, answer_id=answer.id, user_id=user_id)
        .on_conflict_do_nothing(constraint="uq_poll_votes_poll_answer_user")
    )


async def remove_vote(db: AsyncSession, poll: Poll, answer_id: int, user_id: int) -> None:
    if is_poll_closed(poll):
        raise HTTPException(status_code=409, detail="Опрос уже завершён")
    await db.execute(delete(PollVote).where(PollVote.poll_id == poll.id, PollVote.answer_id == answer_id, PollVote.user_id == user_id))


async def can_close_poll(db: AsyncSession, poll: Poll, message: Message, user: User) -> bool:
    if poll.created_by_id == user.id:
        return True
    channel = await db.get(TextChannel, message.text_channel_id)
    return bool(channel and await user_can_manage_messages(db, user, channel))
