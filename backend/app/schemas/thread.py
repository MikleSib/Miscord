from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

ThreadKind = Literal["public_thread", "private_thread"]
ThreadResponseKind = Literal["public_thread", "private_thread", "forum_post"]


class ThreadCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: ThreadKind = "public_thread"
    auto_archive_minutes: int = 1440
    source_message_id: int | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Название обсуждения не может быть пустым")
        return value

    @field_validator("auto_archive_minutes")
    @classmethod
    def validate_archive_duration(cls, value: int) -> int:
        if value not in {60, 1440, 4320, 10080}:
            raise ValueError("Недопустимый срок автоархива")
        return value


class ThreadUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    archived: bool | None = None
    locked: bool | None = None
    auto_archive_minutes: int | None = None

    @field_validator("name")
    @classmethod
    def clean_optional_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Название обсуждения не может быть пустым")
        return value

    @field_validator("auto_archive_minutes")
    @classmethod
    def validate_optional_archive_duration(cls, value: int | None) -> int | None:
        if value is not None and value not in {60, 1440, 4320, 10080}:
            raise ValueError("Недопустимый срок автоархива")
        return value


class ThreadResponse(BaseModel):
    id: int
    name: str
    server_id: int
    parent_id: int
    owner_id: int | None
    kind: ThreadResponseKind
    archived_at: datetime | None
    locked: bool
    auto_archive_minutes: int
    last_message_at: datetime | None
    created_at: datetime
    member_count: int = 0
    joined: bool = False
    starter_message_id: int | None = None


class ThreadMemberResponse(BaseModel):
    user_id: int
    username: str
    display_name: str | None
    avatar_url: str | None
    joined_at: datetime
    notification_level: str
