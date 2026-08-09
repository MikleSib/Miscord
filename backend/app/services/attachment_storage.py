from __future__ import annotations

import hashlib
import hmac
import mimetypes
import os
import re
import shutil
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from uuid import uuid4

import aiofiles
from fastapi import HTTPException, UploadFile, status

from app.core.config import settings
from app.services.object_storage import (
    attachment_object_key,
    delete_object,
    is_public_object_key,
    object_storage_enabled,
    put_file,
)


MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_REQUEST_FILE_BYTES = 100 * 1024 * 1024
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._() -]+")


@dataclass
class StagedFile:
    path: Path
    filename: str
    size_bytes: int
    sha256: str
    content_type: str
    inline_safe: bool


def safe_filename(value: str | None) -> str:
    name = Path(value or "file").name[:255]
    return _SAFE_NAME.sub("_", name).strip(" .") or "file"


def _sniff_content_type(header: bytes, filename: str) -> tuple[str, bool]:
    signatures = (
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"\xff\xd8\xff", "image/jpeg"),
        (b"GIF87a", "image/gif"),
        (b"GIF89a", "image/gif"),
        (b"OggS", "audio/ogg"),
        (b"ID3", "audio/mpeg"),
        (b"RIFF", "audio/wav"),
        (b"\x1aE\xdf\xa3", "video/webm"),
    )
    if len(header) >= 12 and header.startswith(b"RIFF") and header[8:12] == b"WEBP":
        return "image/webp", True
    if len(header) >= 12 and header[4:8] == b"ftyp":
        return "video/mp4", True
    for signature, content_type in signatures:
        if header.startswith(signature):
            return content_type, True
    return mimetypes.guess_type(filename)[0] or "application/octet-stream", False


async def stage_upload(upload: UploadFile, consumed_bytes: int) -> StagedFile:
    quarantine = Path(settings.ATTACHMENT_QUARANTINE_DIR)
    quarantine.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(quarantine).free <= settings.ATTACHMENT_DISK_RESERVE_BYTES:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Attachment storage is full")
    filename = safe_filename(upload.filename)
    path = quarantine / uuid4().hex
    digest = hashlib.sha256()
    size = 0
    header = b""
    try:
        async with aiofiles.open(path, "wb") as target:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_FILE_BYTES or consumed_bytes + size > MAX_REQUEST_FILE_BYTES:
                    raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Attachment limit exceeded")
                if len(header) < 32:
                    header += chunk[: 32 - len(header)]
                digest.update(chunk)
                await target.write(chunk)
        if size == 0:
            raise HTTPException(status_code=400, detail="Empty attachments are not allowed")
        content_type, inline_safe = _sniff_content_type(header, filename)
        if not inline_safe:
            content_type = "application/octet-stream"
        return StagedFile(path, filename, size, digest.hexdigest(), content_type, inline_safe)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()


async def finalize_staged_file(staged: StagedFile) -> tuple[str, Path | None]:
    now = datetime.utcnow()
    suffix = Path(staged.filename).suffix.lower()[:16]
    storage_key = f"{now:%Y/%m}/{uuid4().hex}{suffix}"
    if object_storage_enabled():
        await put_file(
            attachment_object_key(storage_key),
            staged.path,
            content_type=staged.content_type,
            filename=staged.filename,
            inline=staged.inline_safe,
        )
        staged.path.unlink(missing_ok=True)
        return storage_key, None
    destination = Path(settings.ATTACHMENT_STORAGE_DIR) / storage_key
    destination.parent.mkdir(parents=True, exist_ok=True)
    os.replace(staged.path, destination)
    os.chmod(destination, 0o640)
    return storage_key, destination


async def remove_storage_key(storage_key: str | None) -> None:
    if not storage_key:
        return
    if object_storage_enabled():
        object_key = storage_key if is_public_object_key(storage_key) else attachment_object_key(storage_key)
        await delete_object(object_key)
        return
    root = Path(settings.ATTACHMENT_STORAGE_DIR).resolve()
    target = (root / storage_key).resolve()
    if target.is_relative_to(root):
        target.unlink(missing_ok=True)


def _signing_key() -> bytes:
    value = settings.ATTACHMENT_SIGNING_KEY or settings.WEBHOOK_TOKEN_ENCRYPTION_KEY or settings.SECRET_KEY
    return hashlib.sha256(value.encode("utf-8")).digest()


def attachment_url(attachment_id: int, filename: str | None, expires: int | None = None) -> str:
    expires = expires or int(time.time()) + settings.ATTACHMENT_URL_TTL_SECONDS
    clean_name = safe_filename(filename)
    payload = f"{attachment_id}:{expires}:{clean_name}".encode("utf-8")
    signature = hmac.new(_signing_key(), payload, hashlib.sha256).hexdigest()
    return f"/api/v1/attachments/{attachment_id}/{expires}/{signature}/{clean_name}"


def verify_attachment_signature(attachment_id: int, expires: int, signature: str, filename: str) -> bool:
    if expires < int(time.time()):
        return False
    payload = f"{attachment_id}:{expires}:{safe_filename(filename)}".encode("utf-8")
    expected = hmac.new(_signing_key(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature, expected)
