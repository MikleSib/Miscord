import asyncio
import json
import os
from urllib.error import HTTPError
from urllib.request import urlopen

import websockets
from websockets.exceptions import ConnectionClosed, InvalidStatus, InvalidStatusCode


HTTP_BASE = os.getenv("MISCORD_SMOKE_HTTP", "http://127.0.0.1:3011").rstrip("/")
WS_BASE = os.getenv("MISCORD_SMOKE_WS", "ws://127.0.0.1:3011").rstrip("/")


def http_status(path: str) -> int:
    try:
        with urlopen(f"{HTTP_BASE}{path}", timeout=5) as response:
            return response.status
    except HTTPError as error:
        return error.code


async def expect_hello(path: str, opcode: int) -> None:
    async with websockets.connect(f"{WS_BASE}{path}", open_timeout=5) as socket:
        payload = json.loads(await asyncio.wait_for(socket.recv(), timeout=5))
        if payload.get("op") != opcode:
            raise AssertionError(f"{path} returned opcode {payload.get('op')}, expected {opcode}")


async def expect_rejected(path: str) -> None:
    try:
        async with websockets.connect(f"{WS_BASE}{path}", open_timeout=5) as socket:
            try:
                payload = await asyncio.wait_for(socket.recv(), timeout=2)
            except ConnectionClosed:
                return
            raise AssertionError(f"Deprecated contract was accepted by {path}: {payload}")
    except (ConnectionClosed, InvalidStatus, InvalidStatusCode):
        return


async def main() -> None:
    statuses = {
        "health_v1": http_status("/api/v1/health"),
        "health_legacy": http_status("/api/health"),
        "gateway_v1": http_status("/api/v1/gateway?v=1"),
        "gateway_v10": http_status("/api/v1/gateway?v=10"),
        "gateway_missing": http_status("/api/v1/gateway"),
    }
    expected = {
        "health_v1": 200,
        "health_legacy": 404,
        "gateway_v1": 200,
        "gateway_v10": 400,
        "gateway_missing": 400,
    }
    if statuses != expected:
        raise AssertionError({"actual": statuses, "expected": expected})

    await expect_hello("/gateway?v=1&encoding=json", 10)
    await expect_rejected("/gateway?v=10&encoding=json")
    await expect_rejected("/gateway")
    await expect_hello("/ws/voice-gateway?v=1", 8)
    await expect_rejected("/ws/voice-gateway?v=8")
    await expect_rejected("/ws/voice-gateway")
    print(json.dumps({"ok": True, "protocol_version": 1, "http": statuses}))


if __name__ == "__main__":
    asyncio.run(main())
