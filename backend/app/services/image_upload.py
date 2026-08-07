"""Безопасная загрузка изображений: magic bytes + whitelist расширений."""
from __future__ import annotations

import os
from pathlib import Path
from typing import BinaryIO, Tuple
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024
MAX_CHAT_VIDEO_BYTES = 20 * 1024 * 1024

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


def _detect_video(header: bytes) -> Tuple[str, str] | None:
    # ISO Base Media File Format: MP4 and QuickTime/MOV.
    if len(header) >= 12 and header[4:8] == b"ftyp":
        if header[8:12] == b"qt  ":
            return ".mov", "video/quicktime"
        return ".mp4", "video/mp4"
    # WebM uses EBML and declares the webm document type near the header.
    if header.startswith(b"\x1a\x45\xdf\xa3") and b"webm" in header.lower():
        return ".webm", "video/webm"
    return None


async def stream_and_validate_chat_media(upload: UploadFile, destination: str) -> Tuple[str, str, int]:
    """Stream chat media to disk while enforcing limits and detecting MIME by magic bytes."""
    total = 0
    header = bytearray()
    with open(destination, "wb") as output:
        while True:
            chunk = await upload.read(64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_CHAT_VIDEO_BYTES:
                raise HTTPException(status_code=413, detail="Файл превышает лимит 20 МиБ")
            if len(header) < 4096:
                header.extend(chunk[: 4096 - len(header)])
            output.write(chunk)

    detected = _detect_image(bytes(header))
    is_image = detected is not None
    if detected is None:
        detected = _detect_video(bytes(header))
    if detected is None:
        raise HTTPException(status_code=415, detail="Поддерживаются только изображения и видео")
    if is_image and total > MAX_CHAT_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Изображение превышает лимит 10 МиБ")
    extension, content_type = detected
    return extension, content_type, total


async def read_and_validate_chat_media(upload: UploadFile) -> Tuple[bytes, str, str]:
    """Read one chat image/video with bounded memory and magic-byte validation."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_CHAT_VIDEO_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Video size must not exceed 20 MiB.",
            )
        chunks.append(chunk)

    data = b"".join(chunks)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file.")

    image = _detect_image(data[:32])
    if image:
        if total > MAX_CHAT_IMAGE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Image size must not exceed 10 MiB.",
            )
        return data, image[0], image[1]

    video = _detect_video(data[:4096])
    if video:
        return data, video[0], video[1]

    raise HTTPException(
        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        detail="Only PNG, JPEG, GIF, WEBP, MP4, WebM and MOV files are supported.",
    )


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
