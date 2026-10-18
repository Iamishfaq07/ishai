"""Per-session latency samples measured the way the user feels them: from the moment the interviewer's audio
says speech started/ended (the STT provider's audio timeline mapped onto the server clock), not from when a
packet was sent.

    stt_first_partial         speech start → first partial transcript of the turn
    stt_final                 speech end   → final transcript
    question_after_speech     speech end   → question detected (finalizer + endpointing wait)
    first_token_after_speech  speech end   → first answer token (the number that matters in an interview)
    first_token_after_question  question detected → first answer token (LLM + retrieval)
    mock_reply_after_speech   the AI interviewer: candidate's speech end → her next line sent (end of turn + writing)
    mock_audio_after_speech   the AI interviewer: candidate's speech end → her voice starts on their device (what
                              makes her feel human; the client reports when it starts)

Samples are kept as raw lists (capped) so percentiles can be computed across sessions.
"""

import bisect
from collections.abc import Iterable, Mapping

METRICS = ("stt_first_partial", "stt_final", "question_after_speech", "first_token_after_speech",
           "first_token_after_question", "mock_reply_after_speech", "mock_audio_after_speech")
MAX_SAMPLES = 200  # per metric per session
MAX_PLAUSIBLE_MS = 60_000  # anything beyond is clock misalignment (pause/resume), not latency


class AudioClock:
    """Maps a position on one channel's STT audio timeline (what the provider's timestamps count: audio actually
    sent to it, PCM16 mono 16 kHz) to the server time that audio was sent. Robust to pauses, where audio isn't
    forwarded and the provider's timeline stops while the wall clock runs on."""

    BYTES_PER_MS = 32
    MAX_FRAMES = 3000  # ~2.5 min at 50 ms frames — far longer than any turn

    def __init__(self) -> None:
        self._audio_end_ms: list[float] = []  # cumulative audio duration after each frame
        self._sent_at_ms: list[int] = []
        self._total_ms = 0.0

    def sent(self, nbytes: int, server_ms: int) -> None:
        self._total_ms += nbytes / self.BYTES_PER_MS
        self._audio_end_ms.append(self._total_ms)
        self._sent_at_ms.append(server_ms)
        if len(self._sent_at_ms) > self.MAX_FRAMES:
            del self._audio_end_ms[:500], self._sent_at_ms[:500]

    def server_time(self, audio_ms: float) -> int | None:
        """When the audio at `audio_ms` reached the server, or None if unknown (no audio / aged out)."""
        if not self._audio_end_ms or audio_ms < self._audio_end_ms[0] - 1000 or audio_ms > self._total_ms + 250:
            return None
        i = min(bisect.bisect_left(self._audio_end_ms, audio_ms), len(self._audio_end_ms) - 1)
        return self._sent_at_ms[i]


class LatencySamples:
    def __init__(self) -> None:
        self.samples: dict[str, list[int]] = {m: [] for m in METRICS}

    def add(self, metric: str, ms: float) -> None:
        if metric not in self.samples or not 0 <= ms <= MAX_PLAUSIBLE_MS:
            return
        bucket = self.samples[metric]
        bucket.append(int(ms))
        if len(bucket) > MAX_SAMPLES:
            del bucket[0]

    def as_dict(self) -> dict[str, list[int]]:
        return {m: list(v) for m, v in self.samples.items() if v}


def merge(stored: Mapping[str, list[int]] | None, new: Mapping[str, list[int]]) -> dict[str, list[int]]:
    """Combine a session's samples across connections (reconnects), keeping the newest MAX_SAMPLES."""
    out: dict[str, list[int]] = {k: list(v) for k, v in (stored or {}).items() if k in METRICS}
    for k, v in new.items():
        if k in METRICS:
            out[k] = (out.get(k, []) + list(v))[-MAX_SAMPLES:]
    return out


def percentile(values: list[int], p: float) -> int:
    ordered = sorted(values)
    if not ordered:
        return 0
    rank = max(0, min(len(ordered) - 1, round(p / 100 * (len(ordered) - 1))))
    return ordered[rank]


def summarize(sessions: Iterable[Mapping[str, list[int]]]) -> dict[str, dict[str, int]]:
    pooled: dict[str, list[int]] = {m: [] for m in METRICS}
    for s in sessions:
        for k, v in s.items():
            if k in pooled:
                pooled[k].extend(v)
    return {m: {"n": len(v), "p50": percentile(v, 50), "p95": percentile(v, 95), "p99": percentile(v, 99)}
            for m, v in pooled.items() if v}
