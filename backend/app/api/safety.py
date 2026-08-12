from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_active_user
from app.core.permissions import Permission, get_member_permissions, has_permission, require_hierarchy
from app.db.database import get_db
from app.models import (
    Channel, DirectMessage, Friendship, Message, TextChannel, User,
    VoiceChannel, VoiceChannelUser,
)
from app.services.channel_access import user_can_access_text_channel
from app.models.safety import AutoModRule, MemberTimeout, SafetyReport, UserPrivacySettings
from app.models.security import UserBlock
from app.websocket.connection_manager import manager
from app.services.voice_presence import voice_presence

router = APIRouter()


class PrivacyPayload(BaseModel):
    direct_messages: Literal["everyone", "friends", "friends_and_servers", "nobody"]
    friend_requests: Literal["everyone", "server_members", "nobody"]


class ReportPayload(BaseModel):
    target_user_id: int | None = None
    server_id: int | None = None
    channel_id: int | None = None
    message_id: int | None = None
    dm_message_id: int | None = None
    category: Literal["spam", "harassment", "hate", "sexual", "violence", "impersonation", "other"]
    details: str | None = Field(default=None, max_length=2000)


class TimeoutPayload(BaseModel):
    duration_seconds: int = Field(ge=60, le=2_419_200)
    reason: str | None = Field(default=None, max_length=512)


class AutoModPayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    trigger_type: Literal["keyword", "spam", "mention_spam", "link"]
    config: dict = Field(default_factory=dict)
    actions: list[dict] = Field(default_factory=lambda: [{"type": "block_message"}])

    @classmethod
    def _validate_actions(cls, actions: list[dict]) -> list[dict]:
        if not actions or len(actions) > 3:
            raise ValueError("Укажите от одного до трёх действий AutoMod")
        normalized = []
        for action in actions:
            action_type = action.get("type")
            if action_type not in {"block_message", "alert", "timeout"}:
                raise ValueError("Неизвестное действие AutoMod")
            item = {"type": action_type}
            if action_type == "timeout":
                item["duration_seconds"] = max(60, min(2_419_200, int(action.get("duration_seconds", 600))))
            normalized.append(item)
        return normalized

    def model_post_init(self, __context) -> None:
        self.actions = self._validate_actions(self.actions)


class ReportResolutionPayload(BaseModel):
    status: Literal["open", "reviewing", "resolved", "dismissed"]
    resolution: str | None = Field(default=None, max_length=2000)


async def _server_permission(db: AsyncSession, server_id: int, user: User, permission: Permission) -> Channel:
    server = await db.get(Channel, server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="Сервер не найден")
    permissions = await get_member_permissions(db, server_id, user.id, owner_id=server.owner_id)
    if not has_permission(permissions, permission):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    return server


@router.get("/users/@me/privacy")
async def get_privacy(current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    item = await db.get(UserPrivacySettings, current_user.id)
    return {
        "direct_messages": item.direct_messages if item else "friends_and_servers",
        "friend_requests": item.friend_requests if item else "everyone",
    }


@router.put("/users/@me/privacy")
async def update_privacy(payload: PrivacyPayload, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    await db.execute(insert(UserPrivacySettings).values(
        user_id=current_user.id,
        direct_messages=payload.direct_messages,
        friend_requests=payload.friend_requests,
    ).on_conflict_do_update(
        index_elements=[UserPrivacySettings.user_id],
        set_={"direct_messages": payload.direct_messages, "friend_requests": payload.friend_requests},
    ))
    await db.commit()
    return payload.model_dump()


@router.get("/users/@me/blocks")
async def list_blocks(current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(UserBlock, User).join(
        User, User.id == UserBlock.blocked_id,
    ).where(UserBlock.blocker_id == current_user.id).order_by(UserBlock.created_at.desc()))).all()
    return [{
        "id": user.id,
        "username": user.username,
        "display_name": user.display_name,
        "avatar_url": user.avatar_url,
        "blocked_at": block.created_at,
    } for block, user in rows]


@router.put("/users/@me/blocks/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def block_user(user_id: int, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    if user_id == current_user.id or await db.get(User, user_id) is None:
        raise HTTPException(status_code=400, detail="Нельзя заблокировать этого пользователя")
    await db.execute(insert(UserBlock).values(
        blocker_id=current_user.id, blocked_id=user_id,
    ).on_conflict_do_nothing(constraint="uq_user_blocks_pair"))
    await db.execute(delete(Friendship).where(or_(
        (Friendship.user_a_id == current_user.id) & (Friendship.user_b_id == user_id),
        (Friendship.user_a_id == user_id) & (Friendship.user_b_id == current_user.id),
    )))
    await db.commit()


@router.delete("/users/@me/blocks/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unblock_user(user_id: int, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(UserBlock).where(
        UserBlock.blocker_id == current_user.id, UserBlock.blocked_id == user_id,
    ))
    await db.commit()


@router.post("/reports", status_code=status.HTTP_201_CREATED)
async def create_report(payload: ReportPayload, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    if not any((payload.target_user_id, payload.message_id, payload.dm_message_id)):
        raise HTTPException(status_code=400, detail="Укажите пользователя или сообщение")
    if payload.dm_message_id:
        dm = await db.get(DirectMessage, payload.dm_message_id)
        if dm is None or current_user.id not in (dm.sender_id, dm.recipient_id):
            raise HTTPException(status_code=404, detail="Сообщение не найдено")
    if payload.message_id:
        message = await db.get(Message, payload.message_id)
        channel = await db.get(TextChannel, message.text_channel_id) if message else None
        if (
            message is None or channel is None
            or not await user_can_access_text_channel(db, current_user, channel)
            or (payload.server_id and channel.channel_id != payload.server_id)
        ):
            raise HTTPException(status_code=404, detail="Сообщение не найдено")
    report = SafetyReport(reporter_id=current_user.id, **payload.model_dump())
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return {"id": report.id, "status": report.status, "created_at": report.created_at}


@router.get("/servers/{server_id}/reports")
async def list_server_reports(
    server_id: int,
    report_status: Literal["open", "reviewing", "resolved", "dismissed", "all"] = Query(default="open", alias="status"),
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await _server_permission(db, server_id, current_user, Permission.MODERATE_MEMBERS)
    stmt = select(SafetyReport).where(SafetyReport.server_id == server_id)
    if report_status != "all":
        stmt = stmt.where(SafetyReport.status == report_status)
    reports = (await db.execute(stmt.order_by(SafetyReport.created_at.desc()).limit(100))).scalars().all()
    result = []
    for report in reports:
        reporter = await db.get(User, report.reporter_id)
        target = await db.get(User, report.target_user_id) if report.target_user_id else None
        result.append(_report(report, reporter, target))
    return result


@router.patch("/servers/{server_id}/reports/{report_id}")
async def resolve_server_report(
    server_id: int,
    report_id: int,
    payload: ReportResolutionPayload,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await _server_permission(db, server_id, current_user, Permission.MODERATE_MEMBERS)
    report = await db.get(SafetyReport, report_id)
    if report is None or report.server_id != server_id:
        raise HTTPException(status_code=404, detail="Жалоба не найдена")
    report.status = payload.status
    report.resolution = payload.resolution
    if payload.status in {"resolved", "dismissed"}:
        report.resolved_at = datetime.now(timezone.utc)
        report.resolved_by_id = current_user.id
    else:
        report.resolved_at = None
        report.resolved_by_id = None
    await db.commit()
    await db.refresh(report)
    return _report(report, await db.get(User, report.reporter_id), await db.get(User, report.target_user_id) if report.target_user_id else None)


@router.put("/servers/{server_id}/members/{user_id}/timeout")
async def timeout_member(server_id: int, user_id: int, payload: TimeoutPayload, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    await _server_permission(db, server_id, current_user, Permission.MODERATE_MEMBERS)
    await require_hierarchy(db, server_id, current_user, user_id)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=payload.duration_seconds)
    await db.execute(insert(MemberTimeout).values(
        server_id=server_id, user_id=user_id, moderator_id=current_user.id,
        reason=payload.reason, expires_at=expires_at,
    ).on_conflict_do_update(
        constraint="uq_member_timeouts_server_user",
        set_={"moderator_id": current_user.id, "reason": payload.reason, "expires_at": expires_at},
    ))
    await db.commit()
    await _disconnect_timed_out_voice_member(db, server_id, user_id, current_user.id)
    await manager.send_personal_message({"type": "member_timeout", "server_id": server_id, "expires_at": expires_at.isoformat()}, user_id)
    return {"user_id": user_id, "expires_at": expires_at}


@router.delete("/servers/{server_id}/members/{user_id}/timeout", status_code=status.HTTP_204_NO_CONTENT)
async def remove_timeout(server_id: int, user_id: int, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    await _server_permission(db, server_id, current_user, Permission.MODERATE_MEMBERS)
    await db.execute(delete(MemberTimeout).where(MemberTimeout.server_id == server_id, MemberTimeout.user_id == user_id))
    await db.commit()


@router.get("/servers/{server_id}/automod")
async def list_automod(server_id: int, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    await _server_permission(db, server_id, current_user, Permission.MANAGE_GUILD)
    rows = (await db.execute(select(AutoModRule).where(AutoModRule.server_id == server_id).order_by(AutoModRule.id))).scalars().all()
    return [_automod(rule) for rule in rows]


@router.post("/servers/{server_id}/automod", status_code=status.HTTP_201_CREATED)
async def create_automod(server_id: int, payload: AutoModPayload, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    await _server_permission(db, server_id, current_user, Permission.MANAGE_GUILD)
    rule = AutoModRule(server_id=server_id, creator_id=current_user.id, **payload.model_dump())
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return _automod(rule)


@router.put("/servers/{server_id}/automod/{rule_id}")
async def update_automod(server_id: int, rule_id: int, payload: AutoModPayload, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    await _server_permission(db, server_id, current_user, Permission.MANAGE_GUILD)
    rule = await db.get(AutoModRule, rule_id)
    if rule is None or rule.server_id != server_id:
        raise HTTPException(status_code=404, detail="Правило не найдено")
    for key, value in payload.model_dump().items():
        setattr(rule, key, value)
    await db.commit()
    await db.refresh(rule)
    return _automod(rule)


@router.delete("/servers/{server_id}/automod/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_automod(server_id: int, rule_id: int, current_user: User = Depends(get_current_active_user), db: AsyncSession = Depends(get_db)):
    await _server_permission(db, server_id, current_user, Permission.MANAGE_GUILD)
    await db.execute(delete(AutoModRule).where(AutoModRule.id == rule_id, AutoModRule.server_id == server_id))
    await db.commit()


def _automod(rule: AutoModRule) -> dict:
    return {
        "id": rule.id,
        "server_id": rule.server_id,
        "name": rule.name,
        "enabled": rule.enabled,
        "trigger_type": rule.trigger_type,
        "config": rule.config or {},
        "actions": rule.actions or [],
        "creator_id": rule.creator_id,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
    }


def _public_user(user: User | None) -> dict | None:
    if user is None:
        return None
    return {
        "id": user.id, "username": user.username,
        "display_name": user.display_name, "avatar_url": user.avatar_url,
    }


def _report(report: SafetyReport, reporter: User | None, target: User | None) -> dict:
    return {
        "id": report.id, "category": report.category, "details": report.details,
        "status": report.status, "resolution": report.resolution,
        "channel_id": report.channel_id, "message_id": report.message_id,
        "dm_message_id": report.dm_message_id, "created_at": report.created_at,
        "resolved_at": report.resolved_at, "reporter": _public_user(reporter),
        "target": _public_user(target),
    }


async def _disconnect_timed_out_voice_member(
    db: AsyncSession, server_id: int, user_id: int, moderator_id: int,
) -> None:
    presence = await voice_presence.get_for_user(user_id)
    if not presence:
        return
    channel = await db.get(VoiceChannel, int(presence.get("channel_id", 0)))
    if channel is None or int(channel.channel_id) != server_id:
        return
    session_id = str(presence["session_id"])
    client = await voice_presence.client()
    await client.publish("voice:v1:human:moderate", json.dumps({
        "session_id": session_id, "disconnect": True,
    }))
    await voice_presence.remove(session_id)
    await db.execute(delete(VoiceChannelUser).where(
        VoiceChannelUser.voice_channel_id == channel.id,
        VoiceChannelUser.user_id == user_id,
    ))
    await db.commit()
    event = {
        "type": "voice_moderation_disconnect", "voice_channel_id": channel.id,
        "moderator_id": moderator_id, "reason": "member_timeout",
    }
    await manager.send_personal_message(event, user_id)
    await manager.send_to_voice_channel(channel.id, {
        "type": "user_left_voice", "user_id": user_id, "voice_channel_id": channel.id,
    })
