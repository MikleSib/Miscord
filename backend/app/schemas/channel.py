from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List
from app.schemas.user import User

class ChannelBase(BaseModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None

class ChannelCreate(ChannelBase):
    pass

class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None

class TextChannelBase(BaseModel):
    name: str
    position: int = 0

class TextChannelCreate(TextChannelBase):
    channel_id: int

class TextChannelUpdate(BaseModel):
    name: Optional[str] = None
    slow_mode_seconds: Optional[int] = Field(None, ge=0, le=21600)  # 0-6 часов

class VoiceChannelBase(BaseModel):
    name: str
    position: int = 0
    max_users: int = 10

class VoiceChannelCreate(VoiceChannelBase):
    channel_id: int

class VoiceChannelUpdate(BaseModel):
    name: Optional[str] = None
    max_users: Optional[int] = Field(None, ge=1, le=99)  # 1-99 пользователей

class TextChannel(TextChannelBase):
    id: int
    channel_id: int
    is_hidden: bool = False
    slow_mode_seconds: int = 0
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