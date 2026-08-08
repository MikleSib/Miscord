from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, Query, Response
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.discord_errors import DiscordAPIError, UNKNOWN_MESSAGE
from app.db.database import get_db
from app.models import BotInteractionMessage
from app.schemas.discord import DiscordInteractionCallback, DiscordMessageCreate, DiscordMessageUpdate
from app.services.bot_interactions import (
    apply_initial_callback,
    create_followup,
    delete_response_message,
    edit_original_response,
    get_original_response,
    load_interaction,
    load_interaction_by_token,
    load_response_message,
    update_response_message,
)
from app.services.discord_serializers import discord_message


router = APIRouter()
webhook_router = APIRouter()


def _validation_error(exc: ValidationError) -> DiscordAPIError:
    errors: dict[str, Any] = {}
    for item in exc.errors(include_url=False):
        path = ".".join(str(part) for part in item.get("loc", ())) or "_errors"
        errors[path] = {"_errors": [{"code": item.get("type", "BASE_TYPE_INVALID"), "message": item["msg"]}]}
    return DiscordAPIError(400, 50035, "Invalid Form Body", errors=errors)


@router.post("/interactions/{interaction_id}/{interaction_token}/callback")
async def create_interaction_response(
    interaction_id: str,
    interaction_token: str,
    raw_payload: dict[str, Any] = Body(...),
    with_response: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    try:
        callback = DiscordInteractionCallback.model_validate(raw_payload)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    interaction = await load_interaction(db, interaction_id, interaction_token, for_update=True)
    message = await apply_initial_callback(db, interaction, callback)
    if not with_response:
        return Response(status_code=204)
    resource = None
    if message is not None:
        resource = {"type": 4, "message": discord_message(message, guild_id=interaction.guild_id)}
    return {
        "interaction": {
            "id": interaction.interaction_id,
            "type": int(interaction.interaction_type),
            "response_message_id": str(message.id) if message else None,
            "response_message_loading": bool(interaction.deferred),
            "response_message_ephemeral": bool(interaction.ephemeral),
        },
        "resource": resource,
    }


@webhook_router.get("/webhooks/{application_id}/{interaction_token}/messages/@original")
async def get_original_interaction_response(
    application_id: str,
    interaction_token: str,
    db: AsyncSession = Depends(get_db),
):
    interaction, _ = await load_interaction_by_token(db, application_id, interaction_token)
    return discord_message(await get_original_response(db, interaction), guild_id=interaction.guild_id)


@webhook_router.patch("/webhooks/{application_id}/{interaction_token}/messages/@original")
async def edit_original_interaction_response(
    application_id: str,
    interaction_token: str,
    raw_payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = DiscordMessageUpdate.model_validate(raw_payload)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    interaction, _ = await load_interaction_by_token(db, application_id, interaction_token)
    message = await edit_original_response(db, interaction, payload.model_dump(exclude_unset=True))
    return discord_message(message, guild_id=interaction.guild_id)


@webhook_router.delete("/webhooks/{application_id}/{interaction_token}/messages/@original", status_code=204)
async def delete_original_interaction_response(
    application_id: str,
    interaction_token: str,
    db: AsyncSession = Depends(get_db),
):
    interaction, _ = await load_interaction_by_token(db, application_id, interaction_token)
    await delete_response_message(db, interaction, await get_original_response(db, interaction))
    return Response(status_code=204)


@webhook_router.post("/webhooks/{application_id}/{interaction_token}")
async def create_followup_message(
    application_id: str,
    interaction_token: str,
    raw_payload: dict[str, Any] = Body(...),
    wait: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = DiscordMessageCreate.model_validate(raw_payload)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    interaction, application = await load_interaction_by_token(db, application_id, interaction_token)
    message = await create_followup(db, interaction, application, payload.model_dump(exclude_unset=True))
    return discord_message(message, guild_id=interaction.guild_id)


async def _followup_message(db: AsyncSession, interaction_id: int, message_id: int):
    result = await db.execute(select(BotInteractionMessage).where(
        BotInteractionMessage.interaction_id == interaction_id,
        BotInteractionMessage.message_id == message_id,
        BotInteractionMessage.is_original.is_(False),
    ))
    link = result.scalar_one_or_none()
    if link is None:
        raise UNKNOWN_MESSAGE()
    return await get_original_response(db, link.interaction) if link.is_original else link.message


@webhook_router.get("/webhooks/{application_id}/{interaction_token}/messages/{message_id}")
async def get_followup_message(
    application_id: str,
    interaction_token: str,
    message_id: int,
    db: AsyncSession = Depends(get_db),
):
    interaction, _ = await load_interaction_by_token(db, application_id, interaction_token)
    link_result = await db.execute(select(BotInteractionMessage).where(
        BotInteractionMessage.interaction_id == interaction.id,
        BotInteractionMessage.message_id == message_id,
        BotInteractionMessage.is_original.is_(False),
    ))
    link = link_result.scalar_one_or_none()
    if link is None:
        raise UNKNOWN_MESSAGE()
    return discord_message(await load_response_message(db, message_id), guild_id=interaction.guild_id)


@webhook_router.patch("/webhooks/{application_id}/{interaction_token}/messages/{message_id}")
async def edit_followup_message(
    application_id: str,
    interaction_token: str,
    message_id: int,
    raw_payload: dict[str, Any] = Body(...),
    db: AsyncSession = Depends(get_db),
):
    try:
        payload = DiscordMessageUpdate.model_validate(raw_payload)
    except ValidationError as exc:
        raise _validation_error(exc) from exc
    interaction, _ = await load_interaction_by_token(db, application_id, interaction_token)
    link = await db.scalar(select(BotInteractionMessage.id).where(
        BotInteractionMessage.interaction_id == interaction.id,
        BotInteractionMessage.message_id == message_id,
        BotInteractionMessage.is_original.is_(False),
    ))
    if link is None:
        raise UNKNOWN_MESSAGE()
    message = await update_response_message(db, interaction, await load_response_message(db, message_id), payload.model_dump(exclude_unset=True))
    return discord_message(message, guild_id=interaction.guild_id)


@webhook_router.delete("/webhooks/{application_id}/{interaction_token}/messages/{message_id}", status_code=204)
async def delete_followup_message(
    application_id: str,
    interaction_token: str,
    message_id: int,
    db: AsyncSession = Depends(get_db),
):
    interaction, _ = await load_interaction_by_token(db, application_id, interaction_token)
    link = await db.scalar(select(BotInteractionMessage.id).where(
        BotInteractionMessage.interaction_id == interaction.id,
        BotInteractionMessage.message_id == message_id,
        BotInteractionMessage.is_original.is_(False),
    ))
    if link is None:
        raise UNKNOWN_MESSAGE()
    await delete_response_message(db, interaction, await load_response_message(db, message_id))
    return Response(status_code=204)
