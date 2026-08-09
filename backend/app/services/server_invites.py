from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Invite


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def invite_matches_reuse_request(
    invite: Invite,
    *,
    max_age_seconds: int | None,
    max_uses: int | None,
    now: datetime,
) -> bool:
    requested_age = max_age_seconds or 0
    requested_uses = max_uses or None

    if invite.max_uses != requested_uses:
        return False
    if invite.max_uses and invite.uses >= invite.max_uses:
        return False

    if invite.expires_at is None:
        return requested_age == 0
    if _as_utc(invite.expires_at) <= _as_utc(now) or requested_age == 0:
        return False
    if invite.created_at is None:
        return False

    lifetime = (_as_utc(invite.expires_at) - _as_utc(invite.created_at)).total_seconds()
    return abs(lifetime - requested_age) <= 5


async def find_reusable_invite(
    db: AsyncSession,
    *,
    server_id: int,
    inviter_id: int,
    target_text_channel_id: int | None,
    max_age_seconds: int | None,
    max_uses: int | None,
) -> Invite | None:
    requested_uses = max_uses or None
    result = await db.execute(
        select(Invite)
        .where(
            Invite.server_id == server_id,
            Invite.inviter_id == inviter_id,
            Invite.target_text_channel_id == target_text_channel_id,
            Invite.max_uses == requested_uses,
        )
        .order_by(Invite.created_at.desc())
        .limit(25)
    )
    now = datetime.now(timezone.utc)
    return next(
        (
            invite
            for invite in result.scalars().all()
            if invite_matches_reuse_request(
                invite,
                max_age_seconds=max_age_seconds,
                max_uses=max_uses,
                now=now,
            )
        ),
        None,
    )
