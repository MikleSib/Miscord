from app.services.webhook_security import (
    decrypt_webhook_token,
    encrypt_webhook_token,
    generate_webhook_token,
    hash_webhook_token,
    verify_webhook_token,
)


def test_token_round_trip():
    token = generate_webhook_token()
    assert len(token) == 43
    assert decrypt_webhook_token(encrypt_webhook_token(token)) == token
    assert verify_webhook_token(token, hash_webhook_token(token))
    assert not verify_webhook_token(token + "x", hash_webhook_token(token))
