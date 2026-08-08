from typing import Any, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator

class BotInstallRequest(BaseModel):
    client_id: str = Field(min_length=32, max_length=32)
    server_id: int = Field(gt=0)
    scope: str = "bot"
    permissions: int = Field(default=0, ge=0)
    model_config = ConfigDict(extra="forbid")

class BotMessageCreate(BaseModel):
    content: Optional[str] = Field(default=None, max_length=2000)
    embeds: list[dict[str, Any]] = Field(default_factory=list, max_length=10)
    allowed_mentions: Optional[dict[str, Any]] = None
    flags: int = 0
    client_nonce: Optional[str] = Field(default=None, min_length=1, max_length=36)
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_message(self):
        if not (self.content and self.content.strip()) and not self.embeds:
            raise ValueError("content or embeds is required")
        return self

class BotMessageUpdate(BaseModel):
    content: Optional[str] = Field(default=None, max_length=2000)
    embeds: Optional[list[dict[str, Any]]] = Field(default=None, max_length=10)
    allowed_mentions: Optional[dict[str, Any]] = None
    flags: Optional[int] = None
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_update(self):
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        return self
