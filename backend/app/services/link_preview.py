"""
Превью ссылок (Open Graph / title / image).
Без внешних зависимостей: urllib + простой разбор HTML.
SSRF: проверка хоста на каждом hop редиректа.
"""
from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from html import unescape
from typing import Any, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

# Кэш в памяти процесса: url -> payload
_CACHE: Dict[str, Dict[str, Any]] = {}
_CACHE_ORDER: list[str] = []
_MAX_CACHE = 256
_TIMEOUT_SEC = 6
_MAX_BYTES = 512_000
_MAX_REDIRECTS = 5
_USER_AGENT = (
    "Mozilla/5.0 (compatible; MiscordBot/1.0; +https://miscord.ru) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_META_RE = re.compile(
    r'<meta\s+[^>]*(?:property|name)\s*=\s*["\']([^"\']+)["\'][^>]*content\s*=\s*["\']([^"\']*)["\'][^>]*/?>',
    re.IGNORECASE,
)
_META_RE_FLIP = re.compile(
    r'<meta\s+[^>]*content\s*=\s*["\']([^"\']*)["\'][^>]*(?:property|name)\s*=\s*["\']([^"\']+)["\'][^>]*/?>',
    re.IGNORECASE,
)
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_ICON_RE = re.compile(
    r'<link[^>]+rel=["\'](?:shortcut icon|icon|apple-touch-icon)["\'][^>]*>',
    re.IGNORECASE,
)
_HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.IGNORECASE)
_IMAGE_CT = re.compile(r"^image/", re.IGNORECASE)


def _ip_is_blocked(ip: ipaddress._BaseAddress) -> bool:
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    ):
        return True
    # CGNAT / metadata-ish ranges
    if ip.version == 4:
        if ip in ipaddress.ip_network("100.64.0.0/10"):
            return True
        if ip in ipaddress.ip_network("169.254.0.0/16"):
            return True
    return False


def _is_private_host(hostname: str) -> bool:
    if not hostname:
        return True
    host = hostname.lower().strip(".")
    if host in {"localhost", "0.0.0.0"} or host.endswith(".local") or host.endswith(".internal"):
        return True
    try:
        # Literal IP in hostname
        if _ip_is_blocked(ipaddress.ip_address(host)):
            return True
        return False
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return True
    if not infos:
        return True
    for info in infos:
        ip_str = info[4][0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        if _ip_is_blocked(ip):
            return True
    return False


def _assert_safe_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Только http/https")
    if not parsed.hostname or _is_private_host(parsed.hostname):
        raise ValueError("Приватные адреса запрещены")


class _SafeRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _assert_safe_url(newurl)
        return HTTPRedirectHandler.redirect_request(self, req, fp, code, msg, headers, newurl)


def _absolute(base: str, maybe_relative: Optional[str]) -> Optional[str]:
    if not maybe_relative:
        return None
    value = unescape(maybe_relative.strip())
    if not value:
        return None
    return urljoin(base, value)


def _parse_html(url: str, html: str) -> Dict[str, Any]:
    meta: Dict[str, str] = {}
    for match in _META_RE.finditer(html):
        meta[match.group(1).lower()] = unescape(match.group(2)).strip()
    for match in _META_RE_FLIP.finditer(html):
        meta[match.group(2).lower()] = unescape(match.group(1)).strip()

    title = meta.get("og:title") or meta.get("twitter:title") or None
    if not title:
        title_match = _TITLE_RE.search(html)
        if title_match:
            title = unescape(re.sub(r"\s+", " ", title_match.group(1))).strip()

    description = (
        meta.get("og:description")
        or meta.get("twitter:description")
        or meta.get("description")
    )
    image = (
        meta.get("og:image:secure_url")
        or meta.get("og:image")
        or meta.get("twitter:image")
        or meta.get("twitter:image:src")
    )
    site_name = meta.get("og:site_name") or urlparse(url).hostname

    favicon = None
    for link_tag in _ICON_RE.findall(html):
        href_match = _HREF_RE.search(link_tag)
        if href_match:
            favicon = href_match.group(1)
            break
    if not favicon:
        favicon = "/favicon.ico"

    return {
        "url": url,
        "type": "link",
        "title": title[:200] if title else None,
        "description": description[:400] if description else None,
        "image_url": _absolute(url, image),
        "site_name": site_name[:120] if site_name else None,
        "favicon_url": _absolute(url, favicon),
    }


def _fetch_sync(url: str) -> Dict[str, Any]:
    _assert_safe_url(url)

    req = Request(
        url,
        headers={
            "User-Agent": _USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,image/*,*/*;q=0.8",
            "Accept-Language": "ru,en;q=0.8",
        },
        method="GET",
    )
    opener = build_opener(_SafeRedirectHandler())
    try:
        with opener.open(req, timeout=_TIMEOUT_SEC) as resp:
            final_url = resp.geturl()
            _assert_safe_url(final_url)
            content_type = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
            raw = resp.read(_MAX_BYTES)
    except HTTPError as exc:
        raise ValueError(f"HTTP {exc.code}") from exc
    except URLError as exc:
        raise ValueError("Не удалось загрузить страницу") from exc

    if _IMAGE_CT.match(content_type) or re.search(
        r"\.(png|jpe?g|gif|webp|avif|bmp)(?:\?|#|$)", final_url, re.I
    ):
        return {
            "url": final_url,
            "type": "image",
            "title": None,
            "description": None,
            "image_url": final_url,
            "site_name": urlparse(final_url).hostname,
            "favicon_url": None,
        }

    try:
        html = raw.decode("utf-8", errors="replace")
    except Exception:
        html = raw.decode("latin-1", errors="replace")

    return _parse_html(final_url, html)


def _cache_get(url: str) -> Optional[Dict[str, Any]]:
    return _CACHE.get(url)


def _cache_set(url: str, payload: Dict[str, Any]) -> None:
    if url in _CACHE:
        _CACHE[url] = payload
        return
    _CACHE[url] = payload
    _CACHE_ORDER.append(url)
    while len(_CACHE_ORDER) > _MAX_CACHE:
        old = _CACHE_ORDER.pop(0)
        _CACHE.pop(old, None)


_YT_WATCH_RE = re.compile(
    r"(?:youtube\.com/(?:watch\?v=|embed/|shorts/|live/|v/)|youtu\.be/)([A-Za-z0-9_-]{6,})",
    re.IGNORECASE,
)


def _youtube_preview(url: str) -> Optional[Dict[str, Any]]:
    """Превью YouTube без запроса к youtube.com (с сервера он часто недоступен)."""
    match = _YT_WATCH_RE.search(url)
    if not match:
        return None
    video_id = match.group(1)
    return {
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "type": "video",
        "title": None,
        "description": None,
        "image_url": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "site_name": "YouTube",
        "favicon_url": "https://www.youtube.com/favicon.ico",
        "video_id": video_id,
        "embed_url": f"https://www.youtube.com/embed/{video_id}",
    }


async def fetch_link_preview(url: str) -> Dict[str, Any]:
    url = (url or "").strip()
    if not url:
        raise ValueError("Пустой URL")

    yt = _youtube_preview(url)
    if yt is not None:
        return yt

    cached = _cache_get(url)
    if cached is not None:
        return cached

    try:
        payload = await asyncio.to_thread(_fetch_sync, url)
    except Exception:
        parsed = urlparse(url)
        payload = {
            "url": url,
            "type": "link",
            "title": parsed.hostname,
            "description": None,
            "image_url": None,
            "site_name": parsed.hostname,
            "favicon_url": None,
        }
        return payload

    _cache_set(url, payload)
    return payload
