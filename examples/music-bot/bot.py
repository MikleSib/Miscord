from __future__ import annotations

import asyncio
import json
import os
from contextlib import suppress

import httpx
import websockets
from dotenv import load_dotenv

from miscord_voice import VoiceConnection
from music_player import GuildMusicPlayer, validate_youtube_url


INTENT_GUILDS = 1 << 0
INTENT_GUILD_VOICE_STATES = 1 << 7
GATEWAY_INTENTS = INTENT_GUILDS | INTENT_GUILD_VOICE_STATES


def application_id_from_token(token: str) -> str:
    return token.split(".", 1)[0].removeprefix("mcb_")


def option(interaction: dict, name: str) -> str | None:
    for item in interaction.get("data", {}).get("options") or []:
        if item.get("name") == name and item.get("value") is not None:
            return str(item["value"])
    return None


class MiscordMusicBot:
    def __init__(self) -> None:
        self.token = os.environ["MISCORD_BOT_TOKEN"].strip()
        self.application_id = os.getenv("MISCORD_APPLICATION_ID", "").strip() or application_id_from_token(self.token)
        self.api_base = os.getenv("MISCORD_API_BASE", "https://miscord.ru/api/v1").rstrip("/")
        self.gateway_url = os.getenv(
            "MISCORD_GATEWAY", "wss://miscord.ru/gateway?v=1&encoding=json",
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
            self.gateway_url, max_size=4 * 1024 * 1024, ping_interval=None,
        ) as websocket:
            self.websocket = websocket
            try:
                async for raw in websocket:
                    payload = json.loads(raw)
                    if payload.get("s") is not None:
                        self.sequence = int(payload["s"])
                    if payload.get("op") == 10:
                        interval = int(payload["d"]["heartbeat_interval"])
                        self._heartbeat_task = asyncio.create_task(self._heartbeat(interval))
                        await self._send({
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
                        })
                    elif payload.get("op") == 0:
                        await self._dispatch(payload.get("t"), payload.get("d") or {})
            finally:
                if self._heartbeat_task:
                    self._heartbeat_task.cancel()
                    with suppress(asyncio.CancelledError):
                        await self._heartbeat_task
                    self._heartbeat_task = None
                if self.websocket is websocket:
                    self.websocket = None

    async def _send(self, payload: dict) -> None:
        if not self.websocket:
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
        elif event == "GUILD_CREATE":
            guild_id = int(data.get("id") or 0)
            self.voice_states = {
                key: value for key, value in self.voice_states.items() if key[0] != guild_id
            }
            for state in data.get("voice_states") or []:
                self._remember_voice_state(state)
        elif event == "VOICE_STATE_UPDATE":
            self._remember_voice_state(data)
            guild_id = int(data.get("guild_id") or 0)
            if int(data.get("user_id") or 0) == self.user_id and guild_id in self.pending_voice:
                self.pending_voice[guild_id]["state"] = data
                self._finish_pending_voice(guild_id)
        elif event == "VOICE_SERVER_UPDATE":
            guild_id = int(data.get("guild_id") or 0)
            if guild_id in self.pending_voice:
                self.pending_voice[guild_id]["server"] = data
                self._finish_pending_voice(guild_id)
        elif event == "INTERACTION_CREATE":
            task = asyncio.create_task(self._handle_interaction(data))
            self._interaction_tasks.add(task)
            task.add_done_callback(self._interaction_tasks.discard)

    def _remember_voice_state(self, state: dict) -> None:
        guild_id = int(state.get("guild_id") or 0)
        user_id = int(state.get("user_id") or 0)
        if guild_id <= 0 or user_id <= 0:
            return
        key = (guild_id, user_id)
        if state.get("channel_id") is None:
            self.voice_states.pop(key, None)
        else:
            self.voice_states[key] = int(state["channel_id"])

    def _finish_pending_voice(self, guild_id: int) -> None:
        pending = self.pending_voice[guild_id]
        if pending.get("state") and pending.get("server"):
            pending["event"].set()

    async def _join_voice(
        self, guild_id: int, channel_id: int, player: GuildMusicPlayer,
    ) -> VoiceConnection:
        current = self.voice_connections.get(guild_id)
        if current and current.channel_id == channel_id and current.is_connected:
            player.attach(current)
            return current
        if current:
            await current.close()
            self.voice_connections.pop(guild_id, None)
        pending = {"state": None, "server": None, "event": asyncio.Event()}
        self.pending_voice[guild_id] = pending
        await self._send({
            "op": 4,
            "d": {
                "guild_id": str(guild_id),
                "channel_id": str(channel_id),
                "self_mute": False,
                "self_deaf": False,
            },
        })
        try:
            await asyncio.wait_for(pending["event"].wait(), timeout=10)
        finally:
            self.pending_voice.pop(guild_id, None)
        state, server = pending["state"], pending["server"]
        connection = VoiceConnection(
            endpoint=str(server["endpoint"]),
            guild_id=guild_id,
            channel_id=channel_id,
            user_id=self.user_id,
            session_id=str(state["session_id"]),
            token=str(server["token"]),
        )
        await connection.connect()
        print(f"voice connected: guild={guild_id} channel={channel_id}")
        self.voice_connections[guild_id] = connection
        player.attach(connection)
        return connection

    async def _leave_voice(self, guild_id: int) -> None:
        connection = self.voice_connections.pop(guild_id, None)
        await self._send({
            "op": 4,
            "d": {"guild_id": str(guild_id), "channel_id": None, "self_mute": False, "self_deaf": False},
        })
        if connection:
            await connection.close()

    async def _respond(self, interaction: dict, content: str, *, ephemeral: bool = False) -> None:
        response = await self.http.post(
            f"{self.api_base}/interactions/{interaction['id']}/{interaction['token']}/callback",
            json={"type": 4, "data": {"content": content[:2000], "flags": 64 if ephemeral else 0}},
        )
        response.raise_for_status()

    async def _defer(self, interaction: dict) -> None:
        response = await self.http.post(
            f"{self.api_base}/interactions/{interaction['id']}/{interaction['token']}/callback",
            json={"type": 5, "data": {"flags": 0}},
        )
        response.raise_for_status()

    async def _edit_deferred(self, interaction: dict, content: str) -> None:
        application_id = str(interaction.get("application_id") or self.application_id)
        response = await self.http.patch(
            f"{self.api_base}/webhooks/{application_id}/{interaction['token']}/messages/@original",
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
                url = option(interaction, "url")
                if not url:
                    await self._respond(interaction, "Укажите ссылку.", ephemeral=True)
                    return
                validate_youtube_url(url)
                channel_id = self.voice_states.get((guild_id, user_id))
                if channel_id is None:
                    await self._respond(interaction, "Сначала войдите в голосовой канал.", ephemeral=True)
                    return
                await self._defer(interaction)
                deferred = True
                await self._join_voice(guild_id, channel_id, player)
                await player.enqueue(url)
                await self._edit_deferred(interaction, f"Добавлено в очередь: {url}")
            elif name == "skip":
                skipped = await player.skip()
                await self._respond(interaction, "Трек пропущен." if skipped else "Сейчас ничего не играет.", ephemeral=not skipped)
            elif name == "stop":
                await self._defer(interaction)
                deferred = True
                await player.close()
                self.players.pop(guild_id, None)
                await self._leave_voice(guild_id)
                await self._edit_deferred(interaction, "Воспроизведение остановлено.")
            elif name == "queue":
                await self._respond(
                    interaction,
                    f"Сейчас играет: **{player.current_title or 'ничего'}**\nВ очереди: **{player.queued}**",
                    ephemeral=True,
                )
        except Exception as exc:
            if isinstance(exc, httpx.HTTPStatusError):
                response = exc.response
                try:
                    detail = response.json()
                    code = detail.get("code")
                    description = detail.get("message") or detail.get("detail")
                except ValueError:
                    code, description = None, None
                print(
                    "interaction error: "
                    f"status={response.status_code} code={code} message={description or 'unknown'}"
                )
            else:
                print(f"interaction error: {type(exc).__name__}: {exc}")
            message = "Не удалось выполнить команду. Проверьте права бота и ссылку."
            with suppress(Exception):
                if deferred:
                    await self._edit_deferred(interaction, message)
                else:
                    await self._respond(interaction, message, ephemeral=True)

    async def close(self) -> None:
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        for player in list(self.players.values()):
            await player.close()
        for connection in list(self.voice_connections.values()):
            await connection.close()
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
