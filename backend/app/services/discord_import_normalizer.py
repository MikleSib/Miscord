from __future__ import annotations

from typing import Any

from app.core.permissions import ALL_PERMISSIONS

TEXT_TYPES = {0, 5}
VOICE_TYPES = {2, 13}
FORUM_TYPES = {15, 16}
CATEGORY_TYPE = 4
REQUIRE_TAG = 1 << 4


def _integer(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _key(prefix: str, value: Any) -> str:
    return f"{prefix}:{value}"


def _role_color(value: Any) -> str | None:
    color = _integer(value)
    return f"#{color:06x}" if color > 0 else None


def _overwrite_map(items: Any, role_keys: dict[str, str], warnings: list[str]) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        if _integer(item.get("type"), -1) != 0:
            warning = "Персональные права участников не переносятся без переноса аккаунтов"
            if warning not in warnings:
                warnings.append(warning)
            continue
        external_role_id = str(item.get("id", ""))
        role_key = role_keys.get(external_role_id)
        if not role_key:
            continue
        output[role_key] = {
            "target_role_key": role_key,
            "allow": _integer(item.get("allow")) & ALL_PERMISSIONS,
            "deny": _integer(item.get("deny")) & ALL_PERMISSIONS,
        }
    return output


def _normalize_roles(source: dict[str, Any], warnings: list[str]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    raw_roles = [item for item in source.get("roles", []) if isinstance(item, dict)]
    raw_roles.sort(key=lambda item: (_integer(item.get("position")), str(item.get("id", ""))))
    roles: list[dict[str, Any]] = []
    role_keys: dict[str, str] = {}
    default_assigned = False
    for item in raw_roles:
        if item.get("managed"):
            if "Управляемые роли приложений пропущены" not in warnings:
                warnings.append("Управляемые роли приложений пропущены")
            continue
        external_id = str(item.get("id", ""))
        name = str(item.get("name") or "Роль")[:100]
        is_default = not default_assigned and (name == "@everyone" or _integer(item.get("position")) == 0)
        if is_default:
            default_assigned = True
        role_key = "everyone" if is_default else _key("role", external_id)
        role_keys[external_id] = role_key
        permissions = _integer(item.get("permissions"))
        unsupported = permissions & ~ALL_PERMISSIONS
        if unsupported and "Часть неподдерживаемых прав ролей была отброшена" not in warnings:
            warnings.append("Часть неподдерживаемых прав ролей была отброшена")
        roles.append({
            "key": role_key,
            "name": "@everyone" if is_default else name,
            "color": _role_color(item.get("color")),
            "position": _integer(item.get("position")),
            "permissions": permissions & ALL_PERMISSIONS,
            "is_default": is_default,
        })
    if not default_assigned:
        roles.insert(0, {
            "key": "everyone", "name": "@everyone", "color": None,
            "position": 0, "permissions": None, "is_default": True,
        })
    return roles, role_keys


def _forum_settings(item: dict[str, Any], warnings: list[str]) -> dict[str, Any]:
    tags = []
    for tag in item.get("available_tags", []) if isinstance(item.get("available_tags"), list) else []:
        if not isinstance(tag, dict):
            continue
        emoji = tag.get("emoji_name")
        if tag.get("emoji_id") and not emoji:
            if "Иконки тегов из пользовательских emoji требуют отдельного переноса медиа" not in warnings:
                warnings.append("Иконки тегов из пользовательских emoji требуют отдельного переноса медиа")
        tags.append({
            "name": str(tag.get("name") or "Тег")[:32],
            "emoji": str(emoji)[:128] if emoji else None,
            "moderated": bool(tag.get("moderated")),
        })
    layout = "gallery" if _integer(item.get("default_forum_layout")) == 2 else "list"
    sort = "created_at" if _integer(item.get("default_sort_order")) == 1 else "latest_activity"
    return {
        "guidelines": str(item.get("topic"))[:4096] if item.get("topic") else None,
        "default_layout": layout,
        "default_sort": sort,
        "require_tag": bool(_integer(item.get("flags")) & REQUIRE_TAG),
        "auto_archive_minutes": _integer(item.get("default_auto_archive_duration"), 10080),
        "tags": tags[:20],
    }


def normalize_discord_guild(source: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    roles, role_keys = _normalize_roles(source, warnings)
    raw_channels = [item for item in source.get("channels", []) if isinstance(item, dict)]
    raw_channels.sort(key=lambda item: (_integer(item.get("position")), str(item.get("id", ""))))
    categories: list[dict[str, Any]] = []
    category_keys: dict[str, str] = {}
    category_overwrites: dict[str, dict[str, dict[str, Any]]] = {}
    for item in raw_channels:
        if _integer(item.get("type"), -1) != CATEGORY_TYPE:
            continue
        external_id = str(item.get("id", ""))
        category_key = _key("category", external_id)
        category_keys[external_id] = category_key
        categories.append({
            "key": category_key,
            "name": str(item.get("name") or "Категория")[:100],
            "position": _integer(item.get("position")),
        })
        category_overwrites[external_id] = _overwrite_map(item.get("permission_overwrites"), role_keys, warnings)

    channels: list[dict[str, Any]] = []
    overwrites: list[dict[str, Any]] = []
    for item in raw_channels:
        item_type = _integer(item.get("type"), -1)
        if item_type == CATEGORY_TYPE:
            continue
        if item_type in TEXT_TYPES:
            target_type = "text"
            if item_type == 5 and "Каналы объявлений преобразованы в текстовые" not in warnings:
                warnings.append("Каналы объявлений преобразованы в текстовые")
        elif item_type in VOICE_TYPES:
            target_type = "voice"
            if item_type == 13 and "Сценические каналы преобразованы в голосовые" not in warnings:
                warnings.append("Сценические каналы преобразованы в голосовые")
        elif item_type in FORUM_TYPES:
            target_type = "forum"
            if item_type == 16 and "Медиа-каналы преобразованы в Forum" not in warnings:
                warnings.append("Медиа-каналы преобразованы в Forum")
        else:
            warning = f"Канал неподдерживаемого типа {item_type} пропущен"
            if warning not in warnings:
                warnings.append(warning)
            continue
        external_id = str(item.get("id", ""))
        channel_key = _key(target_type, external_id)
        parent_id = str(item.get("parent_id")) if item.get("parent_id") is not None else ""
        channel = {
            "key": channel_key,
            "type": target_type,
            "name": str(item.get("name") or "канал")[:100],
            "category_key": category_keys.get(parent_id),
            "position": _integer(item.get("position")),
            "slow_mode_seconds": max(0, _integer(item.get("rate_limit_per_user"))),
        }
        if target_type == "voice":
            channel.update({
                "bitrate": max(8, min(96, _integer(item.get("bitrate"), 64000) // 1000)),
                "max_users": max(0, min(99, _integer(item.get("user_limit")))),
                "video_quality": "720p" if _integer(item.get("video_quality_mode")) == 2 else "auto",
            })
        elif target_type == "forum":
            channel["forum"] = _forum_settings(item, warnings)
        elif item.get("topic"):
            if "Темы обычных текстовых каналов пока не поддерживаются Miscord" not in warnings:
                warnings.append("Темы обычных текстовых каналов пока не поддерживаются Miscord")
        if item.get("nsfw") and "Возрастные ограничения каналов пока не переносятся" not in warnings:
            warnings.append("Возрастные ограничения каналов пока не переносятся")
        channels.append(channel)
        merged = dict(category_overwrites.get(parent_id, {}))
        merged.update(_overwrite_map(item.get("permission_overwrites"), role_keys, warnings))
        for overwrite in merged.values():
            overwrites.append({"channel_key": channel_key, **overwrite})

    if source.get("emojis"):
        warnings.append("Пользовательские emoji будут доступны после включения импорта медиа")
    if source.get("stickers"):
        warnings.append("Стикеры будут доступны после включения импорта медиа")
    return {
        "notification_defaults": {},
        "roles": roles[:250],
        "categories": categories[:100],
        "channels": channels[:500],
        "overwrites": overwrites[:10000],
    }, warnings


def template_source(payload: dict[str, Any]) -> tuple[dict[str, Any], str | None, str]:
    source = payload.get("serialized_source_guild")
    if not isinstance(source, dict):
        raise ValueError("Template does not contain a guild snapshot")
    external_id = str(payload.get("source_guild_id") or "") or None
    name = str(source.get("name") or payload.get("name") or "Импортированный сервер")[:100]
    return source, external_id, name
