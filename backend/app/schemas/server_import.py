from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field, field_validator


class TemplateImportRequest(BaseModel):
    template: str = Field(min_length=2, max_length=512)
    snapshot: dict[str, Any] | None = None


class OAuthImportRequest(BaseModel):
    server_id: str = Field(min_length=17, max_length=20, pattern=r"^\d+$")


class CreateImportedServerRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    icon: str | None = Field(default=None, max_length=2048)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Название сервера не может быть пустым")
        return cleaned
