"""Публичные URL загруженных файлов (/static/uploads)."""

from typing import Optional


def to_public_media_path(url: Optional[str]) -> Optional[str]:
    """Приводит URL к относительному пути /static/... для отдачи через nginx."""
    if not url:
        return None
    if url.startswith("/static/"):
        return url
    marker = "/static/"
    if marker in url:
        return url[url.index(marker) :]
    return url
