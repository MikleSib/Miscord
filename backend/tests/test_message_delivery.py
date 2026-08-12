from app.services.message_delivery import message_ack_payload


def test_message_ack_contains_authoritative_saved_message() -> None:
    message = {
        "id": 42,
        "client_nonce": "client-123",
        "content": "hello",
        "channelId": 7,
    }

    assert message_ack_payload(message) == {
        "type": "message_ack",
        "data": {
            "id": 42,
            "client_nonce": "client-123",
            "message": message,
        },
    }
