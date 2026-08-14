from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


ExpressionKind = Literal["emoji", "sticker", "sound"]


class ExpressionCreate(BaseModel):
    kind: ExpressionKind
    name: str = Field(min_length=2, max_length=64)
    upload_id: str = Field(min_length=8, max_length=64)
    description: str | None = Field(default=None, max_length=160)
    emoji: str | None = Field(default=None, max_length=64)
    volume: int = Field(default=100, ge=0, le=100)
    width: int | None = Field(default=None, ge=1, le=4096)
    height: int | None = Field(default=None, ge=1, le=4096)
    duration_ms: int | None = Field(default=None, ge=1, le=5000)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip().lower().replace(" ", "_")
        if not normalized.replace("_", "a").isalnum():
            raise ValueError("Имя может содержать буквы, цифры и подчёркивания")
        return normalized


class ExpressionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=64)
    description: str | None = Field(default=None, max_length=160)
    emoji: str | None = Field(default=None, max_length=64)
    volume: int | None = Field(default=None, ge=0, le=100)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return ExpressionCreate.normalize_name(value)


class ExpressionResponse(BaseModel):
    id: int
    server_id: int
    creator_id: int | None
    kind: ExpressionKind
    name: str
    description: str | None
    emoji: str | None
    volume: int
    file_url: str
    content_type: str
    size_bytes: int
    width: int | None
    height: int | None
    duration_ms: int | None
    animated: bool
    available: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class GifSelection(BaseModel):
    provider: Literal["giphy"] = "giphy"
    id: str = Field(min_length=1, max_length=128)
    url: str = Field(pattern=r"^https://media[0-9]*\.giphy\.com/")
    preview_url: str | None = Field(default=None, pattern=r"^https://media[0-9]*\.giphy\.com/")
    title: str | None = Field(default=None, max_length=160)
    width: int | None = Field(default=None, ge=1, le=4096)
    height: int | None = Field(default=None, ge=1, le=4096)


class MessageMediaSelection(BaseModel):
    sticker_ids: list[int] = Field(default_factory=list, max_length=3)
    gif: GifSelection | None = None
