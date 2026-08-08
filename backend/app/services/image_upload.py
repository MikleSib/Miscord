"""Безопасная потоковая загрузка файлов чата с проверкой magic bytes."""
from __future__ import annotations

import mimetypes
import os
import re
from pathlib import Path
from typing import BinaryIO, Tuple
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024
MAX_CHAT_VIDEO_BYTES = 20 * 1024 * 1024
MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024

_SAFE_EXTENSION = re.compile(r"\.[a-z0-9][a-z0-9._+-]{0,14}$", re.IGNORECASE)
_TEXT_CONTENT_TYPES = {
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".markdown": "text/markdown; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".jsx": "text/javascript; charset=utf-8",
    ".ts": "text/plain; charset=utf-8",
    ".tsx": "text/plain; charset=utf-8",
    ".py": "text/x-python; charset=utf-8",
    ".java": "text/plain; charset=utf-8",
    ".c": "text/plain; charset=utf-8",
    ".cc": "text/plain; charset=utf-8",
    ".cpp": "text/plain; charset=utf-8",
    ".h": "text/plain; charset=utf-8",
    ".hpp": "text/plain; charset=utf-8",
    ".cs": "text/plain; charset=utf-8",
    ".go": "text/plain; charset=utf-8",
    ".rs": "text/plain; charset=utf-8",
    ".php": "text/plain; charset=utf-8",
    ".rb": "text/plain; charset=utf-8",
    ".sh": "text/x-shellscript; charset=utf-8",
    ".bash": "text/x-shellscript; charset=utf-8",
    ".ps1": "text/plain; charset=utf-8",
    ".bat": "text/plain; charset=utf-8",
    ".cmd": "text/plain; charset=utf-8",
    ".sql": "application/sql",
    ".json": "application/json",
    ".jsonl": "application/x-ndjson",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".toml": "application/toml",
    ".xml": "application/xml",
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".scss": "text/plain; charset=utf-8",
    ".less": "text/plain; charset=utf-8",
    ".vue": "text/plain; charset=utf-8",
    ".svelte": "text/plain; charset=utf-8",
    ".env": "text/plain; charset=utf-8",
}
_EXECUTABLE_SIGNATURES = (
    b"MZ",
    b"\x7fELF",
    b"\xfe\xed\xfa\xce",
    b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
    b"\xcf\xfa\xed\xfe",
)

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


def _detect_audio(header: bytes) -> Tuple[str, str] | None:
    if header.startswith(b"ID3") or (len(header) >= 2 and header[0] == 0xFF and header[1] & 0xE0 == 0xE0):
        return ".mp3", "audio/mpeg"
    if header.startswith(b"OggS"):
        return ".ogg", "audio/ogg"
    if header.startswith(b"fLaC"):
        return ".flac", "audio/flac"
    if len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WAVE":
        return ".wav", "audio/wav"
    if len(header) >= 12 and header[4:8] == b"ftyp" and header[8:12] in {b"M4A ", b"M4B ", b"M4P "}:
        return ".m4a", "audio/mp4"
    return None


def _client_extension(filename: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    return suffix if _SAFE_EXTENSION.fullmatch(suffix) else ".bin"


def _download_content_type(filename: str | None, extension: str) -> str:
    if extension in _TEXT_CONTENT_TYPES:
        return _TEXT_CONTENT_TYPES[extension]
    return mimetypes.guess_type(filename or "")[0] or "application/octet-stream"


async def stream_and_validate_chat_media(upload: UploadFile, destination: str) -> Tuple[str, str, int, bool]:
    """Stream a chat attachment and return extension, MIME, size and inline safety."""
    total = 0
    header = bytearray()
    with open(destination, "wb") as output:
        while True:
            chunk = await upload.read(64 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_CHAT_FILE_BYTES:
                raise HTTPException(status_code=413, detail="Файл превышает лимит 20 МиБ")
            if len(header) < 4096:
                header.extend(chunk[: 4096 - len(header)])
            output.write(chunk)

    if total == 0:
        raise HTTPException(status_code=400, detail="Пустые файлы не поддерживаются")

    raw_header = bytes(header)
    detected = _detect_image(raw_header)
    if detected:
        if total > MAX_CHAT_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="Изображение превышает лимит 10 МиБ")
        return detected[0], detected[1], total, True

    detected = _detect_audio(raw_header)
    if detected:
        return detected[0], detected[1], total, True

    detected = _detect_video(raw_header)
    if detected:
        return detected[0], detected[1], total, True

    if any(raw_header.startswith(signature) for signature in _EXECUTABLE_SIGNATURES):
        raise HTTPException(status_code=415, detail="Исполняемые бинарные файлы запрещены")

    extension = _client_extension(upload.filename)
    return extension, _download_content_type(upload.filename, extension), total, False


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
            max_mib = max(1, max_bytes // (1024 * 1024))
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Размер файла не должен превышать {max_mib} МиБ.",
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
