from __future__ import annotations

import asyncio
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.discord_errors import ALREADY_ACKNOWLEDGED, DiscordAPIError, UNKNOWN_INTERACTION, UNKNOWN_MESSAGE
from app.models import BotApplication, BotInteraction, BotInteractionMessage, Message
from app.schemas.discord import DiscordInteractionCallback
from app.services.bot_event_dispatcher import dispatcher as bot_event_dispatcher
from app.services.discord_serializers import discord_message
from app.services.discord_snowflake import generate_snowflake
from app.websocket.connection_manager import manager


INITIAL_RESPONSE_SECONDS = 3
INTERACTION_TOKEN_MINUTES = 15
EPHEMERAL_FLAG = 1 << 6


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def load_interaction(
    db: AsyncSession,
    interaction_id: str,
    token: str,
    *,
    for_update: bool = False,
) -> BotInteraction:
    query = select(BotInteraction).where(
        BotInteraction.interaction_id == interaction_id,
        BotInteraction.interaction_token == token,
    )
    if for_update:
        query = query.with_for_update()
    result = await db.execute(query)
    interaction = result.scalar_one_or_none()
    if interaction is None or (aware(interaction.expires_at) and aware(interaction.expires_at) <= utcnow()):
        raise UNKNOWN_INTERACTION()
    return interaction


async def load_interaction_by_token(
    db: AsyncSession,
    application_client_id: str,
    token: str,
) -> tuple[BotInteraction, BotApplication]:
    result = await db.execute(
        select(BotInteraction, BotApplication)
        .join(BotApplication, BotApplication.id == BotInteraction.application_id)
        .where(
            BotApplication.client_id == application_client_id,
            BotInteraction.interaction_token == token,
        )
        .order_by(BotInteraction.id.desc())
    )
    row = result.first()
    if row is None:
        raise UNKNOWN_INTERACTION()
    interaction, application = row
    if aware(interaction.expires_at) and aware(interaction.expires_at) <= utcnow():
        raise UNKNOWN_INTERACTION()
    return interaction, application


async def load_response_message(db: AsyncSession, message_id: int) -> Message:
    result = await db.execute(
        select(Message)
        .options(
            selectinload(Message.author),
            selectinload(Message.attachments),
            selectinload(Message.reactions),
            selectinload(Message.reply_to).selectinload(Message.author),
            selectinload(Message.reply_to).selectinload(Message.attachments),
            selectinload(Message.reply_to).selectinload(Message.reactions),
        )
        .where(Message.id == message_id)
    )
    message = result.scalar_one_or_none()
    if message is None:
        raise UNKNOWN_MESSAGE()
    return message


async def _application(db: AsyncSession, interaction: BotInteraction) -> BotApplication:
    result = await db.execute(
        select(BotApplication).options(selectinload(BotApplication.bot_user)).where(BotApplication.id == interaction.application_id)
    )
    application = result.scalar_one_or_none()
    if application is None:
        raise UNKNOWN_INTERACTION()
    return application


async def _publish_message(db: AsyncSession, interaction: BotInteraction, message: Message) -> None:
    internal = bot_event_dispatcher.internal_message_payload(message)
    if message.ephemeral_user_id:
        await manager.send_to_user(message.ephemeral_user_id, {"type": "new_message", "data": internal})
    else:
        await manager.send_to_channel(message.text_channel_id, {"type": "new_message", "data": internal})
        await bot_event_dispatcher.dispatch_message_create(db, message)


async def _create_response_message(
    db: AsyncSession,
    interaction: BotInteraction,
    application: BotApplication,
    data: dict[str, Any],
    *,
    original: bool,
) -> Message:
    if interaction.channel_id is None:
        raise DiscordAPIError(400, 50035, "Interaction does not have a channel")
    flags = int(data.get("flags") or 0)
    ephemeral = bool(flags & EPHEMERAL_FLAG)
    message = Message(
        author_id=application.bot_user_id,
        text_channel_id=int(interaction.channel_id),
        content=str(data.get("content") or "")[:2000] or None,
        embeds=list(data.get("embeds") or [])[:10],
        components=list(data.get("components") or [])[:5],
        poll=data.get("poll") if isinstance(data.get("poll"), dict) else None,
        flags=flags,
        application_id=application.client_id,
        ephemeral_user_id=interaction.author_user_id if ephemeral else None,
        interaction_metadata={
            "id": interaction.interaction_id,
            "type": int(interaction.interaction_type or 2),
            "user": {"id": str(interaction.author_user_id)} if interaction.author_user_id else None,
            "authorizing_integration_owners": (interaction.request_payload or {}).get("authorizing_integration_owners", {}),
            "original_response_message_id": None,
            "interacted_message_id": (interaction.request_payload or {}).get("message", {}).get("id"),
        },
    )
    db.add(message)
    await db.flush()
    metadata = dict(message.interaction_metadata or {})
    metadata["original_response_message_id"] = str(
        message.id if original else (interaction.original_message_id or message.id)
    )
    message.interaction_metadata = metadata
    db.add(BotInteractionMessage(interaction_id=interaction.id, message_id=message.id, is_original=original))
    if original:
        interaction.original_message_id = message.id
        interaction.ephemeral = ephemeral
    await db.commit()
    loaded = await load_response_message(db, message.id)
    await _publish_message(db, interaction, loaded)
    return loaded


async def update_response_message(
    db: AsyncSession,
    interaction: BotInteraction,
    message: Message,
    data: dict[str, Any],
) -> Message:
    for key in ("content", "embeds", "components", "flags", "poll"):
        if key in data:
            value = data[key]
            if key == "content":
                value = str(value or "")[:2000] or None
            setattr(message, key, value)
    if "flags" in data:
        is_ephemeral = bool(int(message.flags or 0) & EPHEMERAL_FLAG)
        message.ephemeral_user_id = interaction.author_user_id if is_ephemeral else None
        if interaction.original_message_id == message.id:
            interaction.ephemeral = is_ephemeral
    message.is_edited = True
    await db.commit()
    loaded = await load_response_message(db, message.id)
    internal = bot_event_dispatcher.internal_message_payload(loaded)
    if loaded.ephemeral_user_id:
        await manager.send_to_user(loaded.ephemeral_user_id, {"type": "message_edited", "data": internal})
    else:
        await manager.send_to_channel(message.text_channel_id, {"type": "message_edited", "data": internal})
        await bot_event_dispatcher.dispatch_message_update(db, loaded)
    return loaded


async def apply_initial_callback(
    db: AsyncSession,
    interaction: BotInteraction,
    callback: DiscordInteractionCallback,
) -> Message | None:
    if interaction.responded:
        raise ALREADY_ACKNOWLEDGED()
    created_at = aware(interaction.created_at) or utcnow()
    if utcnow() > created_at + timedelta(seconds=INITIAL_RESPONSE_SECONDS):
        raise UNKNOWN_INTERACTION()
    application = await _application(db, interaction)
    data = callback.data or {}
    interaction.responded = True
    interaction.response_type = callback.type
    interaction.response_payload = {"type": callback.type, "data": data}
    interaction.acknowledged_at = utcnow()
    interaction.deferred = callback.type in {5, 6}
    if callback.type == 5:
        interaction.ephemeral = bool(int(data.get("flags") or 0) & EPHEMERAL_FLAG)

    message: Message | None = None
    if callback.type == 4:
        message = await _create_response_message(db, interaction, application, data, original=True)
    elif callback.type == 7:
        message_id = (interaction.request_payload or {}).get("message", {}).get("id")
        if message_id:
            source_message = await load_response_message(db, int(message_id))
            interaction.original_message_id = source_message.id
            interaction.ephemeral = bool(source_message.ephemeral_user_id)
            message = await update_response_message(db, interaction, source_message, data)
        else:
            message = await _create_response_message(db, interaction, application, data, original=True)
    elif callback.type == 6:
        message_id = (interaction.request_payload or {}).get("message", {}).get("id")
        if message_id:
            source_message = await load_response_message(db, int(message_id))
            interaction.original_message_id = source_message.id
            interaction.ephemeral = bool(source_message.ephemeral_user_id)
        await db.commit()
    elif callback.type == 9 and interaction.author_user_id:
        await db.commit()
        await manager.send_to_user(interaction.author_user_id, {
            "type": "interaction_modal",
            "data": {
                "interaction_id": interaction.interaction_id,
                "application_id": application.client_id,
                "channel_id": interaction.channel_id,
                **data,
            },
        })
    else:
        await db.commit()
    return message


async def create_followup(
    db: AsyncSession,
    interaction: BotInteraction,
    application: BotApplication,
    data: dict[str, Any],
) -> Message:
    if not interaction.responded:
        raise UNKNOWN_INTERACTION()
    return await _create_response_message(db, interaction, application, data, original=False)


async def get_original_response(db: AsyncSession, interaction: BotInteraction) -> Message:
    if interaction.original_message_id is None:
        raise UNKNOWN_MESSAGE()
    return await load_response_message(db, interaction.original_message_id)


async def edit_original_response(db: AsyncSession, interaction: BotInteraction, data: dict[str, Any]) -> Message:
    application = await _application(db, interaction)
    if interaction.original_message_id is None:
        if not interaction.responded or not interaction.deferred:
            raise UNKNOWN_MESSAGE()
        interaction.deferred = False
        if interaction.ephemeral:
            data = {**data, "flags": int(data.get("flags") or 0) | EPHEMERAL_FLAG}
        return await _create_response_message(db, interaction, application, data, original=True)
    return await update_response_message(db, interaction, await load_response_message(db, interaction.original_message_id), data)


async def delete_response_message(db: AsyncSession, interaction: BotInteraction, message: Message) -> None:
    channel_id = message.text_channel_id
    message_id = message.id
    ephemeral_user_id = message.ephemeral_user_id
    await db.delete(message)
    if interaction.original_message_id == message_id:
        interaction.original_message_id = None
    await db.commit()
    event = {"message_id": message_id, "text_channel_id": channel_id}
    if ephemeral_user_id:
        await manager.send_to_user(ephemeral_user_id, {"type": "message_deleted", "data": event})
    else:
        await manager.send_to_channel(channel_id, {"type": "message_deleted", "data": event})
        await bot_event_dispatcher.dispatch_message_delete(db, message_id, channel_id)


def new_interaction(
    application: BotApplication,
    *,
    interaction_type: int,
    guild_id: int | None,
    channel_id: int | None,
    author_user_id: int | None,
    command_id: int | None,
    payload: dict[str, Any],
) -> BotInteraction:
    now = utcnow()
    return BotInteraction(
        application_id=application.id,
        interaction_id=generate_snowflake(),
        interaction_token=secrets.token_urlsafe(32),
        interaction_type=interaction_type,
        request_payload=payload,
        guild_id=guild_id,
        channel_id=channel_id,
        author_user_id=author_user_id,
        command_id=command_id,
        responded=False,
        created_at=now,
        updated_at=now,
        expires_at=now + timedelta(minutes=INTERACTION_TOKEN_MINUTES),
    )


async def wait_for_callback(db_factory, interaction_id: str, token: str, *, timeout: float = 2.8) -> dict[str, Any] | None:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        async with db_factory() as db:
            result = await db.execute(select(BotInteraction).where(
                BotInteraction.interaction_id == interaction_id,
                BotInteraction.interaction_token == token,
            ))
            interaction = result.scalar_one_or_none()
            if interaction and interaction.responded:
                return interaction.response_payload
        await asyncio.sleep(0.05)
    return None
