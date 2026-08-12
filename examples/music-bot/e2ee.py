from __future__ import annotations

import base64
import os
import struct
from dataclasses import dataclass

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF


MAGIC = 0x4D434531
VERSION = 1
HEADER_BYTES = 26
SOURCE_CODES = {"microphone": 1, "screen-audio": 2, "screen-video": 3}
REPLAY_WINDOW = 256


def _decode(value: str) -> bytes:
    return base64.b64decode(value, validate=True)


def _info(epoch: int, credential_id: str) -> bytes:
    return f"miscord-bot-media-envelope-v1\0{epoch}\0{credential_id}".encode()


@dataclass
class ReplayState:
    highest: int
    seen: set[int]


class BotE2EE:
    def __init__(self, credential_id: str) -> None:
        self.credential_id = credential_id
        self._private_key = ec.generate_private_key(ec.SECP256R1())
        self._epoch_secrets: dict[int, bytes] = {}
        self._media_keys: dict[tuple[int, str, str], bytes] = {}
        self._replays: dict[tuple[str, str, int, bytes], ReplayState] = {}
        self._send_counter = 0
        self._send_salt = os.urandom(4)
        self.active_epoch: int | None = None

    @property
    def public_key_b64(self) -> str:
        value = self._private_key.public_key().public_bytes(
            serialization.Encoding.DER,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        return base64.b64encode(value).decode()

    def install_envelope(self, payload: dict) -> int:
        epoch = int(payload["epoch"])
        credential_id = str(payload["credential_id"])
        if credential_id != self.credential_id:
            raise ValueError("Bot E2EE envelope credential mismatch")
        ephemeral = serialization.load_der_public_key(_decode(str(payload["ephemeral_key"])))
        if not isinstance(ephemeral, ec.EllipticCurvePublicKey):
            raise ValueError("Bot E2EE envelope key is invalid")
        shared = self._private_key.exchange(ec.ECDH(), ephemeral)
        info = _info(epoch, credential_id)
        key = HKDF(
            algorithm=hashes.SHA256(), length=32,
            salt=_decode(str(payload["salt"])), info=info,
        ).derive(shared)
        iv = _decode(str(payload["iv"]))
        ciphertext = _decode(str(payload["ciphertext"]))
        decryptor = Cipher(algorithms.AES(key), modes.GCM(iv, ciphertext[-16:])).decryptor()
        decryptor.authenticate_additional_data(info)
        root = decryptor.update(ciphertext[:-16]) + decryptor.finalize()
        if len(root) != 32:
            raise ValueError("Bot E2EE root secret has an invalid size")
        self._epoch_secrets[epoch] = root
        self.active_epoch = epoch
        for old_epoch in list(self._epoch_secrets):
            if old_epoch < epoch - 2:
                del self._epoch_secrets[old_epoch]
        return epoch

    def encrypt_frame(self, plaintext: bytes, source: str = "microphone") -> bytes:
        epoch = self._require_epoch()
        self._send_counter += 1
        header = struct.pack(
            ">IBBQQ4s", MAGIC, VERSION, SOURCE_CODES[source],
            epoch, self._send_counter, self._send_salt,
        )
        nonce = self._send_salt + struct.pack(">Q", self._send_counter)
        encryptor = Cipher(algorithms.AES(self._media_key(epoch, self.credential_id, source)), modes.GCM(nonce)).encryptor()
        encryptor.authenticate_additional_data(header)
        ciphertext = encryptor.update(plaintext) + encryptor.finalize()
        return header + ciphertext + encryptor.tag[:8]

    def decrypt_frame(self, data: bytes, sender: str, source: str = "microphone") -> bytes:
        if len(data) <= HEADER_BYTES + 8:
            raise ValueError("Encrypted media frame is too short")
        magic, version, source_code, epoch, counter, salt = struct.unpack(">IBBQQ4s", data[:HEADER_BYTES])
        if magic != MAGIC or version != VERSION:
            raise ValueError("Plaintext media frame rejected")
        if source_code != SOURCE_CODES[source]:
            raise ValueError("Encrypted media source mismatch")
        self._accept_counter(sender, source, epoch, salt, counter)
        nonce = salt + struct.pack(">Q", counter)
        decryptor = Cipher(
            algorithms.AES(self._media_key(epoch, sender, source)),
            modes.GCM(nonce, data[-8:], min_tag_length=8),
        ).decryptor()
        decryptor.authenticate_additional_data(data[:HEADER_BYTES])
        return decryptor.update(data[HEADER_BYTES:-8]) + decryptor.finalize()

    def _media_key(self, epoch: int, credential_id: str, source: str) -> bytes:
        cache_key = (epoch, credential_id, source)
        cached = self._media_keys.get(cache_key)
        if cached:
            return cached
        root = self._epoch_secrets.get(epoch)
        if not root:
            raise ValueError("Bot media epoch key is unavailable")
        info = f"miscord-media-v1\0{credential_id}\0{source}".encode()
        key = HKDF(algorithm=hashes.SHA256(), length=16, salt=b"", info=info).derive(root)
        self._media_keys[cache_key] = key
        return key

    def _accept_counter(self, sender: str, source: str, epoch: int, salt: bytes, counter: int) -> None:
        key = (sender, source, epoch, salt)
        state = self._replays.get(key)
        if not state:
            self._replays[key] = ReplayState(counter, {counter})
            return
        if counter + REPLAY_WINDOW <= state.highest or counter in state.seen:
            raise ValueError("Replayed media frame rejected")
        state.highest = max(state.highest, counter)
        state.seen.add(counter)
        floor = max(0, state.highest - REPLAY_WINDOW)
        state.seen = {value for value in state.seen if value >= floor}

    def _require_epoch(self) -> int:
        if self.active_epoch is None:
            raise RuntimeError("Bot DAVE/E2EE epoch is not active")
        return self.active_epoch
