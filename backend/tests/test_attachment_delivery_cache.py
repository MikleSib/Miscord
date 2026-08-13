import asyncio

from app.api.attachment_files import (
    PUBLIC_MEDIA_CACHE_SECONDS,
    PUBLIC_MEDIA_DELIVERY_TTL_SECONDS,
    download_public_media,
)
from app.services.attachment_storage import attachment_url, stable_attachment_expiry


def test_attachment_urls_stay_stable_inside_a_ttl_window(monkeypatch):
    monkeypatch.setattr("app.services.attachment_storage.settings.ATTACHMENT_URL_TTL_SECONDS", 3600)
    monkeypatch.setattr("app.services.attachment_storage.time.time", lambda: 4_000)
    first = attachment_url(42, "clip.mp4")

    monkeypatch.setattr("app.services.attachment_storage.time.time", lambda: 4_100)
    second = attachment_url(42, "clip.mp4")

    assert first == second
    assert stable_attachment_expiry(4_000) == 7_200


def test_public_media_redirect_is_reusable(monkeypatch):
    captured = {}

    def fake_delivery_url(storage_key: str, *, expires_in: int | None = None):
        captured.update(storage_key=storage_key, expires_in=expires_in)
        return "https://media.example.test/video.mp4"

    monkeypatch.setattr("app.api.attachment_files.delivery_url", fake_delivery_url)
    response = asyncio.run(download_public_media("miscord/public/uploads/video.mp4"))

    assert response.status_code == 307
    assert response.headers["cache-control"] == (
        f"public, max-age={PUBLIC_MEDIA_CACHE_SECONDS}, immutable"
    )
    assert captured == {
        "storage_key": "miscord/public/uploads/video.mp4",
        "expires_in": PUBLIC_MEDIA_DELIVERY_TTL_SECONDS,
    }
