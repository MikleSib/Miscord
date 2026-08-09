from typing import Literal, Optional

from pydantic import BaseModel, Field


class ChannelCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    position: Optional[int] = Field(default=None, ge=0, le=500)


class ChannelCategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    position: Optional[int] = Field(default=None, ge=0, le=500)


class ChannelCategoryResponse(BaseModel):
    id: int
    name: str
    server_id: int
    position: int


class ChannelPlacement(BaseModel):
    """Новое место канала: тип, id, позиция и категория."""

    id: int
    type: Literal["text", "voice"]
    position: int = Field(ge=0, le=1000)
    category_id: Optional[int] = None


class ChannelReorderRequest(BaseModel):
    channels: list[ChannelPlacement] = Field(min_length=1, max_length=200)
