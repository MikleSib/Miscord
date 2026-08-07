from typing import Literal, Optional

from pydantic import BaseModel, Field


class ChannelPermissionOverwriteBase(BaseModel):
    target_type: Literal["role", "member"]
    target_id: int
    allow: int = 0
    deny: int = 0


class ChannelPermissionOverwriteUpsert(ChannelPermissionOverwriteBase):
    pass


class ChannelPermissionOverwriteResponse(ChannelPermissionOverwriteBase):
    id: int
    target_name: str
    target_color: Optional[str] = None
    target_avatar_url: Optional[str] = None
    is_default_role: bool = False


class ChannelPermissionOverwriteListResponse(BaseModel):
    overwrites: list[ChannelPermissionOverwriteResponse] = Field(default_factory=list)


class ChannelPermissionCatalogItem(BaseModel):
    key: str
    value: int
    label: str
    description: str
    group: str = "general"


class ChannelPermissionCatalogResponse(BaseModel):
    permissions: list[ChannelPermissionCatalogItem]
    groups: list[dict[str, str]] = []
