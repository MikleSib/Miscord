from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Optional
from datetime import datetime

class UserBase(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    email: EmailStr
    display_name: Optional[str] = None

class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)

class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None

    @field_validator("avatar_url")
    @classmethod
    def avatar_must_be_local(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return None
        # Только свои загруженные файлы — не произвольный URL
        if (
            value.startswith("/static/uploads/")
            or "/static/uploads/" in value
            or value.startswith("/api/v1/media/")
        ):
            return value
        raise ValueError("avatar_url должен указывать на /static/uploads/")

class PublicUser(BaseModel):
    id: int
    username: str
    display_name: Optional[str] = None
    is_active: bool
    is_bot: bool = False
    is_online: bool
    avatar_url: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class User(UserBase):
    id: int
    is_active: bool
    is_bot: bool = False
    is_online: bool
    avatar_url: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    email_verified_at: datetime
    request_id: Optional[int] = None # Для входящих запросов в друзья
    friendship_created_at: Optional[datetime] = None
    last_message_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str

class TokenData(BaseModel):
    user_id: Optional[int] = None
