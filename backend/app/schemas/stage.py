from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


StageRole = Literal["audience", "speaker", "moderator"]


class StageCreate(BaseModel):
    channel_id: int
    topic: str = Field(min_length=1, max_length=120)
    request_to_speak_enabled: bool = True


class StageUpdate(BaseModel):
    topic: str | None = Field(default=None, min_length=1, max_length=120)
    request_to_speak_enabled: bool | None = None


class StageRoleUpdate(BaseModel):
    role: StageRole


class StageParticipant(BaseModel):
    user_id: int
    role: StageRole
    requested_to_speak_at: datetime | None = None


class StageInstanceResponse(BaseModel):
    id: int
    channel_id: int
    server_id: int
    owner_id: int | None
    topic: str
    status: str
    request_to_speak_enabled: bool
    started_at: datetime
    ended_at: datetime | None
    speaker_count: int = 0
    request_count: int = 0

    model_config = {"from_attributes": True}
