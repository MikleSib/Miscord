from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
import re

from app.core.permissions import ALL_PERMISSIONS, Permission


_COMMAND_NAME_RE = re.compile(r"^[\w-]{1,32}$")
_SUPPORTED_COMMAND_TYPES = {1, 2, 3, 4}
_INSTALL_SCOPES = {"bot", "applications.commands"}
_EVENT_WEBHOOK_TYPES = {
    "APPLICATION_AUTHORIZED",
    "APPLICATION_DEAUTHORIZED",
    "ENTITLEMENT_CREATE",
    "ENTITLEMENT_UPDATE",
    "ENTITLEMENT_DELETE",
    "QUEST_USER_ENROLLMENT",
    "LOBBY_MESSAGE_CREATE",
    "LOBBY_MESSAGE_UPDATE",
    "LOBBY_MESSAGE_DELETE",
    "GAME_DIRECT_MESSAGE_CREATE",
    "GAME_DIRECT_MESSAGE_UPDATE",
    "GAME_DIRECT_MESSAGE_DELETE",
}


def _normalize_install_params(value: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if value is None:
        return value
    normalized = dict(value)
    if "permissions" in normalized:
        try:
            permissions = int(normalized["permissions"])
        except (TypeError, ValueError) as exc:
            raise ValueError("install_params.permissions must be a decimal bitfield") from exc
        if permissions < 0 or permissions & ~int(ALL_PERMISSIONS):
            raise ValueError("install_params.permissions contains unsupported permission bits")
        if permissions & int(Permission.ADMINISTRATOR):
            permissions = int(Permission.ADMINISTRATOR)
        normalized["permissions"] = str(permissions)
    if "scopes" in normalized:
        scopes = normalized["scopes"]
        if not isinstance(scopes, list) or any(item not in _INSTALL_SCOPES for item in scopes):
            raise ValueError("install_params.scopes contains unsupported install scopes")
        normalized["scopes"] = list(dict.fromkeys(scopes))
    return normalized


def _normalize_integration_types_config(value: dict[str, Any]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for raw_key, raw_config in value.items():
        key = str(raw_key)
        if key not in {"0", "1"} or not isinstance(raw_config, dict):
            raise ValueError("integration_types_config keys must be 0 or 1")
        config = dict(raw_config)
        params = config.get("oauth2_install_params")
        if params is not None:
            normalized = _normalize_install_params(params)
            if key == "1" and normalized is not None:
                if normalized.get("scopes", ["applications.commands"]) != ["applications.commands"]:
                    raise ValueError("user installs only support applications.commands")
                normalized["permissions"] = "0"
            config["oauth2_install_params"] = normalized
        output[key] = config
    return output


class BotApplicationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    avatar_url: Optional[str] = Field(default=None, max_length=2048)
    banner_url: Optional[str] = Field(default=None, max_length=2048)
    bot_public: bool = True
    bot_require_code_grant: bool = False
    terms_of_service_url: Optional[str] = Field(default=None, max_length=2048)
    privacy_policy_url: Optional[str] = Field(default=None, max_length=2048)
    redirect_uris: list[str] = Field(default_factory=list, max_length=10)
    interactions_endpoint_url: Optional[str] = Field(default=None, max_length=2048)
    event_webhooks_url: Optional[str] = Field(default=None, max_length=2048)
    event_webhooks_types: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list, max_length=5)
    custom_install_url: Optional[str] = Field(default=None, max_length=2048)
    install_params: Optional[dict[str, Any]] = None
    integration_types_config: dict[str, Any] = Field(default_factory=dict)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Application name cannot be empty")
        return value

    @field_validator(
        "description",
        "avatar_url",
        "banner_url",
        "terms_of_service_url",
        "privacy_policy_url",
        "interactions_endpoint_url",
        "event_webhooks_url",
        "custom_install_url",
    )
    @classmethod
    def clean_optional(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @field_validator("redirect_uris")
    @classmethod
    def clean_redirect_uris(cls, value: list[str]) -> list[str]:
        output = []
        for item in value:
            cleaned = item.strip()
            if cleaned and cleaned not in output:
                output.append(cleaned)
        return output

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: list[str]) -> list[str]:
        output = []
        for item in value:
            cleaned = item.strip().lower()
            if cleaned and cleaned not in output:
                output.append(cleaned[:20])
        return output[:5]

    @field_validator("event_webhooks_types")
    @classmethod
    def clean_event_webhooks_types(cls, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(item.strip().upper() for item in value if item.strip()))
        if any(item not in _EVENT_WEBHOOK_TYPES for item in normalized):
            raise ValueError("event_webhooks_types contains an unsupported event")
        return normalized

    @field_validator("install_params")
    @classmethod
    def normalize_install_params(cls, value: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
        return _normalize_install_params(value)

    @field_validator("integration_types_config")
    @classmethod
    def normalize_integration_types_config(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _normalize_integration_types_config(value)


class BotApplicationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    avatar_url: Optional[str] = Field(default=None, max_length=2048)
    banner_url: Optional[str] = Field(default=None, max_length=2048)
    bot_public: Optional[bool] = None
    bot_require_code_grant: Optional[bool] = None
    terms_of_service_url: Optional[str] = Field(default=None, max_length=2048)
    privacy_policy_url: Optional[str] = Field(default=None, max_length=2048)
    redirect_uris: Optional[list[str]] = Field(default=None, max_length=10)
    interactions_endpoint_url: Optional[str] = Field(default=None, max_length=2048)
    event_webhooks_url: Optional[str] = Field(default=None, max_length=2048)
    event_webhooks_types: Optional[list[str]] = None
    tags: Optional[list[str]] = Field(default=None, max_length=5)
    custom_install_url: Optional[str] = Field(default=None, max_length=2048)
    install_params: Optional[dict[str, Any]] = None
    integration_types_config: Optional[dict[str, Any]] = None
    flags: Optional[int] = Field(default=None, ge=0)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Application name cannot be empty")
        return value

    @field_validator(
        "description",
        "avatar_url",
        "banner_url",
        "terms_of_service_url",
        "privacy_policy_url",
        "interactions_endpoint_url",
        "event_webhooks_url",
        "custom_install_url",
    )
    @classmethod
    def clean_optional_string(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("redirect_uris")
    @classmethod
    def clean_redirect_uris(cls, value: Optional[list[str]]) -> Optional[list[str]]:
        if value is None:
            return None
        return list(dict.fromkeys(item.strip() for item in value if item.strip()))

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: Optional[list[str]]) -> Optional[list[str]]:
        if value is None:
            return None
        return list(dict.fromkeys(item.strip().lower()[:20] for item in value if item.strip()))[:5]

    @field_validator("event_webhooks_types")
    @classmethod
    def clean_event_webhooks_types(cls, value: Optional[list[str]]) -> Optional[list[str]]:
        if value is None:
            return None
        normalized = list(dict.fromkeys(item.strip().upper() for item in value if item.strip()))
        if any(item not in _EVENT_WEBHOOK_TYPES for item in normalized):
            raise ValueError("event_webhooks_types contains an unsupported event")
        return normalized

    @field_validator("install_params")
    @classmethod
    def normalize_install_params(cls, value: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
        return _normalize_install_params(value)

    @field_validator("integration_types_config")
    @classmethod
    def normalize_integration_types_config(cls, value: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
        return _normalize_integration_types_config(value) if value is not None else None


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
    banner_url: Optional[str]
    public_key: str
    bot_public: bool
    bot_require_code_grant: bool
    terms_of_service_url: Optional[str]
    privacy_policy_url: Optional[str]
    redirect_uris: list[str]
    interactions_endpoint_url: Optional[str]
    event_webhooks_url: Optional[str]
    event_webhooks_status: int
    event_webhooks_types: list[str]
    tags: list[str]
    install_params: Optional[dict[str, Any]]
    integration_types_config: dict[str, Any]
    custom_install_url: Optional[str]
    flags: int
    status: str
    created_at: datetime
    updated_at: datetime
    bot: BotIdentityResponse


class BotApplicationCreatedResponse(BaseModel):
    application: BotApplicationResponse
    bot_token: str
    client_secret: str


class BotTokenResetResponse(BaseModel):
    bot_token: str
    rotation_id: int


class BotClientSecretResetResponse(BaseModel):
    client_secret: str
    rotation_id: int


class BotPrincipalResponse(BaseModel):
    application: BotApplicationResponse


class BotCommandDefinition(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    description: str = Field(default="", max_length=100)
    type: int = 1
    definition: dict[str, Any] = Field(default_factory=dict)
    server_id: int | None = None
    default_member_permissions: int | None = None
    dm_permission: bool = True
    allowed_user_ids: list[int] = Field(default_factory=list)
    allowed_role_ids: list[int] = Field(default_factory=list)
    name_localizations: dict[str, str] | None = None
    description_localizations: dict[str, str] | None = None
    contexts: list[int] | None = None
    integration_types: list[int] | None = None
    nsfw: bool = False
    model_config = ConfigDict(extra="forbid")

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("command name cannot be empty")
        return value

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: int) -> int:
        if value not in _SUPPORTED_COMMAND_TYPES:
            raise ValueError("command type must be between 1 and 4")
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

    @field_validator("contexts")
    @classmethod
    def validate_contexts(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and any(item not in {0, 1, 2} for item in value):
            raise ValueError("contexts can only contain 0, 1 or 2")
        return list(dict.fromkeys(value)) if value is not None else None

    @field_validator("integration_types")
    @classmethod
    def validate_integration_types(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and any(item not in {0, 1} for item in value):
            raise ValueError("integration_types can only contain 0 or 1")
        return list(dict.fromkeys(value)) if value is not None else None

    @model_validator(mode="after")
    def validate_shape(self):
        if self.type == 1:
            self.name = self.name.lower()
            if not _COMMAND_NAME_RE.fullmatch(self.name) or not self.description:
                raise ValueError("CHAT_INPUT commands require a lowercase name and description")
        elif self.type in {2, 3} and self.description:
            raise ValueError("USER and MESSAGE command descriptions must be empty")
        return self


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
    name_localizations: dict[str, str] | None = None
    description_localizations: dict[str, str] | None = None
    contexts: list[int] | None = None
    integration_types: list[int] | None = None
    nsfw: bool | None = None
    model_config = ConfigDict(extra="forbid")

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip()

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: int | None) -> int | None:
        if value is None:
            return None
        if value not in _SUPPORTED_COMMAND_TYPES:
            raise ValueError("command type must be between 1 and 4")
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

    @field_validator("contexts")
    @classmethod
    def validate_contexts(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and any(item not in {0, 1, 2} for item in value):
            raise ValueError("contexts can only contain 0, 1 or 2")
        return list(dict.fromkeys(value)) if value is not None else None

    @field_validator("integration_types")
    @classmethod
    def validate_integration_types(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and any(item not in {0, 1} for item in value):
            raise ValueError("integration_types can only contain 0 or 1")
        return list(dict.fromkeys(value)) if value is not None else None

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
    type: int = Field(ge=1, le=12)
    data: dict[str, Any] | None = None

    @field_validator("type")
    @classmethod
    def validate_callback_type(cls, value: int) -> int:
        if value == 10 or value == 11:
            raise ValueError("interaction callback type is deprecated or unsupported")
        return value


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
