from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import suppress
from dataclasses import dataclass
from fractions import Fraction
from urllib.parse import urlparse

import httpx
import websockets
from aiortc import (
    AudioStreamTrack,
    MediaStreamError,
    RTCConfiguration,
    RTCIceCandidate,
    RTCIceServer,
    RTCPeerConnection,
    RTCSessionDescription,
)
from aiortc.contrib.media import MediaPlayer, MediaRelay
from aiortc.sdp import candidate_from_sdp, candidate_to_sdp
from av import AudioFrame
from dotenv import load_dotenv
from yt_dlp import YoutubeDL


INTENT_GUILDS = 1 << 0
INTENT_GUILD_VOICE_STATES = 1 << 7
GATEWAY_INTENTS = INTENT_GUILDS | INTENT_GUILD_VOICE_STATES
YOUTUBE_HOSTS = {
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
}


def _application_id_from_token(token: str) -> str:
    return token.split(".", 1)[0].removeprefix("mcb_")


def _option(interaction: dict, name: str) -> str | None:
    options = interaction.get("data", {}).get("options") or []
    for item in options:
        if item.get("name") == name:
            value = item.get("value")
            return str(value) if value is not None else None
    return None


def _resolve_youtube(url: str) -> tuple[str, str]:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or (parsed.hostname or "").lower() not in YOUTUBE_HOSTS:
        raise ValueError("В примере разрешены только ссылки YouTube и youtu.be")
    options = {
        "format": "bestaudio/best",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "extract_flat": False,
    }
    with YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)
    if not isinstance(info, dict) or not info.get("url"):
        raise ValueError("Не удалось получить аудиопоток")
    return str(info["url"]), str(info.get("title") or "Без названия")


def _validate_youtube_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or (parsed.hostname or "").lower() not in YOUTUBE_HOSTS:
        raise ValueError("В примере разрешены только ссылки YouTube и youtu.be")


class AudioBus(AudioStreamTrack):
    """One stable WebRTC audio track whose source can change between songs."""

    def __init__(self) -> None:
        super().__init__()
        self._source: AudioStreamTrack | None = None
        self._source_lock = asyncio.Lock()
        self._silence_pts = 0

    async def set_source(self, source: AudioStreamTrack | None) -> None:
        async with self._source_lock:
            self._source = source

    async def recv(self) -> AudioFrame:
        async with self._source_lock:
            source = self._source
        if source is not None:
            try:
                return await source.recv()
            except MediaStreamError:
                async with self._source_lock:
                    if self._source is source:
                        self._source = None

        await asyncio.sleep(0.02)
        frame = AudioFrame(format="s16", layout="stereo", samples=960)
        for plane in frame.planes:
            plane.update(bytes(plane.buffer_size))
        frame.sample_rate = 48_000
        frame.pts = self._silence_pts
        frame.time_base = Fraction(1, 48_000)
        self._silence_pts += 960
        return frame


@dataclass(frozen=True)
class QueueItem:
    url: str


class GuildMusicPlayer:
    def __init__(self) -> None:
        self.audio = AudioBus()
        self._queue: asyncio.Queue[QueueItem] = asyncio.Queue()
        self._skip_event: asyncio.Event | None = None
        self._closed = False
        self.current_title: str | None = None
        self._worker = asyncio.create_task(self._run())

    @property
    def queued(self) -> int:
        return self._queue.qsize()

    async def enqueue(self, url: str) -> None:
        await self._queue.put(QueueItem(url=url))

    async def skip(self) -> bool:
        if self._skip_event is None:
            return False
        self._skip_event.set()
        return True

    async def stop(self) -> None:
        while True:
            try:
                self._queue.get_nowait()
                self._queue.task_done()
            except asyncio.QueueEmpty:
                break
        if self._skip_event is not None:
            self._skip_event.set()
        self.current_title = None
        await self.audio.set_source(None)

    async def close(self) -> None:
        self._closed = True
        await self.stop()
        self._worker.cancel()
        with suppress(asyncio.CancelledError):
            await self._worker

    async def _run(self) -> None:
        while not self._closed:
            item = await self._queue.get()
            player: MediaPlayer | None = None
            try:
                stream_url, title = await asyncio.to_thread(_resolve_youtube, item.url)
                player = MediaPlayer(
                    stream_url,
                    options={
                        "reconnect": "1",
                        "reconnect_streamed": "1",
                        "reconnect_delay_max": "5",
                    },
                )
                if player.audio is None:
                    raise ValueError("Источник не содержит аудио")
                self.current_title = title
                self._skip_event = asyncio.Event()
                ended = asyncio.Event()
                player.audio.on("ended", ended.set)
                await self.audio.set_source(player.audio)
                skip_task = asyncio.create_task(self._skip_event.wait())
                ended_task = asyncio.create_task(ended.wait())
                done, pending = await asyncio.wait(
                    {skip_task, ended_task}, return_when=asyncio.FIRST_COMPLETED
                )
                for task in pending:
                    task.cancel()
                for task in done:
                    with suppress(asyncio.CancelledError):
                        await task
            except Exception as exc:
                print(f"music source error: {type(exc).__name__}: {exc}")
            finally:
                await self.audio.set_source(None)
                self.current_title = None
                self._skip_event = None
                if player is not None:
                    if player.audio is not None:
                        player.audio.stop()
                    if player.video is not None:
                        player.video.stop()
                self._queue.task_done()


class VoiceConnection:
    def __init__(
        self,
        *,
        endpoint: str,
        guild_id: int,
        channel_id: int,
        user_id: int,
        session_id: str,
        token: str,
        audio: AudioBus,
    ) -> None:
        self.endpoint = endpoint if endpoint.startswith("ws") else f"wss://{endpoint}"
        self.guild_id = guild_id
        self.channel_id = channel_id
        self.user_id = user_id
        self.session_id = session_id
        self.token = token
        self.audio = audio
        self.websocket = None
        self.ice_servers: list[RTCIceServer] = []
        self.peers: dict[int, RTCPeerConnection] = {}
        self.relay = MediaRelay()
        self._send_lock = asyncio.Lock()
        self._heartbeat_task: asyncio.Task | None = None
        self._receive_task: asyncio.Task | None = None
        self._last_seq = -1

    async def connect(self) -> None:
        self.websocket = await websockets.connect(
            self.endpoint,
            max_size=64 * 1024,
            ping_interval=None,
        )
        hello = json.loads(await self.websocket.recv())
        if hello.get("op") != 8:
            raise RuntimeError("Voice Gateway did not send Hello")
        heartbeat_interval = int(hello["d"]["heartbeat_interval"])
        await self._send(
            {
                "op": 0,
                "d": {
                    "server_id": str(self.guild_id),
                    "user_id": str(self.user_id),
                    "session_id": self.session_id,
                    "token": self.token,
                    "max_dave_protocol_version": 0,
                },
            }
        )
        ready = json.loads(await self.websocket.recv())
        if ready.get("op") != 2:
            raise RuntimeError("Voice Gateway did not send Ready")
        self._configure_ice(ready["d"].get("ice_servers") or [])
        for participant in ready["d"].get("participants") or []:
            await self._participant_connected(int(participant["user_id"]))
        await self._send(
            {
                "op": 1,
                "d": {
                    "protocol": "webrtc",
                    "data": {"mode": "webrtc_dtls_srtp"},
                },
            }
        )
        await self._send(
            {"op": 5, "d": {"speaking": 1, "delay": 0, "ssrc": self.user_id}}
        )
        self._heartbeat_task = asyncio.create_task(self._heartbeat(heartbeat_interval))
        self._receive_task = asyncio.create_task(self._receive())

    def _configure_ice(self, raw_servers: list[dict]) -> None:
        self.ice_servers = [
            RTCIceServer(
                urls=item.get("urls") or [],
                username=item.get("username"),
                credential=item.get("credential"),
            )
            for item in raw_servers
            if item.get("urls")
        ]

    async def _send(self, payload: dict) -> None:
        if self.websocket is None:
            raise RuntimeError("Voice websocket is not connected")
        async with self._send_lock:
            await self.websocket.send(json.dumps(payload, separators=(",", ":")))

    async def _heartbeat(self, interval_ms: int) -> None:
        while True:
            await asyncio.sleep(interval_ms / 1000)
            await self._send(
                {
                    "op": 3,
                    "d": {"t": int(time.time() * 1000), "seq_ack": self._last_seq},
                }
            )

    async def _receive(self) -> None:
        assert self.websocket is not None
        try:
            async for raw in self.websocket:
                payload = json.loads(raw)
                if isinstance(payload.get("seq"), int):
                    self._last_seq = payload["seq"]
                op = payload.get("op")
                data = payload.get("d") if isinstance(payload.get("d"), dict) else {}
                if op == 11:
                    await self._participant_connected(int(data["user_id"]))
                elif op == 13:
                    await self._remove_peer(int(data["user_id"]))
                elif payload.get("type") == "offer":
                    await self._handle_offer(int(payload["from_id"]), payload["offer"])
                elif payload.get("type") == "answer":
                    await self._handle_answer(int(payload["from_id"]), payload["answer"])
                elif payload.get("type") == "ice_candidate":
                    await self._handle_candidate(
                        int(payload["from_id"]), payload.get("candidate")
                    )
                elif payload.get("type") == "request_offer":
                    await self._send_offer(int(payload["from_id"]), recreate=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            print(f"voice receive error: {type(exc).__name__}: {exc}")

    async def _participant_connected(self, remote_user_id: int) -> None:
        if remote_user_id == self.user_id or remote_user_id in self.peers:
            return
        await self._ensure_peer(remote_user_id)
        if self.user_id < remote_user_id:
            await self._send_offer(remote_user_id)

    async def _ensure_peer(self, remote_user_id: int) -> RTCPeerConnection:
        existing = self.peers.get(remote_user_id)
        if existing is not None:
            return existing
        pc = RTCPeerConnection(RTCConfiguration(iceServers=self.ice_servers))
        pc.addTrack(self.relay.subscribe(self.audio))
        self.peers[remote_user_id] = pc

        @pc.on("icecandidate")
        async def on_icecandidate(candidate: RTCIceCandidate | None) -> None:
            payload = None
            if candidate is not None:
                payload = {
                    "candidate": f"candidate:{candidate_to_sdp(candidate)}",
                    "sdpMid": candidate.sdpMid,
                    "sdpMLineIndex": candidate.sdpMLineIndex,
                }
            await self._send(
                {
                    "type": "ice_candidate",
                    "target_id": remote_user_id,
                    "candidate": payload,
                }
            )

        @pc.on("connectionstatechange")
        async def on_connectionstatechange() -> None:
            if pc.connectionState in {"failed", "closed"}:
                await self._remove_peer(remote_user_id)

        return pc

    async def _send_offer(self, remote_user_id: int, *, recreate: bool = False) -> None:
        if recreate:
            await self._remove_peer(remote_user_id)
        pc = await self._ensure_peer(remote_user_id)
        if pc.signalingState != "stable":
            return
        offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        await self._send(
            {
                "type": "offer",
                "target_id": remote_user_id,
                "offer": {
                    "type": pc.localDescription.type,
                    "sdp": pc.localDescription.sdp,
                },
            }
        )

    async def _handle_offer(self, remote_user_id: int, offer: dict) -> None:
        pc = await self._ensure_peer(remote_user_id)
        await pc.setRemoteDescription(
            RTCSessionDescription(sdp=str(offer["sdp"]), type=str(offer["type"]))
        )
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await self._send(
            {
                "type": "answer",
                "target_id": remote_user_id,
                "answer": {
                    "type": pc.localDescription.type,
                    "sdp": pc.localDescription.sdp,
                },
            }
        )

    async def _handle_answer(self, remote_user_id: int, answer: dict) -> None:
        pc = self.peers.get(remote_user_id)
        if pc is None:
            return
        await pc.setRemoteDescription(
            RTCSessionDescription(sdp=str(answer["sdp"]), type=str(answer["type"]))
        )

    async def _handle_candidate(self, remote_user_id: int, payload: dict | None) -> None:
        pc = self.peers.get(remote_user_id)
        if pc is None:
            pc = await self._ensure_peer(remote_user_id)
        if payload is None:
            await pc.addIceCandidate(None)
            return
        raw = str(payload.get("candidate") or "")
        if raw.startswith("candidate:"):
            raw = raw.split(":", 1)[1]
        candidate = candidate_from_sdp(raw)
        candidate.sdpMid = payload.get("sdpMid")
        candidate.sdpMLineIndex = payload.get("sdpMLineIndex")
        await pc.addIceCandidate(candidate)

    async def _remove_peer(self, remote_user_id: int) -> None:
        pc = self.peers.pop(remote_user_id, None)
        if pc is not None:
            await pc.close()

    async def close(self) -> None:
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
        if self._receive_task is not None:
            self._receive_task.cancel()
        for task in (self._heartbeat_task, self._receive_task):
            if task is not None:
                with suppress(asyncio.CancelledError):
                    await task
        for remote_user_id in list(self.peers):
            await self._remove_peer(remote_user_id)
        if self.websocket is not None:
            await self.websocket.close()


class MiscordMusicBot:
    def __init__(self) -> None:
        self.token = os.environ["MISCORD_BOT_TOKEN"].strip()
        self.application_id = os.getenv("MISCORD_APPLICATION_ID", "").strip() or _application_id_from_token(self.token)
        self.api_base = os.getenv("MISCORD_API_BASE", "https://miscord.ru/api/v10").rstrip("/")
        self.gateway_url = os.getenv(
            "MISCORD_GATEWAY", "wss://miscord.ru/gateway?v=10&encoding=json"
        )
        self.websocket = None
        self.user_id = 0
        self.sequence: int | None = None
        self._send_lock = asyncio.Lock()
        self._heartbeat_task: asyncio.Task | None = None
        self._interaction_tasks: set[asyncio.Task] = set()
        self.voice_states: dict[tuple[int, int], int] = {}
        self.pending_voice: dict[int, dict] = {}
        self.voice_connections: dict[int, VoiceConnection] = {}
        self.players: dict[int, GuildMusicPlayer] = {}
        self.http = httpx.AsyncClient(timeout=20)

    async def run(self) -> None:
        while True:
            try:
                await self._gateway_session()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                print(f"gateway error: {type(exc).__name__}: {exc}")
            await asyncio.sleep(3)

    async def _gateway_session(self) -> None:
        async with websockets.connect(
            self.gateway_url, max_size=4 * 1024 * 1024, ping_interval=None
        ) as websocket:
            self.websocket = websocket
            try:
                async for raw in websocket:
                    payload = json.loads(raw)
                    if payload.get("s") is not None:
                        self.sequence = int(payload["s"])
                    op = payload.get("op")
                    if op == 10:
                        interval = int(payload["d"]["heartbeat_interval"])
                        self._heartbeat_task = asyncio.create_task(self._heartbeat(interval))
                        await self._send(
                            {
                                "op": 2,
                                "d": {
                                    "token": self.token,
                                    "intents": GATEWAY_INTENTS,
                                    "properties": {
                                        "os": os.name,
                                        "browser": "miscord-music-bot",
                                        "device": "miscord-music-bot",
                                    },
                                },
                            }
                        )
                    elif op == 0:
                        await self._dispatch(payload.get("t"), payload.get("d") or {})
            finally:
                if self._heartbeat_task is not None:
                    self._heartbeat_task.cancel()
                    with suppress(asyncio.CancelledError):
                        await self._heartbeat_task
                    self._heartbeat_task = None
                if self.websocket is websocket:
                    self.websocket = None

    async def _send(self, payload: dict) -> None:
        if self.websocket is None:
            raise RuntimeError("Gateway is not connected")
        async with self._send_lock:
            await self.websocket.send(json.dumps(payload, separators=(",", ":")))

    async def _heartbeat(self, interval_ms: int) -> None:
        while True:
            await asyncio.sleep(interval_ms / 1000)
            await self._send({"op": 1, "d": self.sequence})

    async def _dispatch(self, event: str | None, data: dict) -> None:
        if event == "READY":
            self.user_id = int(data["user"]["id"])
            print(f"music bot ready as {data['user']['username']}")
            return
        if event == "GUILD_CREATE":
            guild_id = int(data.get("id") or 0)
            if guild_id > 0:
                self.voice_states = {
                    key: channel_id
                    for key, channel_id in self.voice_states.items()
                    if key[0] != guild_id
                }
            states = data.get("voice_states") or []
            for state in states:
                self._remember_voice_state(state)
            print(
                f"guild snapshot guild={data.get('id')} "
                f"voice_states={len(states)} cached={len(self.voice_states)}"
            )
            return
        if event == "VOICE_STATE_UPDATE":
            self._remember_voice_state(data)
            guild_id = int(data.get("guild_id") or 0)
            print(
                f"voice state guild={guild_id} user={data.get('user_id')} "
                f"channel={data.get('channel_id')} cached={len(self.voice_states)}"
            )
            if int(data.get("user_id") or 0) == self.user_id and guild_id in self.pending_voice:
                self.pending_voice[guild_id]["state"] = data
                self._finish_pending_voice(guild_id)
            return
        if event == "VOICE_SERVER_UPDATE":
            guild_id = int(data.get("guild_id") or 0)
            if guild_id in self.pending_voice:
                self.pending_voice[guild_id]["server"] = data
                self._finish_pending_voice(guild_id)
            return
        if event == "INTERACTION_CREATE":
            task = asyncio.create_task(self._handle_interaction(data))
            self._interaction_tasks.add(task)
            task.add_done_callback(self._interaction_tasks.discard)

    def _remember_voice_state(self, state: dict) -> None:
        guild_id = int(state.get("guild_id") or 0)
        user_id = int(state.get("user_id") or 0)
        raw_channel_id = state.get("channel_id")
        if guild_id <= 0 or user_id <= 0:
            return
        key = (guild_id, user_id)
        if raw_channel_id is None:
            self.voice_states.pop(key, None)
        else:
            self.voice_states[key] = int(raw_channel_id)

    def _finish_pending_voice(self, guild_id: int) -> None:
        pending = self.pending_voice[guild_id]
        if pending.get("state") and pending.get("server"):
            pending["event"].set()

    async def _join_voice(
        self, guild_id: int, channel_id: int, player: GuildMusicPlayer
    ) -> VoiceConnection:
        current = self.voice_connections.get(guild_id)
        if current is not None and current.channel_id == channel_id:
            return current
        if current is not None:
            await current.close()
        pending = {"state": None, "server": None, "event": asyncio.Event()}
        self.pending_voice[guild_id] = pending
        await self._send(
            {
                "op": 4,
                "d": {
                    "guild_id": str(guild_id),
                    "channel_id": str(channel_id),
                    "self_mute": False,
                    "self_deaf": True,
                },
            }
        )
        try:
            await asyncio.wait_for(pending["event"].wait(), timeout=10)
        finally:
            self.pending_voice.pop(guild_id, None)
        state = pending["state"]
        server = pending["server"]
        connection = VoiceConnection(
            endpoint=str(server["endpoint"]),
            guild_id=guild_id,
            channel_id=channel_id,
            user_id=self.user_id,
            session_id=str(state["session_id"]),
            token=str(server["token"]),
            audio=player.audio,
        )
        await connection.connect()
        self.voice_connections[guild_id] = connection
        return connection

    async def _leave_voice(self, guild_id: int) -> None:
        connection = self.voice_connections.pop(guild_id, None)
        await self._send(
            {
                "op": 4,
                "d": {
                    "guild_id": str(guild_id),
                    "channel_id": None,
                    "self_mute": False,
                    "self_deaf": True,
                },
            }
        )
        if connection is not None:
            await connection.close()

    async def _respond(self, interaction: dict, content: str, *, ephemeral: bool = False) -> None:
        flags = 64 if ephemeral else 0
        response = await self.http.post(
            f"{self.api_base}/interactions/{interaction['id']}/{interaction['token']}/callback",
            json={"type": 4, "data": {"content": content[:2000], "flags": flags}},
        )
        response.raise_for_status()

    async def _defer(self, interaction: dict, *, ephemeral: bool = False) -> None:
        response = await self.http.post(
            f"{self.api_base}/interactions/{interaction['id']}/{interaction['token']}/callback",
            json={"type": 5, "data": {"flags": 64 if ephemeral else 0}},
        )
        response.raise_for_status()

    async def _edit_deferred_response(self, interaction: dict, content: str) -> None:
        response = await self.http.patch(
            f"{self.api_base}/webhooks/{self.application_id}/{interaction['token']}/messages/@original",
            json={"content": content[:2000]},
        )
        response.raise_for_status()

    async def _handle_interaction(self, interaction: dict) -> None:
        name = str(interaction.get("data", {}).get("name") or "")
        guild_id = int(interaction.get("guild_id") or 0)
        member = interaction.get("member") or {}
        user = member.get("user") or interaction.get("user") or {}
        user_id = int(user.get("id") or 0)
        if guild_id <= 0:
            await self._respond(interaction, "Музыкальные команды работают только на сервере.", ephemeral=True)
            return
        player = self.players.setdefault(guild_id, GuildMusicPlayer())
        deferred = False
        try:
            if name == "play":
                url = _option(interaction, "url")
                if not url:
                    await self._respond(interaction, "Укажите ссылку.", ephemeral=True)
                    return
                _validate_youtube_url(url)
                channel_id = self.voice_states.get((guild_id, user_id))
                if channel_id is None:
                    print(
                        f"voice lookup miss guild={guild_id} user={user_id} "
                        f"cached={len(self.voice_states)}"
                    )
                    await self._respond(
                        interaction,
                        "Сначала войдите в голосовой канал.",
                        ephemeral=True,
                    )
                    return
                await self._defer(interaction)
                deferred = True
                await self._join_voice(guild_id, channel_id, player)
                await player.enqueue(url)
                await self._edit_deferred_response(
                    interaction, f"Добавлено в очередь: {url}"
                )
                return
            if name == "skip":
                skipped = await player.skip()
                await self._respond(
                    interaction,
                    "Трек пропущен." if skipped else "Сейчас ничего не играет.",
                    ephemeral=not skipped,
                )
                return
            if name == "stop":
                await player.stop()
                await self._leave_voice(guild_id)
                await self._respond(interaction, "Воспроизведение остановлено.")
                return
            if name == "queue":
                current = player.current_title or "ничего"
                await self._respond(
                    interaction,
                    f"Сейчас играет: **{current}**\nВ очереди: **{player.queued}**",
                    ephemeral=True,
                )
                return
        except asyncio.TimeoutError:
            message = "Не удалось войти в голосовой канал: проверьте права Просматривать канал, Подключаться и Говорить."
            if deferred:
                await self._edit_deferred_response(interaction, message)
            else:
                await self._respond(interaction, message, ephemeral=True)
        except Exception as exc:
            print(f"interaction error: {type(exc).__name__}: {exc}")
            with suppress(Exception):
                if deferred:
                    await self._edit_deferred_response(
                        interaction, "Не удалось выполнить команду."
                    )
                else:
                    await self._respond(
                        interaction, "Не удалось выполнить команду.", ephemeral=True
                    )

    async def close(self) -> None:
        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
        for connection in list(self.voice_connections.values()):
            await connection.close()
        for player in list(self.players.values()):
            await player.close()
        for task in list(self._interaction_tasks):
            task.cancel()
        await self.http.aclose()


async def main() -> None:
    load_dotenv()
    bot = MiscordMusicBot()
    try:
        await bot.run()
    finally:
        await bot.close()


if __name__ == "__main__":
    asyncio.run(main())
