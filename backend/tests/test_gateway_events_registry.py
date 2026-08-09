"""Сверяет реестры имён WS-событий backend ↔ frontend."""

from __future__ import annotations

import re
from pathlib import Path

from app.websocket.events import USER_GATEWAY_EVENTS

ROOT = Path(__file__).resolve().parents[2]
FRONTEND_EVENTS = ROOT / "frontend" / "src" / "lib" / "gatewayEvents.ts"


def _parse_frontend_events(source: str) -> set[str]:
    """Достаёт строковые значения из объекта GatewayEvents."""
    match = re.search(r"export const GatewayEvents\s*=\s*\{(.*?)\}\s*as const", source, re.S)
    assert match, "Не найден объект GatewayEvents в gatewayEvents.ts"
    body = match.group(1)
    return set(re.findall(r":\s*'([a-z0-9_]+)'", body))


def test_frontend_gateway_events_file_exists() -> None:
    assert FRONTEND_EVENTS.is_file(), f"Нет файла {FRONTEND_EVENTS}"


def test_backend_and_frontend_gateway_events_match() -> None:
    frontend_events = _parse_frontend_events(FRONTEND_EVENTS.read_text(encoding="utf-8"))
    backend_events = set(USER_GATEWAY_EVENTS)

    only_backend = sorted(backend_events - frontend_events)
    only_frontend = sorted(frontend_events - backend_events)

    assert not only_backend and not only_frontend, (
        "Реестры WS-событий разошлись.\n"
        f"Только на backend: {only_backend}\n"
        f"Только на frontend: {only_frontend}"
    )
