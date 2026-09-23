"""Decides *when* an interviewer utterance is finished enough to answer (spec §13).

Signals, strongest first:
  1. STT endpoint (`speech_final` / utterance end) on a complete-looking question → fire now.
  2. Question mark + short silence (QUESTION_MARK_SILENCE_MS).
  3. Semantically complete question + medium silence (COMPLETE_SILENCE_MS).
  4. Any likely question + long silence (MAX_SILENCE_MS) — last-resort so we never hang.

With a VAD-backed provider (`provider_endpoints=True`, e.g. Deepgram) only signal 1 is trusted, plus a
long fallback: interim transcripts arrive ~1 s apart, so "no transcript change for 650 ms" is not silence
and the timer rules would fire mid-sentence ("How would you integrate security…"). The timer rules are
for providers without endpointing.

`tick(now_ms)` must be called periodically (the engine does every ~50 ms); the clock is injected so
this is fully deterministic under test.
"""

from dataclasses import dataclass

from orbit_api.live.question_detector import Detection, DetectorContext, detect, tokens

QUESTION_MARK_SILENCE_MS = 250
COMPLETE_SILENCE_MS = 650
MAX_SILENCE_MS = 1300
# Fallback when a VAD provider's endpoint event is lost (noisy audio, dropped message).
PROVIDER_FALLBACK_SILENCE_MS = 2500
# A fired turn may fire again once it has grown by this many words (dedup marks it `extends`).
REFIRE_EXTRA_WORDS = 4


@dataclass
class FinalizedQuestion:
    turn_id: str
    detection: Detection
    trigger: str  # endpoint | question_mark | silence | max_silence


@dataclass
class _Pending:
    turn_id: str
    text: str
    last_speech_ms: int
    endpointed: bool = False
    fired_text: str | None = None


class QuestionFinalizer:
    def __init__(self, *, provider_endpoints: bool = False) -> None:
        self.provider_endpoints = provider_endpoints
        self._pending: _Pending | None = None
        self.context = DetectorContext()

    def on_transcript(
        self, turn_id: str, text: str, now_ms: int, *, is_final: bool, endpoint: bool = False
    ) -> FinalizedQuestion | None:
        """Feed interviewer transcript (partial or final). Returns a question if it should fire now."""
        p = self._pending
        if p is None or p.turn_id != turn_id:
            p = self._pending = _Pending(turn_id=turn_id, text=text, last_speech_ms=now_ms)
        else:
            if text != p.text:
                p.last_speech_ms = now_ms
            p.text = text
        if is_final and endpoint:
            p.endpointed = True
        return self._evaluate(now_ms)

    def on_speech_activity(self, now_ms: int) -> None:
        """VAD says the interviewer is still talking — push the silence window out."""
        if self._pending:
            self._pending.last_speech_ms = now_ms

    def tick(self, now_ms: int) -> FinalizedQuestion | None:
        return self._evaluate(now_ms)

    def reset(self) -> None:
        self._pending = None

    def _evaluate(self, now_ms: int) -> FinalizedQuestion | None:
        p = self._pending
        if p is None:
            return None
        if p.fired_text is not None and len(tokens(p.text)) < len(tokens(p.fired_text)) + REFIRE_EXTRA_WORDS:
            return None
        d = detect(p.text, "interviewer", self.context)
        if not d.is_question:
            return None
        silence = now_ms - p.last_speech_ms
        trigger: str | None = None
        if p.endpointed and d.is_complete:
            trigger = "endpoint"
        elif self.provider_endpoints:
            if silence >= PROVIDER_FALLBACK_SILENCE_MS and d.is_complete and d.should_generate:
                trigger = "max_silence"
        elif p.text.rstrip().endswith("?") and silence >= QUESTION_MARK_SILENCE_MS:
            trigger = "question_mark"
        elif d.is_complete and d.should_generate and silence >= COMPLETE_SILENCE_MS:
            trigger = "silence"
        elif silence >= MAX_SILENCE_MS and d.confidence >= 0.6:
            trigger = "max_silence"
        if trigger is None or (not d.should_generate and trigger != "max_silence"):
            return None
        p.fired_text = p.text
        return FinalizedQuestion(turn_id=p.turn_id, detection=d, trigger=trigger)
