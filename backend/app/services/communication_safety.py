from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import and_, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelMember, TextChannel
from app.models.friendship import Friendship, FriendshipStatus
from app.models.safety import AutoModRule, MemberTimeout, SafetyReport, UserPrivacySettings
from app.models.security import UserBlock

URL_RE = re.compile(r"https?://|www\.", re.IGNORECASE)
MENTION_RE = re.compile(r"<@!?\d+>|@everyone|@here", re.IGNORECASE)


async def is_blocked_between(db: AsyncSession, first_id: int, second_id: int) -> bool:
    return bool((await db.execute(select(UserBlock.id).where(or_(
        and_(UserBlock.blocker_id == first_id, UserBlock.blocked_id == second_id),
        and_(UserBlock.blocker_id == second_id, UserBlock.blocked_id == first_id),
    )))).scalar_one_or_none())


async def are_friends(db: AsyncSession, first_id: int, second_id: int) -> bool:
    return bool((await db.execute(select(Friendship.id).where(
        Friendship.status == FriendshipStatus.ACCEPTED,
        or_(
            and_(Friendship.user_a_id == first_id, Friendship.user_b_id == second_id),
            and_(Friendship.user_a_id == second_id, Friendship.user_b_id == first_id),
        ),
    ))).scalar_one_or_none())


async def share_server(db: AsyncSession, first_id: int, second_id: int) -> bool:
    left = select(ChannelMember.channel_id).where(ChannelMember.user_id == first_id).subquery()
    return bool((await db.execute(select(ChannelMember.id).where(
        ChannelMember.user_id == second_id,
        ChannelMember.channel_id.in_(select(left.c.channel_id)),
    ).limit(1))).scalar_one_or_none())


async def can_send_dm(db: AsyncSession, sender_id: int, recipient_id: int) -> tuple[bool, str | None]:
    if sender_id == recipient_id:
        return False, "Нельзя отправить личное сообщение самому себе."
    if await is_blocked_between(db, sender_id, recipient_id):
        return False, "Личные сообщения между этими пользователями недоступны."
    privacy = await db.get(UserPrivacySettings, recipient_id)
    mode = privacy.direct_messages if privacy else "friends_and_servers"
    if mode == "everyone":
        return True, None
    if mode == "nobody":
        return False, "Пользователь отключил личные сообщения."
    if await are_friends(db, sender_id, recipient_id):
        return True, None
    if mode == "friends_and_servers" and await share_server(db, sender_id, recipient_id):
        return True, None
    return False, "Пользователь принимает сообщения только от разрешённых контактов."


async def is_timed_out(db: AsyncSession, server_id: int, user_id: int) -> bool:
    return bool((await db.execute(select(MemberTimeout.id).where(
        MemberTimeout.server_id == server_id,
        MemberTimeout.user_id == user_id,
        MemberTimeout.expires_at > datetime.now(timezone.utc),
    ))).scalar_one_or_none())


async def channel_server_id(db: AsyncSession, text_channel_id: int) -> int | None:
    return (await db.execute(select(TextChannel.channel_id).where(
        TextChannel.id == text_channel_id,
    ))).scalar_one_or_none()


def _matches(rule: AutoModRule, content: str) -> str | None:
    config = dict(rule.config or {})
    normalized = content.casefold()
    if rule.trigger_type == "keyword":
        keywords = [str(item).strip().casefold() for item in config.get("keywords", []) if str(item).strip()]
        matched = next((word for word in keywords if word in normalized), None)
        return f"Запрещённое слово: {matched}" if matched else None
    if rule.trigger_type == "mention_spam":
        count = len(MENTION_RE.findall(content))
        limit = max(1, min(50, int(config.get("max_mentions", 5))))
        return "Слишком много упоминаний." if count > limit else None
    if rule.trigger_type == "link":
        if not bool(config.get("allow_links", False)) and URL_RE.search(content):
            return "Ссылки запрещены правилом сервера."
        return None
    if rule.trigger_type == "spam":
        repeated = re.search(r"(.)\1{9,}", normalized)
        words = normalized.split()
        duplicate_ratio = 1 - (len(set(words)) / len(words)) if words else 0
        return "Сообщение похоже на спам." if repeated or (len(words) >= 8 and duplicate_ratio > 0.65) else None
    return None


async def evaluate_automod(
    db: AsyncSession,
    server_id: int,
    content: str,
    *,
    user_id: int | None = None,
    channel_id: int | None = None,
) -> tuple[bool, str | None]:
    if not content:
        return True, None
    rules = (await db.execute(select(AutoModRule).where(
        AutoModRule.server_id == server_id,
        AutoModRule.enabled.is_(True),
    ).order_by(AutoModRule.id.asc()))).scalars().all()
    for rule in rules:
        config = dict(rule.config or {})
        if user_id is not None and user_id in {int(item) for item in config.get("exempt_user_ids", [])}:
            continue
        if channel_id is not None and channel_id in {int(item) for item in config.get("exempt_channel_ids", [])}:
            continue
        reason = _matches(rule, content)
        if reason:
            if user_id is not None:
                await _apply_automod_actions(
                    db, rule, server_id=server_id, user_id=user_id,
                    channel_id=channel_id, reason=reason,
                )
            return False, reason
    return True, None


async def _apply_automod_actions(
    db: AsyncSession,
    rule: AutoModRule,
    *,
    server_id: int,
    user_id: int,
    channel_id: int | None,
    reason: str,
) -> None:
    actions = list(rule.actions or [{"type": "block_message"}])
    changed = False
    for action in actions:
        action_type = str(action.get("type", "block_message"))
        if action_type == "alert":
            db.add(SafetyReport(
                reporter_id=user_id, target_user_id=user_id, server_id=server_id,
                channel_id=channel_id, category="spam",
                details=f"AutoMod «{rule.name}»: {reason}",
            ))
            changed = True
        elif action_type == "timeout":
            seconds = max(60, min(2_419_200, int(action.get("duration_seconds", 600))))
            expires_at = datetime.now(timezone.utc) + __import__("datetime").timedelta(seconds=seconds)
            await db.execute(insert(MemberTimeout).values(
                server_id=server_id, user_id=user_id, moderator_id=None,
                reason=f"AutoMod «{rule.name}»: {reason}", expires_at=expires_at,
            ).on_conflict_do_update(
                constraint="uq_member_timeouts_server_user",
                set_={"reason": f"AutoMod «{rule.name}»: {reason}", "expires_at": expires_at},
            ))
            changed = True
    if changed:
        await db.commit()
