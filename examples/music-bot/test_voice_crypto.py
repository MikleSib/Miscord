import struct

import nacl.bindings

from miscord_voice import RtpCipher, make_rtp


def test_rtp_header_and_xchacha_payload() -> None:
    key = bytes(range(32))
    clear = make_rtp(b"opus", 65535, 0xFFFF_FF00, 0xDEAD_BEEF)
    encrypted = RtpCipher(key).encrypt(clear)

    assert encrypted[:12] == clear[:12]
    assert encrypted[-4:] == b"\0\0\0\0"
    nonce = encrypted[-4:] + bytes(20)
    payload = nacl.bindings.crypto_aead_xchacha20poly1305_ietf_decrypt(
        encrypted[12:-4], encrypted[:12], nonce, key,
    )
    assert payload == b"opus"
    assert struct.unpack_from(">H", clear, 2)[0] == 65535
