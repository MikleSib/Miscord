from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _https_url(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    if len(value) > 2048 or urlparse(value).scheme.lower() != "https":
        raise ValueError("URL must use HTTPS and be no longer than 2048 characters")
    return value


def _https_or_attachment_url(value: Optional[str]) -> Optional[str]:
    if value is None or value.startswith("attachment://"):
        return value
    return _https_url(value)


class EmbedFooter(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=2048)
    icon_url: Optional[str] = None
    _validate_icon = field_validator("icon_url")(_https_or_attachment_url)


class EmbedMedia(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=2048)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        if value.startswith("attachment://"):
            return value
        return _https_url(value) or value


class EmbedAuthor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=256)
    url: Optional[str] = None
    icon_url: Optional[str] = None
    _validate_url = field_validator("url")(_https_url)
    _validate_icon = field_validator("icon_url")(_https_or_attachment_url)


class EmbedField(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=256)
    value: str = Field(min_length=1, max_length=1024)
    inline: bool = False


class RichEmbed(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = Field(default=None, max_length=256)
    description: Optional[str] = Field(default=None, max_length=4096)
    url: Optional[str] = None
    timestamp: Optional[datetime] = None
    color: Optional[int] = Field(default=None, ge=0, le=0xFFFFFF)
    footer: Optional[EmbedFooter] = None
    image: Optional[EmbedMedia] = None
    thumbnail: Optional[EmbedMedia] = None
    author: Optional[EmbedAuthor] = None
    fields: list[EmbedField] = Field(default_factory=list, max_length=25)
    _validate_url = field_validator("url")(_https_url)

    @model_validator(mode="after")
    def has_content(self):
        if not any((self.title, self.description, self.fields, self.footer, self.image, self.thumbnail, self.author)):
            raise ValueError("Embed must contain visible content")
        return self


class AllowedMentions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parse: list[Literal["users"]] = Field(default_factory=list, max_length=1)
    users: list[int] = Field(default_factory=list, max_length=100)


class AttachmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int = Field(ge=0)
    filename: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = Field(default=None, max_length=1024)


class WebhookExecute(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: Optional[str] = Field(default=None, max_length=2000)
    username: Optional[str] = Field(default=None, min_length=1, max_length=80)
    avatar_url: Optional[str] = None
    embeds: list[RichEmbed] = Field(default_factory=list, max_length=10)
    allowed_mentions: AllowedMentions = Field(default_factory=AllowedMentions)
    flags: int = Field(default=0, ge=0)
    attachments: list[AttachmentRequest] = Field(default_factory=list, max_length=10)
    _validate_avatar = field_validator("avatar_url")(_https_url)

    @model_validator(mode="after")
    def validate_payload(self):
        if self.flags & ~(4 | 4096):
            raise ValueError("Only SUPPRESS_EMBEDS and SUPPRESS_NOTIFICATIONS flags are supported")
        total = 0
        for embed in self.embeds:
            total += len((embed.title or "").strip()) + len((embed.description or "").strip())
            total += len((embed.footer.text if embed.footer else "").strip())
            total += len((embed.author.name if embed.author else "").strip())
            total += sum(len(field.name.strip()) + len(field.value.strip()) for field in embed.fields)
        if total > 6000:
            raise ValueError("The combined embed text may not exceed 6000 characters")
        return self


class WebhookCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    avatar_url: Optional[str] = None
    _validate_avatar = field_validator("avatar_url")(_https_url)


class WebhookUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    avatar_url: Optional[str] = None
    channel_id: Optional[int] = None
    _validate_avatar = field_validator("avatar_url")(_https_url)


class WebhookTokenUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    avatar_url: Optional[str] = None
    _validate_avatar = field_validator("avatar_url")(_https_url)
