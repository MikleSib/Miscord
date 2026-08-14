from __future__ import annotations

import asyncio
import json
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from app.models import PendingChatUpload
from app.services.object_storage import download_file, put_file


class InvalidExpressionMedia(ValueError):
    pass


@dataclass(frozen=True)
class ExpressionMediaInfo:
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    animated: bool = False


async def _run(*args: str) -> bytes:
    process = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    try:
        output, error = await asyncio.wait_for(process.communicate(), timeout=15)
    except TimeoutError as exc:
        process.kill()
        await process.communicate()
        raise InvalidExpressionMedia("Обработка файла превысила допустимое время") from exc
    if process.returncode:
        raise InvalidExpressionMedia(error.decode("utf-8", errors="replace")[-500:])
    return output


def _inspect_image(path: Path, *, kind: str) -> ExpressionMediaInfo:
    try:
        with Image.open(path) as image:
            width, height = image.size
            animated = bool(getattr(image, "is_animated", False))
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidExpressionMedia("Изображение повреждено или имеет неподдерживаемый формат") from exc
    limit = 4096 if kind == "sticker" else 1024
    if width < 1 or height < 1 or width > limit or height > limit:
        raise InvalidExpressionMedia(f"Размер изображения должен быть не больше {limit}×{limit}")
    return ExpressionMediaInfo(width=width, height=height, animated=animated)


async def _normalize_sound(source: Path, destination: Path) -> ExpressionMediaInfo:
    probe = await _run(
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "format=duration", "-of", "json", str(source),
    )
    try:
        duration = float(json.loads(probe)["format"]["duration"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise InvalidExpressionMedia("Аудиодорожка не найдена") from exc
    if duration <= 0 or duration > 5.05:
        raise InvalidExpressionMedia("Звук должен длиться не более пяти секунд")
    await _run(
        "ffmpeg", "-v", "error", "-y", "-i", str(source), "-t", "5",
        "-vn", "-ac", "1", "-ar", "48000", "-af", "loudnorm=I=-16:LRA=7:TP=-1.5",
        "-c:a", "libopus", "-b:a", "96k", str(destination),
    )
    return ExpressionMediaInfo(duration_ms=max(1, min(5000, round(duration * 1000))))


async def inspect_and_normalize_expression(
    upload: PendingChatUpload,
    kind: str,
) -> ExpressionMediaInfo:
    with tempfile.TemporaryDirectory(prefix="miscord-expression-") as directory:
        source = Path(directory) / "source"
        await download_file(upload.storage_key, source)
        if kind in {"emoji", "sticker"}:
            return await asyncio.to_thread(_inspect_image, source, kind=kind)
        normalized = Path(directory) / "normalized.ogg"
        info = await _normalize_sound(source, normalized)
        await put_file(
            upload.storage_key, normalized, content_type="audio/ogg",
            filename=f"{Path(upload.original_filename or 'sound').stem}.ogg", inline=True,
        )
        upload.content_type = "audio/ogg"
        upload.size_bytes = normalized.stat().st_size
        return info
