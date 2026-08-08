from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class BotApplicationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    avatar_url: Optional[str] = Field(default=None, max_length=2048)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Application name cannot be empty")
        return value

    @field_validator("description", "avatar_url")
    @classmethod
    def clean_optional(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None


class BotApplicationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    avatar_url: Optional[str] = Field(default=None, max_length=2048)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Application name cannot be empty")
        return value


class BotIdentityResponse(BaseModel):
    id: int
    username: str
    display_name: Optional[str]
    avatar_url: Optional[str]
    is_bot: bool

    model_config = ConfigDict(from_attributes=True)


class BotApplicationResponse(BaseModel):
    id: int
    client_id: str
    name: str
    description: Optional[str]
    avatar_url: Optional[str]
    public_key: str
    status: str
    created_at: datetime
    updated_at: datetime
    bot: BotIdentityResponse


class BotApplicationCreatedResponse(BaseModel):
    application: BotApplicationResponse
    bot_token: str


class BotTokenResetResponse(BaseModel):
    bot_token: str
    rotation_id: int


class BotPrincipalResponse(BaseModel):
    application: BotApplicationResponse
