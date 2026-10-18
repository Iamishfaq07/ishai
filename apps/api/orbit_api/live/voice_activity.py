"""The candidate's voice on the mic, heard by the server itself (DECISIONS D76).

The AI video interview ends a turn when the candidate stops talking. The transcriber's words come in bursts about a
second apart, so "no new words for 900 ms" happened mid-sentence (she cut in) and its final words came ~0.5 s after
they'd actually stopped (she was slow). The audio itself says when they talk: a frame clearly louder than the room's
noise is their voice. Cheap (a quarter of the samples of each frame), and only a level, never kept.
"""

import array
import math
import sys

MIN_LEVEL = 0.012  # RMS (0..1) of quiet speech on a laptop mic, after the browser's own gain
OVER_FLOOR = 3.0  # this many times the room's noise
RISE = 0.002  # per frame: how fast the noise floor follows a louder room (it follows a quieter one at once)


class VoiceActivity:
    def __init__(self) -> None:
        self.floor = 0.005

    def voiced(self, pcm: bytes) -> bool:
        """Whether this PCM16 mono frame (little-endian) carries a voice."""
        samples = array.array("h")
        samples.frombytes(pcm[: len(pcm) - len(pcm) % 2])
        if sys.byteorder == "big":
            samples.byteswap()
        sub = samples[::4] if len(samples) >= 256 else samples
        if not sub:
            return False
        rms = math.sqrt(sum(v * v for v in sub) / len(sub)) / 32768
        self.floor = rms if rms < self.floor else self.floor + (rms - self.floor) * RISE
        return rms >= max(MIN_LEVEL, self.floor * OVER_FLOOR)
