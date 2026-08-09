from __future__ import annotations

import asyncio
import base64
import hashlib
import mimetypes
from functools import lru_cache
from pathlib import Path, PurePosixPath
from time import time
from urllib.parse import quote, unquote, urlparse
from uuid import uuid4

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings


class ObjectStorageError(RuntimeError):
    pass


def object_storage_enabled() -> bool:
    return bool(settings.S3_ENABLED)


def _clean_key(value: str) -> str:
    key = unquote(value).strip("/")
    path = PurePosixPath(key)
    if not key or any(part in {"", ".", ".."} for part in path.parts):
        raise ValueError("Invalid object key")
    return path.as_posix()


def full_object_key(value: str) -> str:
    key = _clean_key(value)
    prefix = settings.S3_KEY_PREFIX.strip("/")
    if prefix and not key.startswith(f"{prefix}/"):
        return f"{prefix}/{key}"
    return key


def attachment_object_key(storage_key: str) -> str:
    return full_object_key(f"attachments/{_clean_key(storage_key)}")


def new_public_object_key(namespace: str, extension: str) -> str:
    clean_namespace = _clean_key(namespace)
    suffix = extension.lower() if extension.startswith(".") else f".{extension.lower()}"
    return full_object_key(f"public/{clean_namespace}/{uuid4().hex}{suffix[:16]}")


def public_media_url(storage_key: str) -> str:
    return f"/api/v1/media/{quote(full_object_key(storage_key), safe='/')}"


def public_object_key_from_url(url: str | None) -> str | None:
    if not url:
        return None
    path = urlparse(url).path
    marker = "/api/v1/media/"
    if marker not in path:
        return None
    try:
        key = _clean_key(path.split(marker, 1)[1])
    except ValueError:
        return None
    return key if is_public_object_key(key) else None


def is_public_object_key(storage_key: str) -> bool:
    try:
        key = full_object_key(storage_key)
    except ValueError:
        return False
    prefix = settings.S3_KEY_PREFIX.strip("/")
    public_prefix = f"{prefix}/public/" if prefix else "public/"
    return key.startswith(public_prefix)


@lru_cache(maxsize=1)
def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT_URL.rstrip("/"),
        region_name=settings.S3_REGION,
        aws_access_key_id=settings.S3_ACCESS_KEY_ID,
        aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
        config=Config(
            signature_version="s3v4",
            connect_timeout=5,
            read_timeout=60,
            retries={"max_attempts": 3, "mode": "standard"},
            s3={"addressing_style": "path"},
        ),
    )


def _extra_args(content_type: str, filename: str | None, inline: bool) -> dict[str, str]:
    args = {
        "ContentType": content_type or "application/octet-stream",
        "CacheControl": "public, max-age=31536000, immutable",
    }
    if filename:
        disposition = "inline" if inline else "attachment"
        args["ContentDisposition"] = f"{disposition}; filename*=UTF-8''{quote(filename)}"
    return args


async def put_bytes(
    storage_key: str,
    data: bytes,
    *,
    content_type: str,
    filename: str | None = None,
    inline: bool = True,
) -> None:
    if not object_storage_enabled():
        raise ObjectStorageError("S3 object storage is disabled")
    try:
        await asyncio.to_thread(
            _client().put_object,
            Bucket=settings.S3_BUCKET,
            Key=full_object_key(storage_key),
            Body=data,
            **_extra_args(content_type, filename, inline),
        )
    except (BotoCoreError, ClientError, OSError) as exc:
        raise ObjectStorageError("Failed to upload object") from exc


async def put_file(
    storage_key: str,
    path: Path,
    *,
    content_type: str,
    filename: str | None = None,
    inline: bool = False,
) -> None:
    if not object_storage_enabled():
        raise ObjectStorageError("S3 object storage is disabled")
    try:
        await asyncio.to_thread(
            _client().upload_file,
            str(path),
            settings.S3_BUCKET,
            full_object_key(storage_key),
            ExtraArgs=_extra_args(content_type, filename, inline),
        )
    except (BotoCoreError, ClientError, OSError) as exc:
        raise ObjectStorageError("Failed to upload object") from exc


async def delete_object(storage_key: str | None) -> None:
    if not storage_key or not object_storage_enabled():
        return
    try:
        await asyncio.to_thread(
            _client().delete_object,
            Bucket=settings.S3_BUCKET,
            Key=full_object_key(storage_key),
        )
    except (BotoCoreError, ClientError, OSError) as exc:
        raise ObjectStorageError("Failed to delete object") from exc


async def store_public_image(namespace: str, data: bytes, extension: str, content_type: str) -> tuple[str, str]:
    if object_storage_enabled():
        key = new_public_object_key(namespace, extension)
        await put_bytes(key, data, content_type=content_type, inline=True)
        return public_media_url(key), key

    directory = Path.cwd() / "static" / "uploads"
    if namespace != "uploads":
        directory /= namespace
    directory.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4()}{extension}"
    destination = directory / filename
    await asyncio.to_thread(destination.write_bytes, data)
    relative = f"{namespace}/{filename}" if namespace != "uploads" else filename
    return f"/static/uploads/{relative}", str(destination)


async def delete_public_media(url: str | None) -> None:
    key = public_object_key_from_url(url)
    if key:
        await delete_object(key)
        return
    if not url:
        return
    path = urlparse(url).path
    marker = "/static/uploads/"
    if marker not in path:
        return
    relative = PurePosixPath(path.split(marker, 1)[1])
    if any(part in {"", ".", ".."} for part in relative.parts):
        return
    root = (Path.cwd() / "static" / "uploads").resolve()
    target = (root / Path(*relative.parts)).resolve()
    if target.is_relative_to(root):
        await asyncio.to_thread(target.unlink, missing_ok=True)


def delivery_url(storage_key: str, *, expires_in: int | None = None) -> str:
    key = full_object_key(storage_key)
    ttl = max(60, min(expires_in or settings.S3_DELIVERY_URL_TTL_SECONDS, 604800))
    expires = int(time()) + ttl
    cdn_base = settings.S3_CDN_BASE_URL.rstrip("/")
    if cdn_base:
        path = f"/{quote(key, safe='/')}"
        secret = settings.S3_CDN_SECURE_TOKEN
        if not secret:
            return f"{cdn_base}{path}"
        digest = hashlib.md5(f"{secret}{path}{expires}".encode("utf-8")).digest()
        token = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
        return f"{cdn_base}/md5({token},{expires}){path}"
    if not object_storage_enabled():
        raise ObjectStorageError("S3 object storage is disabled")
    try:
        return _client().generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.S3_BUCKET, "Key": key},
            ExpiresIn=ttl,
        )
    except (BotoCoreError, ClientError) as exc:
        raise ObjectStorageError("Failed to create object delivery URL") from exc


def content_type_for_path(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"
