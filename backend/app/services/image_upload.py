"""Безопасная загрузка изображений: magic bytes + whitelist расширений."""
from __future__ import annotations

import os
from pathlib import Path
from typing import BinaryIO, Tuple
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

MAX_IMAGE_BYTES = 5 * 1024 * 1024

# signature -> (ext, content_type)
_SIGNATURES: Tuple[Tuple[bytes, str, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", ".png", "image/png"),
    (b"\xff\xd8\xff", ".jpg", "image/jpeg"),
    (b"GIF87a", ".gif", "image/gif"),
    (b"GIF89a", ".gif", "image/gif"),
)


def _detect_image(header: bytes) -> Tuple[str, str] | None:
    for sig, ext, ctype in _SIGNATURES:
        if header.startswith(sig):
            return ext, ctype
    # WEBP: RIFF....WEBP
    if len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return ".webp", "image/webp"
    return None


async def read_and_validate_image(upload: UploadFile, *, max_bytes: int = MAX_IMAGE_BYTES) -> Tuple[bytes, str, str]:
    """
    Читает файл целиком с жёстким лимитом и проверяет magic bytes.
    Возвращает (bytes, extension, content_type).
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Размер файла не должен превышать 5MB.",
            )
        chunks.append(chunk)

    data = b"".join(chunks)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пустой файл.",
        )

    detected = _detect_image(data[:32])
    if not detected:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Поддерживаются только PNG, JPEG, GIF и WEBP.",
        )
    return data, detected[0], detected[1]


def save_image_bytes(data: bytes, directory: Path, extension: str) -> str:
    directory.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(directory, 0o755)
    except OSError:
        pass
    filename = f"{uuid4()}{extension}"
    path = directory / filename
    with path.open("wb") as fh:
        fh.write(data)
    try:
        os.chmod(path, 0o644)
    except OSError:
        pass
    return filename
