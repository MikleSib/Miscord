from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
import time
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.core.config import settings
from app.core.metrics import record_delivery
from app.services.bot_security import sign_interaction_request
from app.services.miscord_snowflake import generate_snowflake


class InteractionEndpointError(ValueError):
    pass


async def _resolved_addresses(hostname: str, port: int) -> set[str]:
    loop = asyncio.get_running_loop()
    rows = await loop.run_in_executor(None, lambda: socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM))
    return {row[4][0] for row in rows}


async def validate_endpoint_url(url: str) -> str:
    value = url.strip()
    parsed = urlsplit(value)
    is_prod = (settings.ENVIRONMENT or "").lower() in {"production", "prod"}
    if parsed.scheme not in ({"https"} if is_prod else {"http", "https"}):
        raise InteractionEndpointError("Interaction endpoint must use HTTPS")
    if not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise InteractionEndpointError("Interaction endpoint URL is invalid")
    if is_prod:
        try:
            addresses = await _resolved_addresses(parsed.hostname, parsed.port or 443)
        except OSError as exc:
            raise InteractionEndpointError("Interaction endpoint hostname cannot be resolved") from exc
        for address in addresses:
            ip = ipaddress.ip_address(address)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                raise InteractionEndpointError("Interaction endpoint cannot resolve to a private network")
    return value


async def _post_signed(
    url: str,
    payload: dict[str, Any],
    signing_private_key_ciphertext: str,
    *,
    timeout_seconds: float = 2.8,
) -> httpx.Response:
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    timestamp = str(int(time.time()))
    signature = sign_interaction_request(signing_private_key_ciphertext, timestamp, body)
    async with httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=False) as client:
        return await client.post(
            url,
            content=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "MiscordBot (https://miscord.ru, 1.0)",
                "X-Signature-Ed25519": signature,
                "X-Signature-Timestamp": timestamp,
            },
        )


async def verify_interactions_endpoint(url: str, application, ciphertext: str) -> str:
    safe_url = await validate_endpoint_url(url)
    ping = {
        "id": generate_snowflake(),
        "application_id": application.client_id,
        "type": 1,
        "token": "endpoint-verification",
        "version": 1,
    }
    try:
        response = await _post_signed(safe_url, ping, ciphertext)
        data = response.json()
    except Exception as exc:
        raise InteractionEndpointError("Interaction endpoint did not answer the verification PING") from exc
    if response.status_code < 200 or response.status_code >= 300 or not isinstance(data, dict) or data.get("type") != 1:
        raise InteractionEndpointError("Interaction endpoint must answer PING with {\"type\":1}")
    return safe_url


async def verify_event_webhooks_endpoint(url: str, application, ciphertext: str) -> str:
    safe_url = await validate_endpoint_url(url)
    ping = {
        "version": 1,
        "application_id": application.client_id,
        "type": 0,
    }
    try:
        response = await _post_signed(safe_url, ping, ciphertext)
    except Exception as exc:
        raise InteractionEndpointError("Event Webhooks endpoint did not answer the verification PING") from exc
    if response.status_code != 204 or response.content:
        raise InteractionEndpointError("Event Webhooks endpoint must answer PING with an empty HTTP 204 response")
    return safe_url


async def deliver_event_webhook(
    url: str,
    payload: dict[str, Any],
    ciphertext: str,
) -> bool:
    try:
        safe_url = await validate_endpoint_url(url)
        response = await _post_signed(safe_url, payload, ciphertext)
        delivered = response.status_code == 204
    except Exception:
        record_delivery("event_webhook", "error")
        raise
    record_delivery("event_webhook", "success" if delivered else "error")
    return delivered


async def deliver_interaction_http(application, ciphertext: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        if not application.interactions_endpoint_url:
            raise InteractionEndpointError("Interaction endpoint is not configured")
        safe_url = await validate_endpoint_url(application.interactions_endpoint_url)
        response = await _post_signed(safe_url, payload, ciphertext)
        if response.status_code < 200 or response.status_code >= 300:
            raise InteractionEndpointError(f"Interaction endpoint returned HTTP {response.status_code}")
        if len(response.content) > 1024 * 1024:
            raise InteractionEndpointError("Interaction endpoint response is too large")
        try:
            data = response.json()
        except ValueError as exc:
            raise InteractionEndpointError("Interaction endpoint returned invalid JSON") from exc
        if not isinstance(data, dict) or not isinstance(data.get("type"), int):
            raise InteractionEndpointError("Interaction endpoint returned an invalid callback")
    except Exception:
        record_delivery("interaction", "error")
        raise
    record_delivery("interaction", "success")
    return data
