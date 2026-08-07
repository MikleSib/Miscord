import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.voice_session import (
    new_connection_id,
    is_active_connection,
    register_connection,
    pop_connection_if_current,
    find_user_channels,
    should_create_offer,
    participant_payload,
)


class VoiceSessionTests(unittest.TestCase):
    def test_connection_id_unique(self):
        self.assertNotEqual(new_connection_id(), new_connection_id())

    def test_register_and_active(self):
        connections = {}
        cid = new_connection_id()
        register_connection(
            connections,
            10,
            1,
            websocket=object(),
            username="misha",
            connection_id=cid,
        )
        self.assertTrue(is_active_connection(connections, 10, 1, cid))
        self.assertFalse(is_active_connection(connections, 10, 1, "other"))

    def test_superseded_connection_does_not_pop(self):
        connections = {}
        old_id = new_connection_id()
        new_id = new_connection_id()
        register_connection(
            connections,
            5,
            7,
            websocket="ws-old",
            username="a",
            connection_id=old_id,
        )
        # Новая сессия заменила старую
        register_connection(
            connections,
            5,
            7,
            websocket="ws-new",
            username="a",
            connection_id=new_id,
        )
        removed = pop_connection_if_current(connections, 5, 7, old_id)
        self.assertIsNone(removed)
        self.assertTrue(is_active_connection(connections, 5, 7, new_id))

    def test_pop_current_cleans_empty_channel(self):
        connections = {}
        cid = new_connection_id()
        register_connection(
            connections,
            3,
            9,
            websocket="ws",
            username="b",
            connection_id=cid,
        )
        removed = pop_connection_if_current(connections, 3, 9, cid)
        self.assertIsNotNone(removed)
        self.assertNotIn(3, connections)

    def test_find_user_channels(self):
        connections = {}
        register_connection(
            connections, 1, 42, websocket="a", username="u", connection_id="c1"
        )
        register_connection(
            connections, 2, 42, websocket="b", username="u", connection_id="c2"
        )
        register_connection(
            connections, 2, 99, websocket="c", username="x", connection_id="c3"
        )
        self.assertEqual(sorted(find_user_channels(connections, 42)), [1, 2])

    def test_offerer_election_no_glare(self):
        self.assertTrue(should_create_offer(1, 2))
        self.assertFalse(should_create_offer(2, 1))
        self.assertFalse(should_create_offer(5, 5))

    def test_participant_payload(self):
        payload = participant_payload(
            11,
            {
                "username": "Nick",
                "is_muted": True,
                "is_deafened": False,
                "is_sharing_screen": True,
                "connection_id": "abc123",
            },
            display_name="Display",
            avatar_url="/a.png",
        )
        self.assertEqual(payload["user_id"], 11)
        self.assertTrue(payload["is_muted"])
        self.assertTrue(payload["is_sharing_screen"])
        self.assertEqual(payload["display_name"], "Display")
        self.assertEqual(payload["connection_id"], "abc123")


if __name__ == "__main__":
    unittest.main()
