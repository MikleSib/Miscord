from __future__ import annotations

import json
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.permissions import DEFAULT_PERMISSIONS, miscord_permissions_to_legacy
from app.models import (
    Channel,
    ChannelCategory,
    ChannelKind,
    ChannelMember,
    ChannelPermissionOverwrite,
    ForumSettings,
    ForumTag,
    OverwriteTargetType,
    Role,
    ServerNotificationSettings,
    TextChannel,
    VoiceChannel,
)
from app.services.realtime_events import enqueue_realtime_event
from app.services.notification_settings import DEFAULT_SETTINGS

RESOURCE_FILE = Path(__file__).resolve().parents[1] / "resources" / "server_templates.json"
SCHEMA_VERSION = 1


@lru_cache(maxsize=1)
def builtin_templates() -> list[dict[str, Any]]:
    return json.loads(RESOURCE_FILE.read_text(encoding="utf-8"))


def builtin_template(template_id: str) -> dict[str, Any] | None:
    plain_id = template_id.removeprefix("builtin:")
    return next((deepcopy(item) for item in builtin_templates() if item["id"] == plain_id), None)


def template_preview(template: dict[str, Any]) -> dict[str, Any]:
    definition = template["definition"]
    return {
        "id": template["id"],
        "name": template["name"],
        "description": template.get("description"),
        "icon": template.get("icon"),
        "schema_version": template.get("schema_version", SCHEMA_VERSION),
        "categories": deepcopy(definition.get("categories", [])),
        "channels": deepcopy(definition.get("channels", [])),
        "roles": deepcopy(definition.get("roles", [])),
    }


async def snapshot_server(db: AsyncSession, server: Channel) -> dict[str, Any]:
    categories = list((await db.execute(select(ChannelCategory).where(ChannelCategory.server_id == server.id).order_by(ChannelCategory.position, ChannelCategory.id))).scalars().all())
    roles = list((await db.execute(select(Role).where(Role.server_id == server.id, Role.managed_by_bot_application_id.is_(None)).order_by(Role.position, Role.id))).scalars().all())
    text_channels = list((await db.execute(select(TextChannel).where(TextChannel.channel_id == server.id, TextChannel.parent_id.is_(None), TextChannel.is_hidden.is_(False)).order_by(TextChannel.position, TextChannel.id))).scalars().all())
    voice_channels = list((await db.execute(select(VoiceChannel).where(VoiceChannel.channel_id == server.id).order_by(VoiceChannel.position, VoiceChannel.id))).scalars().all())
    overwrites = list((await db.execute(select(ChannelPermissionOverwrite).where(ChannelPermissionOverwrite.server_id == server.id))).scalars().all())

    category_keys = {item.id: f"category:{item.id}" for item in categories}
    role_keys = {item.id: ("everyone" if item.is_default else f"role:{item.id}") for item in roles}
    channel_keys: dict[tuple[str, int], str] = {}
    channels: list[dict[str, Any]] = []
    for item in text_channels:
        key = f"text:{item.id}"
        channel_keys[("text", item.id)] = key
        data = {
            "key": key,
            "type": item.kind if item.kind in {"text", "forum"} else "text",
            "name": item.name,
            "category_key": category_keys.get(item.category_id),
            "position": item.position,
            "slow_mode_seconds": item.slow_mode_seconds,
        }
        if item.kind == "forum":
            forum = await db.get(ForumSettings, item.id)
            tags = list((await db.execute(select(ForumTag).where(ForumTag.channel_id == item.id).order_by(ForumTag.position, ForumTag.id))).scalars().all())
            data["forum"] = {
                "guidelines": forum.guidelines if forum else None,
                "default_layout": forum.default_layout if forum else "list",
                "default_sort": forum.default_sort if forum else "latest_activity",
                "require_tag": bool(forum.require_tag) if forum else False,
                "auto_archive_minutes": forum.auto_archive_minutes if forum else 10080,
                "tags": [{"name": tag.name, "emoji": tag.emoji, "moderated": bool(tag.moderated)} for tag in tags],
            }
        channels.append(data)
    for item in voice_channels:
        key = f"voice:{item.id}"
        channel_keys[("voice", item.id)] = key
        channels.append({
            "key": key,
            "type": "voice",
            "name": item.name,
            "category_key": category_keys.get(item.category_id),
            "position": item.position,
            "bitrate": item.bitrate,
            "max_users": item.max_users,
            "video_quality": item.video_quality,
        })
    overwrite_data = []
    for item in overwrites:
        kind = item.channel_kind.value if hasattr(item.channel_kind, "value") else str(item.channel_kind)
        target_type = item.target_type.value if hasattr(item.target_type, "value") else str(item.target_type)
        if target_type != "role" or item.target_id not in role_keys:
            continue
        channel_key = channel_keys.get((kind, item.channel_id))
        if not channel_key:
            continue
        overwrite_data.append({
            "channel_key": channel_key,
            "target_role_key": role_keys[item.target_id],
            "allow": int(item.allow or 0),
            "deny": int(item.deny or 0),
        })
    return {
        "notification_defaults": dict(DEFAULT_SETTINGS),
        "roles": [
            {
                "key": role_keys[role.id],
                "name": role.name,
                "color": role.color,
                "position": role.position,
                "permissions": int(role.permissions or 0),
                "is_default": bool(role.is_default),
            }
            for role in roles
        ],
        "categories": [{"key": category_keys[item.id], "name": item.name, "position": item.position} for item in categories],
        "channels": channels,
        "overwrites": overwrite_data,
    }


def _validate_definition(definition: dict[str, Any]) -> None:
    if not isinstance(definition, dict):
        raise HTTPException(status_code=400, detail="Шаблон повреждён")
    limits = {"roles": 250, "categories": 100, "channels": 500, "overwrites": 10000}
    for key, limit in limits.items():
        value = definition.get(key, [])
        if not isinstance(value, list) or len(value) > limit:
            raise HTTPException(status_code=400, detail=f"Некорректный раздел шаблона: {key}")


async def instantiate_template(
    db: AsyncSession,
    *,
    definition: dict[str, Any],
    owner_id: int,
    name: str,
    description: str | None,
    icon: str | None,
) -> Channel:
    _validate_definition(definition)
    server = Channel(name=name, description=description, icon=icon, owner_id=owner_id, is_public=False)
    db.add(server)
    await db.flush()
    db.add(ChannelMember(channel_id=server.id, user_id=owner_id))
    notification_defaults = {**DEFAULT_SETTINGS, **dict(definition.get("notification_defaults") or {})}
    db.add(ServerNotificationSettings(
        server_id=server.id,
        user_id=owner_id,
        muted=bool(notification_defaults["muted"]),
        notification_level=str(notification_defaults["notification_level"]),
        suppress_everyone=bool(notification_defaults["suppress_everyone"]),
        suppress_roles=bool(notification_defaults["suppress_roles"]),
        suppress_highlights=bool(notification_defaults["suppress_highlights"]),
        mute_events=bool(notification_defaults["mute_events"]),
        mobile_push=bool(notification_defaults["mobile_push"]),
    ))

    role_ids: dict[str, int] = {}
    roles = list(definition.get("roles") or [])
    if not any(bool(item.get("is_default")) for item in roles):
        roles.insert(0, {"key": "everyone", "name": "@everyone", "is_default": True, "position": 0, "permissions": None})
    for item in roles:
        permissions = DEFAULT_PERMISSIONS if item.get("permissions") is None else int(item.get("permissions") or 0)
        role = Role(
            server_id=server.id,
            name=str(item.get("name") or "Роль")[:100],
            color=item.get("color"),
            position=int(item.get("position") or 0),
            permissions=permissions,
            legacy_permissions=miscord_permissions_to_legacy(permissions),
            is_default=bool(item.get("is_default")),
        )
        db.add(role)
        await db.flush()
        role_ids[str(item.get("key"))] = role.id

    category_ids: dict[str, int] = {}
    for item in definition.get("categories", []):
        category = ChannelCategory(server_id=server.id, name=str(item.get("name") or "Категория")[:100], position=int(item.get("position") or 0))
        db.add(category)
        await db.flush()
        category_ids[str(item.get("key"))] = category.id

    channel_ids: dict[str, tuple[str, int]] = {}
    for item in definition.get("channels", []):
        item_type = str(item.get("type") or "text")
        category_id = category_ids.get(str(item.get("category_key")))
        if item_type == "voice":
            channel = VoiceChannel(
                channel_id=server.id,
                name=str(item.get("name") or "Голосовой")[:100],
                category_id=category_id,
                position=int(item.get("position") or 0),
                bitrate=max(8, min(96, int(item.get("bitrate") or 64))),
                max_users=max(0, min(99, int(item.get("max_users") or 0))),
                video_quality=item.get("video_quality") if item.get("video_quality") in {"auto", "720p"} else "auto",
            )
            kind = "voice"
        else:
            kind = "forum" if item_type == "forum" else "text"
            channel = TextChannel(
                channel_id=server.id,
                name=str(item.get("name") or "текстовый")[:100],
                category_id=category_id,
                position=int(item.get("position") or 0),
                slow_mode_seconds=max(0, int(item.get("slow_mode_seconds") or 0)),
                kind=kind,
            )
        db.add(channel)
        await db.flush()
        channel_ids[str(item.get("key"))] = ("voice" if kind == "voice" else "text", channel.id)
        if kind == "forum":
            forum = item.get("forum") if isinstance(item.get("forum"), dict) else {}
            db.add(ForumSettings(
                channel_id=channel.id,
                guidelines=forum.get("guidelines"),
                default_layout=forum.get("default_layout") if forum.get("default_layout") in {"list", "gallery"} else "list",
                default_sort=forum.get("default_sort") if forum.get("default_sort") in {"latest_activity", "created_at"} else "latest_activity",
                require_tag=bool(forum.get("require_tag")),
                auto_archive_minutes=int(forum.get("auto_archive_minutes") or 10080),
            ))
            for position, tag in enumerate(list(forum.get("tags") or [])[:20]):
                db.add(ForumTag(channel_id=channel.id, name=str(tag.get("name") or "Тег")[:32], emoji=tag.get("emoji"), moderated=bool(tag.get("moderated")), position=position))

    for item in definition.get("overwrites", []):
        channel_ref = channel_ids.get(str(item.get("channel_key")))
        role_id = role_ids.get(str(item.get("target_role_key")))
        if not channel_ref or role_id is None:
            continue
        kind, channel_id = channel_ref
        allow, deny = int(item.get("allow") or 0), int(item.get("deny") or 0)
        db.add(ChannelPermissionOverwrite(
            server_id=server.id,
            channel_kind=ChannelKind.TEXT if kind == "text" else ChannelKind.VOICE,
            channel_id=channel_id,
            target_type=OverwriteTargetType.ROLE,
            target_id=role_id,
            allow=allow,
            deny=deny,
            legacy_allow=miscord_permissions_to_legacy(allow),
            legacy_deny=miscord_permissions_to_legacy(deny),
        ))
    enqueue_realtime_event(db, event_type="SERVER_CREATED", data={"server_id": server.id, "name": server.name}, topic="user", target_id=owner_id)
    return server
