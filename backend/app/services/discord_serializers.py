from __future__ import annotations

from collections import Counter
from typing import Any

from app.services.attachment_storage import attachment_url


def discord_user(user) -> dict[str, Any]:
    return {
        "id": str(user.id),
        "username": user.username,
        "discriminator": "0",
        "global_name": user.display_name,
        "avatar": user.avatar_url,
        "bot": bool(getattr(user, "is_bot", False)),
        "system": False,
        "mfa_enabled": False,
        "banner": None,
        "accent_color": None,
        "locale": "ru",
        "verified": True,
        "email": None,
        "flags": 0,
        "premium_type": 0,
        "public_flags": 0,
        "avatar_decoration_data": None,
    }


def discord_role(role, *, guild_id: int | None = None) -> dict[str, Any]:
    role_id = guild_id if guild_id is not None and bool(role.is_default) else role.id
    try:
        color = int(str(role.color or "0").lstrip("#") or "0", 16)
    except ValueError:
        color = 0
    return {
        "id": str(role_id),
        "name": role.name,
        "color": color,
        "colors": {"primary_color": color, "secondary_color": None, "tertiary_color": None},
        "hoist": False,
        "icon": None,
        "unicode_emoji": None,
        "position": int(role.position or 0),
        "permissions": str(int(role.permissions or 0)),
        "managed": bool(role.managed_by_bot_application_id),
        "mentionable": False,
        "tags": ({"bot_id": str(role.managed_by_bot_application_id)} if role.managed_by_bot_application_id else None),
        "flags": 0,
    }


def discord_channel(channel, *, guild_id: int, overwrites: list[Any] | None = None) -> dict[str, Any]:
    channel_type = 0 if channel.__class__.__name__ == "TextChannel" else 2
    payload: dict[str, Any] = {
        "id": str(channel.id),
        "type": channel_type,
        "guild_id": str(guild_id),
        "position": int(channel.position or 0),
        "permission_overwrites": [
            {
                "id": str(item.target_id),
                "type": 0 if str(item.target_type.value if hasattr(item.target_type, "value") else item.target_type) == "role" else 1,
                "allow": str(int(item.allow or 0)),
                "deny": str(int(item.deny or 0)),
            }
            for item in (overwrites or [])
        ],
        "name": channel.name,
        "nsfw": False,
        "parent_id": None,
        "flags": 0,
    }
    if channel_type == 0:
        payload.update({"topic": None, "last_message_id": None, "rate_limit_per_user": int(channel.slow_mode_seconds or 0)})
    else:
        payload.update({
            "bitrate": int(channel.bitrate or 64) * 1000,
            "user_limit": int(channel.max_users or 0),
            "rtc_region": None,
            "video_quality_mode": 1 if getattr(channel, "video_quality", "auto") == "auto" else 2,
        })
    return payload


def discord_attachment(attachment) -> dict[str, Any]:
    filename = attachment.original_filename or "attachment"
    url = attachment_url(attachment.id, filename) if attachment.storage_key else attachment.file_url
    return {
        "id": str(attachment.id),
        "filename": filename,
        "description": attachment.description,
        "content_type": attachment.content_type or "application/octet-stream",
        "size": int(attachment.size_bytes or 0),
        "url": url,
        "proxy_url": url,
        "ephemeral": False,
    }


def discord_message(message, *, guild_id: int | None = None) -> dict[str, Any]:
    author = message.author
    if message.webhook_id is not None:
        author_payload = {
            "id": str(message.webhook_id),
            "username": message.webhook_name or "Webhook",
            "discriminator": "0000",
            "global_name": None,
            "avatar": message.webhook_avatar_url,
            "bot": True,
        }
    else:
        author_payload = discord_user(author)
    reaction_counts = Counter(item.emoji for item in (message.reactions or []))
    payload: dict[str, Any] = {
        "id": str(message.id),
        "channel_id": str(message.text_channel_id),
        "author": author_payload,
        "content": message.content or "",
        "timestamp": message.timestamp.isoformat() if message.timestamp else None,
        "edited_timestamp": message.timestamp.isoformat() if message.is_edited and message.timestamp else None,
        "tts": bool(getattr(message, "tts", False)),
        "mention_everyone": False,
        "mentions": [],
        "mention_roles": [],
        "mention_channels": [],
        "attachments": [discord_attachment(item) for item in (message.attachments or [])],
        "embeds": list(message.embeds or []),
        "reactions": [
            {"count": count, "count_details": {"burst": 0, "normal": count}, "me": False, "me_burst": False, "emoji": {"id": None, "name": emoji}, "burst_colors": []}
            for emoji, count in reaction_counts.items()
        ],
        "nonce": message.client_nonce,
        "pinned": False,
        "webhook_id": str(message.webhook_id) if message.webhook_id is not None else None,
        "type": int(getattr(message, "message_type", 0) or 0),
        "activity": None,
        "application": None,
        "application_id": str(message.application_id) if getattr(message, "application_id", None) else None,
        "message_reference": ({"message_id": str(message.reply_to_id), "channel_id": str(message.text_channel_id), "fail_if_not_exists": True} if message.reply_to_id else None),
        "flags": int(message.flags or 0),
        "referenced_message": discord_message(message.reply_to, guild_id=guild_id) if getattr(message, "reply_to", None) else None,
        "interaction_metadata": getattr(message, "interaction_metadata", None),
        "thread": None,
        "components": list(getattr(message, "components", None) or []),
        "sticker_items": [],
        "poll": getattr(message, "poll", None),
    }
    if guild_id is not None:
        payload["guild_id"] = str(guild_id)
    return payload


def discord_command(command, *, application_client_id: str) -> dict[str, Any]:
    definition = command.definition if isinstance(command.definition, dict) else {}
    payload: dict[str, Any] = {
        "id": str(command.id),
        "type": int(command.command_type or 1),
        "application_id": application_client_id,
        "name": command.name,
        "name_localizations": command.name_localizations,
        "description": command.description,
        "description_localizations": command.description_localizations,
        "options": list(definition.get("options") or []),
        "default_member_permissions": str(command.default_member_permissions) if command.default_member_permissions is not None else None,
        "dm_permission": bool(command.dm_permission),
        "default_permission": True,
        "nsfw": bool(command.nsfw),
        "integration_types": command.integration_types,
        "contexts": command.contexts,
        "version": str(command.version),
    }
    if command.server_id is not None:
        payload["guild_id"] = str(command.server_id)
    if definition.get("handler") is not None:
        payload["handler"] = definition["handler"]
    return payload
