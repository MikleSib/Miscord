from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator
from app.services.slow_mode import SLOW_MODE_OPTIONS


class ForumCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category_id: int | None = None
    position: int = 0
    guidelines: str | None = Field(default=None, max_length=4000)
    default_layout: Literal["list", "gallery"] = "list"
    default_sort: Literal["latest_activity", "created_at"] = "latest_activity"
    require_tag: bool = False
    auto_archive_minutes: int = 10080
    slow_mode_seconds: int = 0

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Название форума не может быть пустым")
        return value

    @field_validator("slow_mode_seconds")
    @classmethod
    def validate_slow_mode(cls, value: int) -> int:
        if value not in SLOW_MODE_OPTIONS:
            raise ValueError("Недопустимое значение медленного режима")
        return value

    @field_validator("auto_archive_minutes")
    @classmethod
    def validate_archive_duration(cls, value: int) -> int:
        if value not in {60, 1440, 4320, 10080}:
            raise ValueError("Недопустимый срок автоархива")
        return value


class ForumSettingsUpdate(BaseModel):
    guidelines: str | None = Field(default=None, max_length=4000)
    default_layout: Literal["list", "gallery"] | None = None
    default_sort: Literal["latest_activity", "created_at"] | None = None
    require_tag: bool | None = None
    auto_archive_minutes: int | None = None
    slow_mode_seconds: int | None = None

    @field_validator("slow_mode_seconds")
    @classmethod
    def validate_optional_slow_mode(cls, value: int | None) -> int | None:
        if value is not None and value not in SLOW_MODE_OPTIONS:
            raise ValueError("Недопустимое значение медленного режима")
        return value

    @field_validator("auto_archive_minutes")
    @classmethod
    def validate_optional_archive_duration(cls, value: int | None) -> int | None:
        if value is not None and value not in {60, 1440, 4320, 10080}:
            raise ValueError("Недопустимый срок автоархива")
        return value


class ForumTagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    emoji: str | None = Field(default=None, max_length=128)
    moderated: bool = False

    @field_validator("name")
    @classmethod
    def clean_tag_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Название тега не может быть пустым")
        return value


class ForumTagUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=32)
    emoji: str | None = Field(default=None, max_length=128)
    moderated: bool | None = None
    position: int | None = None


class ForumPostCreate(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=5000)
    tag_ids: list[int] = Field(default_factory=list, max_length=5)
    attachment_upload_ids: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("title", "content")
    @classmethod
    def strip_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Поле не может быть пустым")
        return value
