from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_active_user
from app.core.permissions import Permission, get_member_permissions, has_permission, is_member
from app.db.database import get_db
from app.models import (
    Channel, ScheduledEvent, ScheduledEventInterest, ServerOnboarding,
    ServerOnboardingMember, TextChannel, User, VoiceChannel,
)
from app.services.server_events import notify_server


router = APIRouter()


class OnboardingRule(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class OnboardingOption(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    label: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    channel_ids: list[int] = Field(default_factory=list, max_length=50)


class OnboardingPrompt(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    title: str = Field(min_length=1, max_length=120)
    required: bool = False
    multiple: bool = True
    options: list[OnboardingOption] = Field(min_length=1, max_length=12)


class OnboardingPayload(BaseModel):
    enabled: bool = False
    welcome_text: str | None = Field(default=None, max_length=1000)
    rules: list[OnboardingRule] = Field(default_factory=list, max_length=20)
    prompts: list[OnboardingPrompt] = Field(default_factory=list, max_length=10)
    default_channel_ids: list[int] = Field(default_factory=list, max_length=50)


class OnboardingComplete(BaseModel):
    accepted_rules: bool
    answers: dict[str, list[str]] = Field(default_factory=dict)


class EventPayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    entity_type: Literal["voice", "external"] = "voice"
    channel_id: int | None = None
    location: str | None = Field(default=None, max_length=200)
    scheduled_start_at: datetime
    scheduled_end_at: datetime | None = None

    @model_validator(mode="after")
    def validate_event(self):
        now = datetime.now(timezone.utc)
        start = self.scheduled_start_at
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        if start <= now:
            raise ValueError("Начало события должно быть в будущем")
        end = self.scheduled_end_at
        if end is not None and end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        if end is not None and end <= start:
            raise ValueError("Завершение должно быть позже начала")
        if self.entity_type == "voice" and self.channel_id is None:
            raise ValueError("Для голосового события выберите канал")
        if self.entity_type == "external" and not (self.location or "").strip():
            raise ValueError("Для внешнего события укажите место")
        return self


async def _server_and_permissions(db: AsyncSession, server_id: int, user: User) -> tuple[Channel, int]:
    server = await db.get(Channel, server_id)
    if not server or (user.id != server.owner_id and not await is_member(db, server_id, user.id)):
        raise HTTPException(status_code=404, detail="Сервер не найден")
    permissions = await get_member_permissions(db, server_id, user.id, owner_id=server.owner_id)
    return server, permissions


def _onboarding(item: ServerOnboarding | None, server_id: int) -> dict:
    return {
        "server_id": server_id,
        "enabled": bool(item and item.enabled),
        "welcome_text": item.welcome_text if item else None,
        "rules": list(item.rules or []) if item else [],
        "prompts": list(item.prompts or []) if item else [],
        "default_channel_ids": list(item.default_channel_ids or []) if item else [],
        "updated_at": item.updated_at if item else None,
    }


async def _validate_channel_ids(db: AsyncSession, server_id: int, values: set[int]) -> None:
    if not values:
        return
    found = set((await db.execute(select(TextChannel.id).where(
        TextChannel.channel_id == server_id, TextChannel.id.in_(values),
    ))).scalars().all())
    if found != values:
        raise HTTPException(status_code=400, detail="Onboarding содержит канал другого сервера")


@router.get("/servers/{server_id}/onboarding")
async def get_onboarding(
    server_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await _server_and_permissions(db, server_id, current_user)
    return _onboarding(await db.get(ServerOnboarding, server_id), server_id)


@router.put("/servers/{server_id}/onboarding")
async def update_onboarding(
    server_id: int,
    payload: OnboardingPayload,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _server, permissions = await _server_and_permissions(db, server_id, current_user)
    if not has_permission(permissions, Permission.MANAGE_GUILD):
        raise HTTPException(status_code=403, detail="Нет права управлять onboarding")
    channel_ids = set(payload.default_channel_ids)
    for prompt in payload.prompts:
        for option in prompt.options:
            channel_ids.update(option.channel_ids)
    await _validate_channel_ids(db, server_id, channel_ids)
    item = await db.get(ServerOnboarding, server_id) or ServerOnboarding(server_id=server_id)
    item.enabled = payload.enabled
    item.welcome_text = payload.welcome_text
    item.rules = [rule.model_dump() for rule in payload.rules]
    item.prompts = [prompt.model_dump() for prompt in payload.prompts]
    item.default_channel_ids = list(dict.fromkeys(payload.default_channel_ids))
    item.updated_by_id = current_user.id
    db.add(item)
    await db.commit()
    await db.refresh(item)
    await notify_server(db, server_id, {"type": "server_onboarding_updated", "data": _onboarding(item, server_id)})
    return _onboarding(item, server_id)


@router.get("/servers/{server_id}/onboarding/@me")
async def onboarding_for_member(
    server_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await _server_and_permissions(db, server_id, current_user)
    config = await db.get(ServerOnboarding, server_id)
    completion = (await db.execute(select(ServerOnboardingMember).where(
        ServerOnboardingMember.server_id == server_id,
        ServerOnboardingMember.user_id == current_user.id,
    ))).scalar_one_or_none()
    return {**_onboarding(config, server_id), "completed": completion is not None}


@router.post("/servers/{server_id}/onboarding/@me/complete")
async def complete_onboarding(
    server_id: int,
    payload: OnboardingComplete,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await _server_and_permissions(db, server_id, current_user)
    config = await db.get(ServerOnboarding, server_id)
    if not config or not config.enabled:
        raise HTTPException(status_code=409, detail="Onboarding на сервере выключен")
    if config.rules and not payload.accepted_rules:
        raise HTTPException(status_code=400, detail="Необходимо принять правила сервера")
    selected = set(config.default_channel_ids or [])
    prompt_map = {str(item.get("id")): item for item in config.prompts or []}
    for prompt_id, prompt in prompt_map.items():
        if prompt.get("required") and not payload.answers.get(prompt_id):
            raise HTTPException(status_code=400, detail=f"Ответьте на вопрос: {prompt.get('title')}")
    for prompt_id, option_ids in payload.answers.items():
        prompt = prompt_map.get(prompt_id)
        if not prompt:
            continue
        allowed = {str(item.get("id")): item for item in prompt.get("options", [])}
        if not prompt.get("multiple", True) and len(option_ids) > 1:
            raise HTTPException(status_code=400, detail="Для вопроса разрешён один ответ")
        for option_id in option_ids:
            if option_id not in allowed:
                raise HTTPException(status_code=400, detail="Недопустимый вариант onboarding")
            selected.update(allowed[option_id].get("channel_ids", []))
    await db.execute(delete(ServerOnboardingMember).where(
        ServerOnboardingMember.server_id == server_id,
        ServerOnboardingMember.user_id == current_user.id,
    ))
    item = ServerOnboardingMember(
        server_id=server_id, user_id=current_user.id,
        selected_channel_ids=sorted(selected), answers=payload.answers,
    )
    db.add(item)
    await db.commit()
    return {"completed": True, "selected_channel_ids": item.selected_channel_ids}


def _event(item: ScheduledEvent, interested: int = 0, mine: bool = False) -> dict:
    return {
        "id": item.id, "server_id": item.server_id, "creator_id": item.creator_id,
        "name": item.name, "description": item.description, "entity_type": item.entity_type,
        "channel_id": item.channel_id, "location": item.location,
        "scheduled_start_at": item.scheduled_start_at, "scheduled_end_at": item.scheduled_end_at,
        "status": item.status, "interested_count": interested, "interested": mine,
    }


@router.get("/servers/{server_id}/events")
async def list_events(
    server_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await _server_and_permissions(db, server_id, current_user)
    rows = (await db.execute(
        select(ScheduledEvent, func.count(ScheduledEventInterest.id))
        .outerjoin(ScheduledEventInterest, ScheduledEventInterest.event_id == ScheduledEvent.id)
        .where(ScheduledEvent.server_id == server_id, ScheduledEvent.status != "cancelled")
        .group_by(ScheduledEvent.id).order_by(ScheduledEvent.scheduled_start_at)
    )).all()
    mine = set((await db.execute(select(ScheduledEventInterest.event_id).where(
        ScheduledEventInterest.user_id == current_user.id,
    ))).scalars().all())
    return [_event(item, int(count), item.id in mine) for item, count in rows]


@router.post("/servers/{server_id}/events", status_code=status.HTTP_201_CREATED)
async def create_event(
    server_id: int,
    payload: EventPayload,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _server, permissions = await _server_and_permissions(db, server_id, current_user)
    if not (has_permission(permissions, Permission.CREATE_EVENTS) or has_permission(permissions, Permission.MANAGE_EVENTS)):
        raise HTTPException(status_code=403, detail="Нет права создавать события")
    if payload.channel_id:
        voice = await db.get(VoiceChannel, payload.channel_id)
        if not voice or voice.channel_id != server_id:
            raise HTTPException(status_code=400, detail="Голосовой канал не принадлежит серверу")
    item = ScheduledEvent(server_id=server_id, creator_id=current_user.id, **payload.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    data = _event(item)
    await notify_server(db, server_id, {"type": "scheduled_event_create", "data": data})
    return data


async def _editable_event(db: AsyncSession, event_id: int, user: User) -> ScheduledEvent:
    item = await db.get(ScheduledEvent, event_id)
    if not item:
        raise HTTPException(status_code=404, detail="Событие не найдено")
    server, permissions = await _server_and_permissions(db, item.server_id, user)
    if user.id not in {server.owner_id, item.creator_id} and not has_permission(permissions, Permission.MANAGE_EVENTS):
        raise HTTPException(status_code=403, detail="Нет права управлять событием")
    return item


@router.patch("/events/{event_id}")
async def update_event(
    event_id: int,
    payload: EventPayload,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    item = await _editable_event(db, event_id, current_user)
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    data = _event(item)
    await notify_server(db, item.server_id, {"type": "scheduled_event_update", "data": data})
    return data


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_event(
    event_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    item = await _editable_event(db, event_id, current_user)
    item.status = "cancelled"
    await db.commit()
    await notify_server(db, item.server_id, {"type": "scheduled_event_delete", "data": {"id": item.id}})


@router.put("/events/{event_id}/interest")
async def add_interest(
    event_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(ScheduledEvent, event_id)
    if not item or item.status != "scheduled":
        raise HTTPException(status_code=404, detail="Событие не найдено")
    await _server_and_permissions(db, item.server_id, current_user)
    existing = await db.scalar(select(ScheduledEventInterest.id).where(
        ScheduledEventInterest.event_id == event_id,
        ScheduledEventInterest.user_id == current_user.id,
    ))
    if not existing:
        db.add(ScheduledEventInterest(event_id=event_id, user_id=current_user.id))
        await db.commit()
    return {"interested": True}


@router.delete("/events/{event_id}/interest", status_code=status.HTTP_204_NO_CONTENT)
async def remove_interest(
    event_id: int,
    current_user: User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(delete(ScheduledEventInterest).where(
        ScheduledEventInterest.event_id == event_id,
        ScheduledEventInterest.user_id == current_user.id,
    ))
    await db.commit()
