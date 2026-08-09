from __future__ import annotations

import asyncio
from collections import deque
from contextlib import suppress
from dataclasses import dataclass
from fractions import Fraction
from typing import Iterator
from urllib.parse import urlparse

import av
from av.audio.resampler import AudioResampler
from yt_dlp import YoutubeDL

from miscord_voice import VoiceConnection


YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}


@dataclass(frozen=True)
class QueueItem:
    url: str


def validate_youtube_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or (parsed.hostname or "").lower() not in YOUTUBE_HOSTS:
        raise ValueError("В этом примере разрешены только ссылки YouTube и youtu.be.")


def resolve_youtube(url: str) -> tuple[str, str]:
    validate_youtube_url(url)
    with YoutubeDL({
        "format": "bestaudio/best",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }) as ydl:
        info = ydl.extract_info(url, download=False)
    if not isinstance(info, dict) or not info.get("url"):
        raise ValueError("Не удалось получить аудиопоток.")
    return str(info["url"]), str(info.get("title") or "Без названия")


def opus_packets(source_url: str) -> Iterator[bytes]:
    container = av.open(source_url, options={"rw_timeout": "15000000"})
    codec = av.CodecContext.create("libopus", "w")
    codec.sample_rate = 48_000
    codec.layout = "stereo"
    codec.format = "s16"
    codec.bit_rate = 96_000
    codec.time_base = Fraction(1, 48_000)
    codec.open()
    resampler = AudioResampler(format="s16", layout="stereo", rate=48_000, frame_size=960)
    try:
        for frame in container.decode(audio=0):
            for converted in resampler.resample(frame):
                for packet in codec.encode(converted):
                    yield bytes(packet)
        for packet in codec.encode(None):
            yield bytes(packet)
    finally:
        container.close()


def next_packet(iterator: Iterator[bytes]) -> bytes | None:
    try:
        return next(iterator)
    except StopIteration:
        return None


class GuildMusicPlayer:
    def __init__(self) -> None:
        self.connection: VoiceConnection | None = None
        self.queue: deque[QueueItem] = deque()
        self.current_title: str | None = None
        self._wake = asyncio.Event()
        self._closed = False
        self._generation = 0
        self._worker = asyncio.create_task(self._run())

    @property
    def queued(self) -> int:
        return len(self.queue)

    def attach(self, connection: VoiceConnection) -> None:
        self.connection = connection

    async def enqueue(self, url: str) -> None:
        validate_youtube_url(url)
        self.queue.append(QueueItem(url))
        self._wake.set()

    async def skip(self) -> bool:
        if not self.current_title:
            return False
        self._generation += 1
        return True

    async def close(self) -> None:
        self._closed = True
        self._generation += 1
        self.queue.clear()
        self._wake.set()
        self._worker.cancel()
        with suppress(asyncio.CancelledError):
            await self._worker
        if self.connection:
            await self.connection.stop_speaking()
        self.current_title = None

    async def _run(self) -> None:
        while not self._closed:
            if not self.queue:
                self._wake.clear()
                await self._wake.wait()
                continue
            item = self.queue.popleft()
            generation = self._generation
            try:
                source_url, self.current_title = await asyncio.to_thread(resolve_youtube, item.url)
                iterator = opus_packets(source_url)
                deadline = asyncio.get_running_loop().time()
                while generation == self._generation and not self._closed:
                    packet = await asyncio.to_thread(next_packet, iterator)
                    if packet is None:
                        break
                    if not self.connection:
                        raise RuntimeError("Бот не подключён к голосовому каналу.")
                    await self.connection.send_opus(packet)
                    deadline += 0.02
                    await asyncio.sleep(max(0, deadline - asyncio.get_running_loop().time()))
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"player error: {type(exc).__name__}: {exc}")
            finally:
                if self.connection:
                    with suppress(Exception):
                        await self.connection.stop_speaking()
                self.current_title = None
