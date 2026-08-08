from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from app.services.interaction_delivery import deliver_event_webhook


SUPPORTED_EVENT_WEBHOOK_TYPES = {
    "APPLICATION_AUTHORIZED",
    "APPLICATION_DEAUTHORIZED",
    "ENTITLEMENT_CREATE",
    "ENTITLEMENT_UPDATE",
    "ENTITLEMENT_DELETE",
    "QUEST_USER_ENROLLMENT",
    "LOBBY_MESSAGE_CREATE",
    "LOBBY_MESSAGE_UPDATE",
    "LOBBY_MESSAGE_DELETE",
    "GAME_DIRECT_MESSAGE_CREATE",
    "GAME_DIRECT_MESSAGE_UPDATE",
    "GAME_DIRECT_MESSAGE_DELETE",
}

_RETRY_DELAYS_SECONDS = (0, 1, 5, 15, 30, 60, 120, 180, 189)


async def _deliver_with_retry(url: str, payload: dict[str, Any], ciphertext: str) -> None:
    for delay in _RETRY_DELAYS_SECONDS:
        if delay:
            await asyncio.sleep(delay)
        try:
            if await deliver_event_webhook(url, payload, ciphertext):
                return
        except Exception:
            pass


def queue_event_webhook(application, event_type: str, data: dict[str, Any]) -> bool:
    if (
        not application.event_webhooks_url
        or int(application.event_webhooks_status or 1) != 1
        or event_type not in set(application.event_webhooks_types or [])
        or event_type not in SUPPORTED_EVENT_WEBHOOK_TYPES
        or application.secret is None
    ):
        return False
    payload = {
        "version": 1,
        "application_id": application.client_id,
        "type": 1,
        "event": {
            "type": event_type,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": data,
        },
    }
    asyncio.create_task(_deliver_with_retry(
        application.event_webhooks_url,
        payload,
        application.secret.signing_private_key_ciphertext,
    ))
    return True
