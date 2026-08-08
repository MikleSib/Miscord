from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


_CHAT_INPUT_NAME = re.compile(r"^[\w-]{1,32}$", re.UNICODE)
_COMMAND_TYPES = {1, 2, 3, 4}
_OPTION_TYPES = set(range(1, 12))
_INTERACTION_CALLBACK_TYPES = {1, 4, 5, 6, 7, 8, 9, 12}


def _validate_command_options(options: list[dict[str, Any]], *, depth: int = 0) -> list[dict[str, Any]]:
    if len(options) > 25:
        raise ValueError("options must contain at most 25 items")
    seen: set[str] = set()
    optional_seen = False
    for option in options:
        if not isinstance(option, dict):
            raise ValueError("each option must be an object")
        option_type = option.get("type")
        if option_type not in _OPTION_TYPES:
            raise ValueError("option type must be between 1 and 11")
        name = str(option.get("name") or "").strip()
        if not _CHAT_INPUT_NAME.fullmatch(name) or name.lower() != name:
            raise ValueError("option name must be 1-32 lowercase characters")
        if name in seen:
            raise ValueError("option names must be unique")
        seen.add(name)
        description = str(option.get("description") or "")
        if not 1 <= len(description) <= 100:
            raise ValueError("option description must be 1-100 characters")
        required = bool(option.get("required", False))
        if optional_seen and required:
            raise ValueError("required options must be listed before optional options")
        optional_seen = optional_seen or not required
        choices = option.get("choices")
        if choices is not None:
            if option_type not in {3, 4, 10} or not isinstance(choices, list) or len(choices) > 25:
                raise ValueError("choices are invalid for this option")
            if option.get("autocomplete"):
                raise ValueError("autocomplete and choices are mutually exclusive")
        nested = option.get("options")
        if nested is not None:
            if option_type not in {1, 2} or depth >= 1 or not isinstance(nested, list):
                raise ValueError("nested options are only valid for subcommands and groups")
            _validate_command_options(nested, depth=depth + 1)
    return options


class MiscordApplicationCommandPayload(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    name_localizations: dict[str, str] | None = None
    description: str = Field(default="", max_length=100)
    description_localizations: dict[str, str] | None = None
    options: list[dict[str, Any]] = Field(default_factory=list, max_length=25)
    default_member_permissions: str | int | None = None
    dm_permission: bool | None = None
    default_permission: bool | None = None
    nsfw: bool = False
    integration_types: list[int] | None = None
    contexts: list[int] | None = None
    type: int = 1
    handler: int | None = None
    model_config = ConfigDict(extra="forbid")

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: int) -> int:
        if value not in _COMMAND_TYPES:
            raise ValueError("command type must be between 1 and 4")
        return value

    @field_validator("options")
    @classmethod
    def validate_options(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return _validate_command_options(value)

    @field_validator("default_member_permissions")
    @classmethod
    def validate_permissions(cls, value: str | int | None) -> str | None:
        if value is None:
            return None
        try:
            parsed = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("default_member_permissions must be an integer string") from exc
        if parsed < 0:
            raise ValueError("default_member_permissions must not be negative")
        return str(parsed)

    @field_validator("integration_types")
    @classmethod
    def validate_integration_types(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and any(item not in {0, 1} for item in value):
            raise ValueError("integration_types can only contain 0 or 1")
        return list(dict.fromkeys(value)) if value is not None else None

    @field_validator("contexts")
    @classmethod
    def validate_contexts(cls, value: list[int] | None) -> list[int] | None:
        if value is not None and any(item not in {0, 1, 2} for item in value):
            raise ValueError("contexts can only contain 0, 1 or 2")
        return list(dict.fromkeys(value)) if value is not None else None

    @model_validator(mode="after")
    def validate_command_shape(self):
        cleaned = self.name.strip()
        if self.type == 1:
            if not _CHAT_INPUT_NAME.fullmatch(cleaned) or cleaned.lower() != cleaned:
                raise ValueError("CHAT_INPUT command names must be lowercase")
            if not 1 <= len(self.description) <= 100:
                raise ValueError("CHAT_INPUT command description must be 1-100 characters")
        elif self.type in {2, 3}:
            if self.description:
                raise ValueError("USER and MESSAGE command descriptions must be empty")
            if self.options:
                raise ValueError("USER and MESSAGE commands cannot have options")
        elif self.type == 4 and self.handler not in {1, 2}:
            raise ValueError("PRIMARY_ENTRY_POINT commands require a valid handler")
        self.name = cleaned
        return self


def _validate_components(components: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(components) > 5:
        raise ValueError("components must contain at most 5 top-level items")
    custom_ids: set[str] = set()

    def visit(component: dict[str, Any], *, in_row: bool = False) -> None:
        if not isinstance(component, dict):
            raise ValueError("each component must be an object")
        component_type = int(component.get("type") or 0)
        if component_type < 1 or component_type > 19:
            raise ValueError("unknown component type")
        custom_id = component.get("custom_id")
        if custom_id is not None:
            if not isinstance(custom_id, str) or not 1 <= len(custom_id) <= 100:
                raise ValueError("component custom_id must be 1-100 characters")
            if custom_id in custom_ids:
                raise ValueError("component custom_id values must be unique")
            custom_ids.add(custom_id)
        if component_type == 1:
            children = component.get("components")
            if in_row or not isinstance(children, list) or not 1 <= len(children) <= 5:
                raise ValueError("action rows require 1-5 child components")
            for child in children:
                visit(child, in_row=True)
        elif component_type == 2:
            style = int(component.get("style") or 0)
            if style not in {1, 2, 3, 4, 5, 6}:
                raise ValueError("button style is invalid")
            if style == 5 and not component.get("url"):
                raise ValueError("link buttons require url")
            if style not in {5, 6} and not custom_id:
                raise ValueError("interactive buttons require custom_id")
        elif component_type == 3:
            options = component.get("options")
            if not isinstance(options, list) or not 1 <= len(options) <= 25:
                raise ValueError("string select menus require 1-25 options")

    for item in components:
        visit(item)
    return components


def _validate_modal(data: dict[str, Any]) -> None:
    title = str(data.get("title") or "")
    custom_id = data.get("custom_id")
    components = data.get("components")
    if not 1 <= len(title) <= 45:
        raise ValueError("modal title must be 1-45 characters")
    if not isinstance(custom_id, str) or not 1 <= len(custom_id) <= 100:
        raise ValueError("modal custom_id must be 1-100 characters")
    if not isinstance(components, list) or not 1 <= len(components) <= 5:
        raise ValueError("modal must contain 1-5 action rows")
    seen: set[str] = set()
    for row in components:
        if not isinstance(row, dict) or int(row.get("type") or 0) != 1:
            raise ValueError("modal components must be action rows")
        children = row.get("components")
        if not isinstance(children, list) or len(children) != 1:
            raise ValueError("each modal action row must contain one text input")
        text_input = children[0]
        if not isinstance(text_input, dict) or int(text_input.get("type") or 0) != 4:
            raise ValueError("modal action rows must contain text inputs")
        input_id = text_input.get("custom_id")
        if not isinstance(input_id, str) or not 1 <= len(input_id) <= 100 or input_id in seen:
            raise ValueError("modal text input custom_id values must be unique and 1-100 characters")
        seen.add(input_id)
        if int(text_input.get("style") or 0) not in {1, 2}:
            raise ValueError("modal text input style must be 1 or 2")
        if not 1 <= len(str(text_input.get("label") or "")) <= 45:
            raise ValueError("modal text input label must be 1-45 characters")
        minimum = int(text_input.get("min_length") or 0)
        maximum = int(text_input.get("max_length") or 4000)
        if not 0 <= minimum <= maximum <= 4000:
            raise ValueError("modal text input length constraints are invalid")


class MiscordMessageCreate(BaseModel):
    content: str | None = Field(default=None, max_length=2000)
    nonce: str | int | None = None
    tts: bool = False
    embeds: list[dict[str, Any]] = Field(default_factory=list, max_length=10)
    allowed_mentions: dict[str, Any] | None = None
    message_reference: dict[str, Any] | None = None
    components: list[dict[str, Any]] = Field(default_factory=list, max_length=5)
    sticker_ids: list[str] = Field(default_factory=list, max_length=3)
    flags: int = 0
    poll: dict[str, Any] | None = None
    enforce_nonce: bool = False
    model_config = ConfigDict(extra="forbid")

    @field_validator("components")
    @classmethod
    def validate_components(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return _validate_components(value)

    @model_validator(mode="after")
    def validate_content(self):
        if not (self.content and self.content.strip()) and not self.embeds and not self.components and not self.poll and not self.sticker_ids:
            raise ValueError("message must contain content, embeds, components, stickers, or a poll")
        return self


class MiscordMessageUpdate(BaseModel):
    content: str | None = Field(default=None, max_length=2000)
    embeds: list[dict[str, Any]] | None = Field(default=None, max_length=10)
    flags: int | None = None
    allowed_mentions: dict[str, Any] | None = None
    components: list[dict[str, Any]] | None = Field(default=None, max_length=5)
    model_config = ConfigDict(extra="forbid")

    @field_validator("components")
    @classmethod
    def validate_components(cls, value: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
        return _validate_components(value) if value is not None else None


class MiscordInteractionCallback(BaseModel):
    type: int
    data: dict[str, Any] | None = None
    model_config = ConfigDict(extra="forbid")

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: int) -> int:
        if value not in _INTERACTION_CALLBACK_TYPES:
            raise ValueError("unsupported interaction callback type")
        return value

    @model_validator(mode="after")
    def validate_callback_data(self):
        data = self.data or {}
        if self.type in {4, 5, 7}:
            components = data.get("components")
            if components is not None:
                if not isinstance(components, list):
                    raise ValueError("components must be an array")
                _validate_components(components)
        elif self.type == 8:
            choices = data.get("choices")
            if not isinstance(choices, list) or len(choices) > 25:
                raise ValueError("autocomplete responses require at most 25 choices")
        elif self.type == 9:
            _validate_modal(data)
        return self


class ClientInteractionCreate(BaseModel):
    application_id: str
    command_id: str
    command_type: int = 1
    data: dict[str, Any] = Field(default_factory=dict)
    model_config = ConfigDict(extra="forbid")
