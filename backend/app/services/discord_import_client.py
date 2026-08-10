from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import HTTPException

from app.core.config import settings

API_BASE = "https://discord.com/api/v10"
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
TEMPLATE_CODE = re.compile(r"^[A-Za-z0-9_-]{2,128}$")


def extract_template_code(value: str) -> str:
    candidate = value.strip()
    if "://" in candidate:
        parsed = urlparse(candidate)
        if parsed.scheme != "https" or parsed.hostname not in {
            "discord.new", "www.discord.new", "discord.com", "www.discord.com"
        }:
            raise HTTPException(status_code=400, detail="Поддерживается только официальная ссылка-шаблон")
        parts = [item for item in parsed.path.split("/") if item]
        candidate = parts[-1] if parts else ""
    if not TEMPLATE_CODE.fullmatch(candidate):
        raise HTTPException(status_code=400, detail="Некорректный код шаблона")
    return candidate


async def _json_request(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: dict[str, str] | None = None,
) -> dict[str, Any] | list[dict[str, Any]]:
    timeout = httpx.Timeout(15.0, connect=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        response = await client.request(method, url, headers=headers, data=data)
    if response.status_code == 429:
        raise HTTPException(status_code=429, detail="Источник ограничил частоту запросов. Повторите позже")
    if response.status_code in {401, 403}:
        raise HTTPException(status_code=409, detail="Импортер не получил доступ к исходному серверу")
    if response.status_code == 404:
        raise HTTPException(status_code=404, detail="Исходный сервер или шаблон не найден")
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail="Источник временно не отвечает")
    if len(response.content) > MAX_RESPONSE_BYTES:
        raise HTTPException(status_code=413, detail="Ответ источника слишком большой")
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Источник вернул некорректный ответ") from exc
    if not isinstance(payload, (dict, list)):
        raise HTTPException(status_code=502, detail="Источник вернул неожиданный ответ")
    return payload


async def fetch_public_template(code: str) -> dict[str, Any]:
    payload = await _json_request("GET", f"{API_BASE}/guilds/templates/{code}")
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Шаблон повреждён")
    return payload


def oauth_configured() -> bool:
    return all((
        settings.DISCORD_IMPORT_CLIENT_ID,
        settings.DISCORD_IMPORT_CLIENT_SECRET,
        settings.DISCORD_IMPORT_BOT_TOKEN,
    ))


def oauth_authorize_url(state: str, redirect_uri: str) -> str:
    query = urlencode({
        "client_id": settings.DISCORD_IMPORT_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "identify guilds",
        "state": state,
        "prompt": "consent",
    })
    return f"https://discord.com/oauth2/authorize?{query}"


def bot_install_url(server_id: str) -> str:
    query = urlencode({
        "client_id": settings.DISCORD_IMPORT_CLIENT_ID,
        "scope": "bot",
        "permissions": "8",
        "guild_id": server_id,
        "disable_guild_select": "true",
    })
    return f"https://discord.com/oauth2/authorize?{query}"


async def exchange_oauth_code(code: str, redirect_uri: str) -> dict[str, Any]:
    payload = await _json_request("POST", f"{API_BASE}/oauth2/token", data={
        "client_id": settings.DISCORD_IMPORT_CLIENT_ID,
        "client_secret": settings.DISCORD_IMPORT_CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
    })
    if not isinstance(payload, dict) or not isinstance(payload.get("access_token"), str):
        raise HTTPException(status_code=502, detail="Не удалось подтвердить внешний аккаунт")
    return payload


async def fetch_user_guilds(access_token: str) -> list[dict[str, Any]]:
    payload = await _json_request("GET", f"{API_BASE}/users/@me/guilds", headers={
        "Authorization": f"Bearer {access_token}",
    })
    return payload if isinstance(payload, list) else []


async def fetch_guild_snapshot(server_id: str) -> dict[str, Any]:
    headers = {"Authorization": f"Bot {settings.DISCORD_IMPORT_BOT_TOKEN}"}
    guild = await _json_request("GET", f"{API_BASE}/guilds/{server_id}", headers=headers)
    channels = await _json_request("GET", f"{API_BASE}/guilds/{server_id}/channels", headers=headers)
    if not isinstance(guild, dict) or not isinstance(channels, list):
        raise HTTPException(status_code=502, detail="Не удалось прочитать структуру сервера")
    guild = dict(guild)
    guild["channels"] = channels
    return guild


async def leave_import_guild(server_id: str) -> bool:
    headers = {"Authorization": f"Bot {settings.DISCORD_IMPORT_BOT_TOKEN}"}
    timeout = httpx.Timeout(10.0, connect=5.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            response = await client.delete(f"{API_BASE}/users/@me/guilds/{server_id}", headers=headers)
        return response.status_code in {204, 404}
    except httpx.HTTPError:
        return False
