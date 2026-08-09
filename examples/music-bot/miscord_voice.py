from __future__ import annotations

import asyncio
import json
import random
import socket
import struct
import time
from contextlib import suppress
from typing import Awaitable, Callable

import nacl.bindings
import websockets
from websockets.exceptions import ConnectionClosed


MODE = "aead_xchacha20_poly1305_rtpsize"
OPUS_PAYLOAD_TYPE = 120
OPUS_SILENCE = b"\xf8\xff\xfe"
SAMPLES_PER_FRAME = 960


def make_rtp(payload: bytes, sequence: int, timestamp: int, ssrc: int) -> bytes:
    return struct.pack(">BBHII", 0x80, OPUS_PAYLOAD_TYPE, sequence & 0xFFFF, timestamp & 0xFFFFFFFF, ssrc) + payload


class RtpCipher:
    def __init__(self, key: bytes) -> None:
        if len(key) != 32:
            raise ValueError("Voice key must contain 32 bytes")
        self.key = key
        self.counter = 0

    def encrypt(self, packet: bytes) -> bytes:
        if len(packet) < 12:
            raise ValueError("RTP packet is too short")
        header, payload = packet[:12], packet[12:]
        counter = self.counter & 0xFFFFFFFF
        self.counter = (self.counter + 1) & 0xFFFFFFFF
        suffix = struct.pack(">I", counter)
        nonce = suffix + bytes(20)
        ciphertext = nacl.bindings.crypto_aead_xchacha20poly1305_ietf_encrypt(
            payload, header, nonce, self.key,
        )
        return header + ciphertext + suffix


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
    ) -> None:
        self.endpoint = endpoint
        self.guild_id = guild_id
        self.channel_id = channel_id
        self.user_id = user_id
        self.session_id = session_id
        self.token = token
        self.websocket = None
        self.udp: socket.socket | None = None
        self.remote: tuple[str, int] | None = None
        self.ssrc = 0
        self.sequence = random.randrange(0, 65536)
        self.timestamp = random.randrange(0, 2**32)
        self.cipher: RtpCipher | None = None
        self._heartbeat_task: asyncio.Task | None = None
        self._receive_task: asyncio.Task | None = None
        self._udp_receive_task: asyncio.Task | None = None
        self._send_lock = asyncio.Lock()
        self._speaking = False

    @property
    def is_connected(self) -> bool:
        return (
            self.websocket is not None
            and self._receive_task is not None
            and not self._receive_task.done()
        )

    async def connect(self) -> None:
        url = self.endpoint
        if not url.startswith(("ws://", "wss://")):
            url = f"wss://{url}"
        self.websocket = await websockets.connect(url, ping_interval=None, max_size=1024 * 1024)
        hello = await self._receive_op(8)
        interval = int(hello.get("heartbeat_interval") or 45_000)
        await self._send_op(0, {
            "server_id": str(self.guild_id),
            "user_id": str(self.user_id),
            "session_id": self.session_id,
            "token": self.token,
            "max_dave_protocol_version": 0,
        })
        ready = await self._receive_op(2)
        self.ssrc = int(ready["ssrc"])
        host, port = str(ready["ip"]), int(ready["port"])
        if MODE not in ready.get("modes", []):
            raise RuntimeError(f"Voice mode {MODE} is unavailable")
        address, local_port = await self._discover(host, port)
        await self._send_op(1, {
            "protocol": "udp",
            "data": {"address": address, "port": local_port, "mode": MODE},
        })
        description = await self._receive_op(4)
        if description.get("mode") != MODE or int(description.get("dave_protocol_version", 0)) != 0:
            raise RuntimeError("Unexpected voice session description")
        self.cipher = RtpCipher(bytes(description["secret_key"]))
        self._heartbeat_task = asyncio.create_task(self._heartbeat(interval))
        self._receive_task = asyncio.create_task(self._receive_loop())
        self._udp_receive_task = asyncio.create_task(self._udp_receive_loop())

    async def send_opus(self, opus_packet: bytes) -> None:
        if not self.cipher or not self.udp or not self.remote:
            raise RuntimeError("Voice UDP transport is not connected")
        if not self.is_connected:
            raise RuntimeError("Voice Gateway disconnected; run /play again to reconnect")
        if not self._speaking:
            self._speaking = True
            await self._send_op(5, {"speaking": 1, "delay": 0, "ssrc": self.ssrc})
        packet = make_rtp(opus_packet, self.sequence, self.timestamp, self.ssrc)
        self.sequence = (self.sequence + 1) & 0xFFFF
        self.timestamp = (self.timestamp + SAMPLES_PER_FRAME) & 0xFFFFFFFF
        await asyncio.get_running_loop().sock_sendto(self.udp, self.cipher.encrypt(packet), self.remote)

    async def stop_speaking(self) -> None:
        if not self._speaking:
            return
        for _ in range(5):
            await self.send_opus(OPUS_SILENCE)
            await asyncio.sleep(0.02)
        self._speaking = False
        await self._send_op(5, {"speaking": 0, "delay": 0, "ssrc": self.ssrc})

    async def close(self) -> None:
        with suppress(Exception):
            await self.stop_speaking()
        for task in (self._heartbeat_task, self._receive_task, self._udp_receive_task):
            if task:
                task.cancel()
        for task in (self._heartbeat_task, self._receive_task, self._udp_receive_task):
            if task:
                with suppress(asyncio.CancelledError):
                    await task
        if self.websocket:
            await self.websocket.close()
        if self.udp:
            self.udp.close()
        self.websocket = None
        self.udp = None

    async def _discover(self, host: str, port: int) -> tuple[str, int]:
        loop = asyncio.get_running_loop()
        self.udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp.setblocking(False)
        self.udp.bind(("0.0.0.0", 0))
        self.remote = (host, port)
        request = struct.pack(">HHI", 1, 70, self.ssrc) + bytes(66)
        await loop.sock_sendto(self.udp, request, self.remote)
        response, source = await asyncio.wait_for(loop.sock_recvfrom(self.udp, 74), timeout=5)
        if source != self.remote or len(response) != 74:
            raise RuntimeError("Invalid UDP discovery response")
        packet_type, length, ssrc = struct.unpack_from(">HHI", response)
        if packet_type != 2 or length != 70 or ssrc != self.ssrc:
            raise RuntimeError("UDP discovery response did not match this session")
        address = response[8:72].split(b"\0", 1)[0].decode("utf-8")
        return address, struct.unpack_from(">H", response, 72)[0]

    async def _send_op(self, op: int, data: dict) -> None:
        if not self.websocket:
            raise RuntimeError("Voice WebSocket is not connected")
        async with self._send_lock:
            await self.websocket.send(json.dumps({"op": op, "d": data}, separators=(",", ":")))

    async def _receive_op(self, expected: int) -> dict:
        if not self.websocket:
            raise RuntimeError("Voice WebSocket is not connected")
        while True:
            payload = json.loads(await self.websocket.recv())
            if int(payload.get("op", -1)) == expected:
                return payload.get("d") or {}

    async def _heartbeat(self, interval_ms: int) -> None:
        while True:
            await asyncio.sleep(interval_ms / 1000)
            await self._send_op(3, {"t": int(time.time() * 1000), "seq_ack": -1})

    async def _receive_loop(self) -> None:
        if not self.websocket:
            return
        try:
            async for raw in self.websocket:
                payload = json.loads(raw)
                if payload.get("op") == 13:
                    print(f"voice participant disconnected: {payload.get('d', {}).get('user_id')}")
        except ConnectionClosed as exc:
            print(f"voice gateway disconnected: code={exc.code} reason={exc.reason or 'none'}")
        finally:
            self._speaking = False
            if self._heartbeat_task:
                self._heartbeat_task.cancel()

    async def _udp_receive_loop(self) -> None:
        if not self.udp:
            return
        loop = asyncio.get_running_loop()
        while True:
            await loop.sock_recvfrom(self.udp, 65535)
