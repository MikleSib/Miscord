import asyncio
import unittest
from fractions import Fraction

from aiortc import AudioStreamTrack
from av import AudioFrame

from bot import (
    AUDIO_SAMPLE_RATE,
    AUDIO_SAMPLES_PER_FRAME,
    AudioBus,
    GuildMusicPlayer,
)


class FiniteAudioSource(AudioStreamTrack):
    def __init__(self, frame_count: int) -> None:
        super().__init__()
        self._remaining = frame_count
        self._pts = 0

    async def recv(self) -> AudioFrame:
        if self._remaining <= 0:
            raise AssertionError("test source ran out of frames")
        self._remaining -= 1
        frame = AudioFrame(
            format="s16", layout="stereo", samples=AUDIO_SAMPLES_PER_FRAME
        )
        for plane in frame.planes:
            plane.update(bytes(plane.buffer_size))
        frame.sample_rate = AUDIO_SAMPLE_RATE
        frame.pts = self._pts
        frame.time_base = Fraction(1, AUDIO_SAMPLE_RATE)
        self._pts += AUDIO_SAMPLES_PER_FRAME
        return frame


class AudioBusTests(unittest.IsolatedAsyncioTestCase):
    async def test_timestamps_remain_continuous_across_silence_and_new_sources(self) -> None:
        bus = AudioBus()

        silence = await bus.recv()
        await bus.set_source(FiniteAudioSource(1))
        first_song = await bus.recv()
        await bus.set_source(FiniteAudioSource(1))
        second_song = await bus.recv()

        self.assertEqual(silence.pts, 0)
        self.assertEqual(first_song.pts, AUDIO_SAMPLES_PER_FRAME)
        self.assertEqual(second_song.pts, AUDIO_SAMPLES_PER_FRAME * 2)
        self.assertEqual(second_song.sample_rate, AUDIO_SAMPLE_RATE)
        self.assertEqual(second_song.samples, AUDIO_SAMPLES_PER_FRAME)
        self.assertEqual(second_song.format.name, "s16")
        self.assertEqual(second_song.layout.name, "stereo")

    async def test_player_relay_survives_reconnect_without_a_second_reader(self) -> None:
        player = GuildMusicPlayer()
        try:
            first_listener = player.relay.subscribe(player.audio, buffered=False)
            first_frame = await first_listener.recv()
            first_listener.stop()

            await asyncio.sleep(0.04)

            second_listener = player.relay.subscribe(player.audio, buffered=False)
            second_frame = await second_listener.recv()
            second_listener.stop()

            self.assertGreater(second_frame.pts, first_frame.pts)
            self.assertEqual(len(player.relay._MediaRelay__tasks), 1)
        finally:
            await player.close()


if __name__ == "__main__":
    unittest.main()
