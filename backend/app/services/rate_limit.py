"""Простой in-memory rate limiter (на процесс)."""
from __future__ import annotations

import hashlib
import math
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Deque, Dict, Optional, Tuple

from fastapi import HTTPException, Request, status

_lock = Lock()
_hits: Dict[str, Deque[float]] = defaultdict(deque)

# Антиспам сообщений (канал + ЛС)
MESSAGE_FLOOD_LIMIT = 5
MESSAGE_FLOOD_WINDOW = 5
MESSAGE_DUPLICATE_WINDOW = 2


def _client_ip(request: Request | None) -> str:
    if request is None:
        return "unknown"
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def try_consume_rate_limit(
    *,
    key: str,
    limit: int,
    window_seconds: int,
) -> Tuple[bool, int]:
    """
    Пытается засчитать событие.
    Возвращает (ok, retry_after_seconds). Без HTTPException — удобно для WebSocket.
    """
    now = time.monotonic()
    cutoff = now - window_seconds
    with _lock:
        bucket = _hits[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            oldest = bucket[0]
            retry = int(math.ceil(oldest + window_seconds - now))
            return False, max(1, retry)
        bucket.append(now)
        return True, 0


def check_rate_limit(
    *,
    key: str,
    limit: int,
    window_seconds: int,
) -> None:
    """Бросает 429, если лимит превышен."""
    ok, _retry = try_consume_rate_limit(
        key=key, limit=limit, window_seconds=window_seconds
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много запросов. Подождите немного.",
        )


def rate_limit_auth(request: Request, action: str, *, limit: int = 10, window: int = 60) -> None:
    ip = _client_ip(request)
    check_rate_limit(key=f"auth:{action}:{ip}", limit=limit, window_seconds=window)


def rate_limit_user(
    user_id: int,
    action: str,
    *,
    limit: int,
    window: int = 60,
    request: Request | None = None,
) -> None:
    ip = _client_ip(request)
    check_rate_limit(key=f"user:{action}:{user_id}:{ip}", limit=limit, window_seconds=window)


def check_message_flood(user_id: int) -> Tuple[bool, int]:
    """Макс. MESSAGE_FLOOD_LIMIT сообщений за MESSAGE_FLOOD_WINDOW секунд."""
    return try_consume_rate_limit(
        key=f"msg_flood:{user_id}",
        limit=MESSAGE_FLOOD_LIMIT,
        window_seconds=MESSAGE_FLOOD_WINDOW,
    )


def check_duplicate_message(
    user_id: int,
    dest_key: str,
    content: Optional[str],
) -> Tuple[bool, int]:
    """Одинаковый текст в тот же чат/ЛС не чаще раза в MESSAGE_DUPLICATE_WINDOW сек."""
    normalized = (content or "").strip()
    if not normalized:
        return True, 0
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]
    return try_consume_rate_limit(
        key=f"msg_dup:{user_id}:{dest_key}:{digest}",
        limit=1,
        window_seconds=MESSAGE_DUPLICATE_WINDOW,
    )


def enforce_message_antispam(
    user_id: int,
    *,
    dest_key: str,
    content: Optional[str],
) -> Tuple[bool, int, str]:
    """
    Общая проверка антифлуда для каналов и ЛС.
    Возвращает (allowed, retry_after_seconds, message).
    """
    ok, retry = check_message_flood(user_id)
    if not ok:
        return False, retry, "Слишком быстро. Подождите немного."

    ok, retry = check_duplicate_message(user_id, dest_key, content)
    if not ok:
        return (
            False,
            max(retry, MESSAGE_DUPLICATE_WINDOW),
            "Не отправляйте одинаковые сообщения подряд.",
        )

    return True, 0, ""


def rate_limit_payload(
    *,
    message: str,
    retry_after_seconds: int,
    scope: str,
    text_channel_id: Optional[int] = None,
    recipient_id: Optional[int] = None,
) -> dict:
    payload: dict = {
        "type": "rate_limit",
        "message": message,
        "retry_after_seconds": retry_after_seconds,
        "scope": scope,
    }
    if text_channel_id is not None:
        payload["text_channel_id"] = text_channel_id
    if recipient_id is not None:
        payload["recipient_id"] = recipient_id
    return payload
