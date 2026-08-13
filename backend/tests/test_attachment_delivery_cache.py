from app.services.attachment_storage import attachment_url, stable_attachment_expiry


def test_attachment_urls_stay_stable_inside_a_ttl_window(monkeypatch):
    monkeypatch.setattr("app.services.attachment_storage.settings.ATTACHMENT_URL_TTL_SECONDS", 3600)
    monkeypatch.setattr("app.services.attachment_storage.time.time", lambda: 4_000)
    first = attachment_url(42, "clip.mp4")

    monkeypatch.setattr("app.services.attachment_storage.time.time", lambda: 4_100)
    second = attachment_url(42, "clip.mp4")

    assert first == second
    assert stable_attachment_expiry(4_000) == 7_200
