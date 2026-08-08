from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
import re


_COMMAND_NAME_RE = re.compile(r"^[\w-]{1,32}$")
_SUPPORTED_COMMAND_TYPES = {1, 2, 3}


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


class BotCommandDefinition(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    description: str = Field(min_length=1, max_length=100)
    type: int = 1
    definition: dict[str, Any] = Field(default_factory=dict)
    server_id: int | None = None
    default_member_permissions: int | None = None
    dm_permission: bool = True
    allowed_user_ids: list[int] = Field(default_factory=list)
    allowed_role_ids: list[int] = Field(default_factory=list)
    model_config = ConfigDict(extra="forbid")

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip().lower()
        if not _COMMAND_NAME_RE.fullmatch(value):
            raise ValueError("command name must contain only a-z, 0-9, underscore and hyphen")
        return value

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: int) -> int:
        if value not in _SUPPORTED_COMMAND_TYPES:
            raise ValueError("command type must be 1 (CHAT_INPUT), 2 (USER) or 3 (MESSAGE)")
        return value

    @field_validator("definition")
    @classmethod
    def validate_definition(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise ValueError("command definition must be an object")
        if "response" in value and not isinstance(value["response"], dict):
            raise ValueError("command definition.response must be an object")
        if "options" in value and not isinstance(value["options"], list):
            raise ValueError("command definition.options must be an array")
        return value

    @field_validator("allowed_user_ids", "allowed_role_ids")
    @classmethod
    def validate_id_list(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            value = list(dict.fromkeys(value))
        return [item for item in value if isinstance(item, int) and item > 0]


class BotCommandCreate(BotCommandDefinition):
    pass


class BotCommandReplace(BotCommandDefinition):
    pass


class BotCommandUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=32)
    description: str | None = Field(default=None, max_length=100)
    type: int | None = None
    definition: dict[str, Any] | None = None
    server_id: int | None = None
    default_member_permissions: int | None = None
    dm_permission: bool | None = None
    allowed_user_ids: list[int] | None = None
    allowed_role_ids: list[int] | None = None
    is_enabled: bool | None = None
    model_config = ConfigDict(extra="forbid")

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip().lower()
        if not _COMMAND_NAME_RE.fullmatch(value):
            raise ValueError("command name must contain only a-z, 0-9, underscore and hyphen")
        return value

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value not in _SUPPORTED_COMMAND_TYPES:
            raise ValueError("command type must be 1 (CHAT_INPUT), 2 (USER) or 3 (MESSAGE)")
        return value

    @field_validator("definition")
    @classmethod
    def validate_definition(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        if value is None:
            return None
        if not isinstance(value, dict):
            raise ValueError("command definition must be an object")
        if "response" in value and not isinstance(value["response"], dict):
            raise ValueError("command definition.response must be an object")
        if "options" in value and not isinstance(value["options"], list):
            raise ValueError("command definition.options must be an array")
        return value

    @field_validator("allowed_user_ids", "allowed_role_ids")
    @classmethod
    def validate_id_list(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return None
        if len(value) != len(set(value)):
            value = list(dict.fromkeys(value))
        return [item for item in value if isinstance(item, int) and item > 0]

    @model_validator(mode="after")
    def ensure_payload(self):
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        return self


class BotCommandResponse(BaseModel):
    id: int
    application_id: int
    server_id: int | None
    name: str
    description: str
    type: int
    definition: dict[str, Any]
    default_member_permissions: int | None
    dm_permission: bool
    allowed_user_ids: list[int]
    allowed_role_ids: list[int]
    version: int
    is_enabled: bool
    created_at: datetime
    updated_at: datetime


class BotInteractionCallbackRequest(BaseModel):
    type: int = Field(ge=1, le=11)
    data: dict[str, Any] | None = None


class BotCommandDispatchRequest(BaseModel):
    type: int = 2
    id: str | None = None
    token: str | None = None
    guild_id: int | None = Field(default=None, ge=0)
    channel_id: int | None = Field(default=None, ge=0)
    data: dict[str, Any] = Field(default_factory=dict)
    member: dict[str, Any] | None = None
    user: dict[str, Any] | None = None
    model_config = ConfigDict(extra="forbid")


class BotCommandDispatchResponse(BaseModel):
    type: int
    data: dict[str, Any] | None = None
    interaction_id: str
    interaction_token: str
    application_id: int
    command_id: int | None = None
    guild_id: int | None = None
    channel_id: int | None = None
