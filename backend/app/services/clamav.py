from __future__ import annotations

import asyncio
import struct
from pathlib import Path

import aiofiles

from app.core.config import settings


class ClamAVUnavailable(RuntimeError):
    pass


class MalwareDetected(RuntimeError):
    pass


_semaphore: asyncio.Semaphore | None = None


async def scan_file(path: Path) -> None:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(max(1, settings.CLAMAV_SCAN_CONCURRENCY))
    try:
        await asyncio.wait_for(_semaphore.acquire(), timeout=settings.CLAMAV_SCAN_TIMEOUT_SECONDS)
    except TimeoutError as exc:
        raise ClamAVUnavailable("Scanner is busy") from exc
    try:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(settings.CLAMAV_HOST, settings.CLAMAV_PORT),
                timeout=settings.CLAMAV_SCAN_TIMEOUT_SECONDS,
            )
            writer.write(b"zINSTREAM\0")
            async with aiofiles.open(path, "rb") as source:
                while True:
                    chunk = await source.read(1024 * 1024)
                    if not chunk:
                        break
                    writer.write(struct.pack(">I", len(chunk)))
                    writer.write(chunk)
                    await writer.drain()
            writer.write(struct.pack(">I", 0))
            await writer.drain()
            response = await asyncio.wait_for(reader.readuntil(b"\0"), timeout=settings.CLAMAV_SCAN_TIMEOUT_SECONDS)
            writer.close()
            await writer.wait_closed()
        except Exception as exc:
            raise ClamAVUnavailable("Malware scanner is unavailable") from exc
        verdict = response.decode("utf-8", "replace")
        if " FOUND" in verdict:
            raise MalwareDetected("Attachment was rejected")
        if " OK" not in verdict:
            raise ClamAVUnavailable("Malware scanner returned an invalid verdict")
    finally:
        _semaphore.release()


async def clamav_health() -> bool:
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(settings.CLAMAV_HOST, settings.CLAMAV_PORT), timeout=2
        )
        writer.write(b"zPING\0")
        await writer.drain()
        result = await asyncio.wait_for(reader.readuntil(b"\0"), timeout=2)
        writer.close()
        await writer.wait_closed()
        return b"PONG" in result
    except Exception:
        return False

