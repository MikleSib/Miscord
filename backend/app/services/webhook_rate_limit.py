from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import redis.asyncio as redis

from app.core.config import settings
from app.services.rate_limit import try_consume_rate_limit


_client: redis.Redis | None = None
_LUA = """
local output = {}
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[(i - 1) * 2 + 1])
  local window = tonumber(ARGV[(i - 1) * 2 + 2])
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('PEXPIRE', key, window) end
  local ttl = redis.call('PTTL', key)
  table.insert(output, count)
  table.insert(output, ttl)
  table.insert(output, limit)
end
return output
"""


@dataclass(frozen=True)
class Bucket:
    key: str
    limit: int
    window_seconds: int
    scope: str


@dataclass(frozen=True)
class RateResult:
    allowed: bool
    limit: int
    remaining: int
    retry_after: float
    scope: str


async def consume(buckets: Iterable[Bucket]) -> RateResult:
    items = list(buckets)
    global _client
    try:
        if _client is None:
            _client = redis.from_url(settings.REDIS_URL, decode_responses=False)
        args: list[int] = []
        for item in items:
            args.extend((item.limit, item.window_seconds * 1000))
        raw = await _client.eval(_LUA, len(items), *[f"miscord:rl:{item.key}" for item in items], *args)
        results: list[RateResult] = []
        for index, item in enumerate(items):
            count, ttl, limit = int(raw[index * 3]), int(raw[index * 3 + 1]), int(raw[index * 3 + 2])
            results.append(RateResult(count <= limit, limit, max(0, limit - count), max(0.001, ttl / 1000), item.scope))
        return next((result for result in results if not result.allowed), results[0])
    except Exception:
        for item in items:
            allowed, retry = try_consume_rate_limit(key=f"webhook:{item.key}", limit=item.limit, window_seconds=item.window_seconds)
            if not allowed:
                return RateResult(False, item.limit, 0, float(retry), item.scope)
        first = items[0]
        return RateResult(True, first.limit, max(0, first.limit - 1), float(first.window_seconds), first.scope)


def rate_headers(result: RateResult) -> dict[str, str]:
    return {
        "X-RateLimit-Limit": str(result.limit),
        "X-RateLimit-Remaining": str(result.remaining),
        "X-RateLimit-Reset-After": f"{result.retry_after:.3f}",
        "X-RateLimit-Scope": result.scope,
    }

