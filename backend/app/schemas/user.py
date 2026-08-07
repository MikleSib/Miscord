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
    email: Optional[EmailStr] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    password: Optional[str] = None

    @field_validator("avatar_url")
    @classmethod
    def avatar_must_be_local(cls, value: Optional[str]) -> Optional[str]:
        if value is None or value == "":
            return None
        # Только свои загруженные файлы — не произвольный URL
        if value.startswith("/static/uploads/") or "/static/uploads/" in value:
            return value
        raise ValueError("avatar_url должен указывать на /static/uploads/")

    @field_validator("password")
    @classmethod
    def password_strength(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if len(value) < 8:
            raise ValueError("Пароль должен быть не короче 8 символов")
        return value

class User(UserBase):
    id: int
    is_active: bool
    is_online: bool
    avatar_url: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
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
