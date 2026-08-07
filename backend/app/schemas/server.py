from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


# --- Роли ---

class RoleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: Optional[str] = None
    permissions: int = 0


class RoleUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    color: Optional[str] = None
    permissions: Optional[int] = None


class RoleReorderRequest(BaseModel):
    """Порядок ролей сверху вниз: первый элемент — самая высокая роль."""

    role_ids: List[int]


# --- Участники ---

class MemberUpdate(BaseModel):
    nickname: Optional[str] = Field(default=None, max_length=64)


class TransferOwnershipRequest(BaseModel):
    user_id: int


# --- Баны ---

class BanCreate(BaseModel):
    user_id: int
    reason: Optional[str] = Field(default=None, max_length=512)
    delete_messages: bool = False


# --- Приглашения ---

class InviteCreate(BaseModel):
    max_age_seconds: Optional[int] = None  # None или 0 — бессрочно
    max_uses: Optional[int] = None  # None или 0 — без ограничений
    target_text_channel_id: Optional[int] = None


# --- Уведомления ---

class NotificationSettingsUpdate(BaseModel):
    muted: Optional[bool] = None
    notification_level: Optional[str] = Field(default=None, pattern="^(all|mentions|nothing)$")
    suppress_everyone: Optional[bool] = None
    suppress_roles: Optional[bool] = None
    suppress_highlights: Optional[bool] = None
    mute_events: Optional[bool] = None
    mobile_push: Optional[bool] = None


class ChannelNotificationOverrideUpdate(BaseModel):
    level: str = Field(pattern="^(all|mentions|nothing|muted)$")


class InvitePreview(BaseModel):
    code: str
    server_id: int
    server_name: str
    server_icon: Optional[str] = None
    server_description: Optional[str] = None
    members_count: int
    online_count: int
    inviter_name: Optional[str] = None
    is_expired: bool = False
    is_member: bool = False
    is_banned: bool = False
    expires_at: Optional[datetime] = None
