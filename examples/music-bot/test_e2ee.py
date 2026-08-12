import base64
import os
import unittest

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from e2ee import BotE2EE


class BotE2EETest(unittest.TestCase):
    def envelope(self, bot: BotE2EE, epoch: int, secret: bytes) -> dict:
        public = serialization.load_der_public_key(base64.b64decode(bot.public_key_b64))
        ephemeral = ec.generate_private_key(ec.SECP256R1())
        shared = ephemeral.exchange(ec.ECDH(), public)
        salt = os.urandom(16)
        iv = os.urandom(12)
        info = f"miscord-bot-media-envelope-v1\0{epoch}\0{bot.credential_id}".encode()
        key = HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=info).derive(shared)
        ephemeral_public = ephemeral.public_key().public_bytes(
            serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        return {
            "epoch": str(epoch), "credential_id": bot.credential_id,
            "ephemeral_key": base64.b64encode(ephemeral_public).decode(),
            "salt": base64.b64encode(salt).decode(),
            "iv": base64.b64encode(iv).decode(),
            "ciphertext": base64.b64encode(AESGCM(key).encrypt(iv, secret, info)).decode(),
        }

    def test_envelope_frame_roundtrip_tamper_and_replay(self) -> None:
        sender = BotE2EE("42:session")
        receiver = BotE2EE("receiver")
        secret = os.urandom(32)
        sender.install_envelope(self.envelope(sender, 7, secret))
        receiver._epoch_secrets[7] = secret
        receiver.active_epoch = 7
        encrypted = sender.encrypt_frame(b"opus-frame")
        self.assertNotIn(b"opus-frame", encrypted)
        self.assertEqual(
            receiver.decrypt_frame(encrypted, sender.credential_id), b"opus-frame",
        )
        with self.assertRaisesRegex(ValueError, "Replayed"):
            receiver.decrypt_frame(encrypted, sender.credential_id)
        fresh = bytearray(sender.encrypt_frame(b"second-frame"))
        fresh[-1] ^= 1
        with self.assertRaises(Exception):
            receiver.decrypt_frame(bytes(fresh), sender.credential_id)


if __name__ == "__main__":
    unittest.main()
