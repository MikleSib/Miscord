from pydantic import BaseModel, field_validator
from datetime import datetime
from typing import Optional, List
from app.schemas.user import User
from app.services.slow_mode import SLOW_MODE_OPTIONS

class ChannelBase(BaseModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    banner: Optional[str] = None

class ChannelCreate(ChannelBase):
    pass

class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    banner: Optional[str] = None
    is_public: Optional[bool] = None

class TextChannelBase(BaseModel):
    name: str
    position: int = 0
    slow_mode_seconds: int = 0

class TextChannelCreate(TextChannelBase):
    channel_id: int

class VoiceChannelBase(BaseModel):
    name: str
    position: int = 0
    max_users: int = 0  # 0 = без лимита
    bitrate: int = 64
    video_quality: str = "auto"

    @field_validator("max_users")
    @classmethod
    def validate_base_max_users(cls, value: int) -> int:
        if value < 0 or value > 99:
            raise ValueError("Лимит пользователей должен быть от 0 до 99")
        return value

    @field_validator("bitrate")
    @classmethod
    def validate_base_bitrate(cls, value: int) -> int:
        if value < 8 or value > 96:
            raise ValueError("Битрейт должен быть от 8 до 96 кбит/с")
        return value

    @field_validator("video_quality")
    @classmethod
    def validate_base_video_quality(cls, value: str) -> str:
        if value not in {"auto", "720p"}:
            raise ValueError("Качество видео: auto или 720p")
        return value

class VoiceChannelCreate(VoiceChannelBase):
    channel_id: int

class TextChannelUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[int] = None
    slow_mode_seconds: Optional[int] = None

    @field_validator("slow_mode_seconds")
    @classmethod
    def validate_slow_mode_seconds(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return value
        if value not in SLOW_MODE_OPTIONS:
            raise ValueError("Недопустимое значение медленного режима")
        return value

class VoiceChannelUpdate(BaseModel):
    name: Optional[str] = None
    position: Optional[int] = None
    max_users: Optional[int] = None
    bitrate: Optional[int] = None
    video_quality: Optional[str] = None

    @field_validator("max_users")
    @classmethod
    def validate_max_users(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return value
        if value < 0 or value > 99:
            raise ValueError("Лимит пользователей должен быть от 0 до 99")
        return value

    @field_validator("bitrate")
    @classmethod
    def validate_bitrate(cls, value: Optional[int]) -> Optional[int]:
        if value is None:
            return value
        if value < 8 or value > 96:
            raise ValueError("Битрейт должен быть от 8 до 96 кбит/с")
        return value

    @field_validator("video_quality")
    @classmethod
    def validate_video_quality(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        if value not in {"auto", "720p"}:
            raise ValueError("Качество видео: auto или 720p")
        return value

class TextChannel(TextChannelBase):
    id: int
    channel_id: int
    created_at: datetime

    class Config:
        from_attributes = True

class VoiceChannel(VoiceChannelBase):
    id: int
    channel_id: int
    created_at: datetime
    active_users_count: int = 0

    class Config:
        from_attributes = True

class Channel(ChannelBase):
    id: int
    owner_id: int
    is_public: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None
    owner: User
    text_channels: List[TextChannel] = []
    voice_channels: List[VoiceChannel] = []
    members_count: int = 0

    class Config:
        from_attributes = True

class ChannelMember(BaseModel):
    id: int
    channel_id: int
    user_id: int
    joined_at: datetime
    user: User

    class Config:
        from_attributes = True

class VoiceChannelUser(BaseModel):
    user_id: int
    is_muted: bool = False
    is_deafened: bool = False
    user: User

    class Config:
        from_attributes = True