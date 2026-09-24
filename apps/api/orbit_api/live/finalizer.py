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

Patience (`grace_ms`, the user's "wait before answering"): after the endpoint the question is *held*
for grace_ms more. If the interviewer starts talking again inside that window ("Tell me about a hard
bug. <pause> Specifically, how you found it."), the next turn is stitched onto the held question and the
whole thing waits for its own endpoint - so we answer the full question, not its first half.

`tick(now_ms)` must be called periodically (the engine does every ~50 ms); the clock is injected so
this is fully deterministic under test.
"""

from dataclasses import dataclass, replace

from orbit_api.live.question_detector import (
    Detection,
    DetectorContext,
    continue_question,
    detect,
    is_complete,
    tokens,
)

QUESTION_MARK_SILENCE_MS = 250
COMPLETE_SILENCE_MS = 650
MAX_SILENCE_MS = 1300
# Fallback when a VAD provider's endpoint event is lost (noisy audio, dropped message).
PROVIDER_FALLBACK_SILENCE_MS = 2500
# A fired turn may fire again once it has grown by this many words (dedup marks it `extends`).
REFIRE_EXTRA_WORDS = 4
# "Wait before answering" presets: extra silence after the provider endpoint before a question fires.
GRACE_MS = {"quick": 0, "balanced": 800, "patient": 1600}
# Interim transcripts trail speech by ~1 s, so after the interviewer resumes (VAD) keep holding until
# their words arrive - bounded, in case the VAD event was just noise.
RESUME_HOLD_MS = 2000
# Slack for stitching: the next turn's first words may land a little after the grace window.
STITCH_SLACK_MS = 400
MAX_STITCHED_WORDS = 120


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
    held_question: str = ""  # earlier part(s) of this question, from before a pause
    endpoint_ms: int | None = None
    resumed_ms: int | None = None  # VAD heard the interviewer again after the endpoint

    @property
    def full_text(self) -> str:
        return continue_question(self.held_question, self.text) if self.held_question else self.text


class QuestionFinalizer:
    def __init__(self, *, provider_endpoints: bool = False, grace_ms: int = 0) -> None:
        self.provider_endpoints = provider_endpoints
        self.grace_ms = grace_ms
        self._pending: _Pending | None = None
        self.context = DetectorContext()

    def on_transcript(
        self, turn_id: str, text: str, now_ms: int, *, is_final: bool, endpoint: bool = False
    ) -> FinalizedQuestion | None:
        """Feed interviewer transcript (partial or final). Returns a question if it should fire now."""
        p = self._pending
        if p is None or p.turn_id != turn_id:
            held = self._held_question(p, now_ms)
            p = self._pending = _Pending(turn_id=turn_id, text=text, last_speech_ms=now_ms, held_question=held)
        else:
            if text != p.text:
                p.last_speech_ms = now_ms
                p.resumed_ms = None
            p.text = text
        if is_final and endpoint:
            p.endpointed = True
            p.endpoint_ms = now_ms
            p.resumed_ms = None
        return self._evaluate(now_ms)

    def on_speech_activity(self, now_ms: int) -> None:
        """VAD says the interviewer is still talking — push the silence window out."""
        if self._pending:
            self._pending.last_speech_ms = now_ms
            if self._pending.endpointed:
                self._pending.resumed_ms = now_ms

    def on_candidate_speech(self, now_ms: int) -> FinalizedQuestion | None:
        """The candidate started talking: the interviewer's question is over. Stop holding it (fire now if
        it's complete) and never stitch the interviewer's next words onto it."""
        p = self._pending
        if p is None or p.fired_text is not None or not p.endpointed:
            return None
        p.resumed_ms = None
        p.endpoint_ms = now_ms - self.grace_ms
        fired = self._evaluate(now_ms)
        if fired is None:
            self._pending = None  # not answerable, but still must not absorb the next question
        return fired

    def pending_question(self) -> str | None:
        """The question currently being listened to / held (for a manual "Answer now")."""
        p = self._pending
        if p is None or p.fired_text is not None:
            return None
        return p.full_text if detect(p.full_text, "interviewer", self.context).is_question else None

    def _held_question(self, p: _Pending | None, now_ms: int) -> str:
        """If `p` is a question still held in its grace window, its text: the new turn continues it."""
        if p is None or p.fired_text is not None or not p.endpointed or p.endpoint_ms is None or not self.grace_ms:
            return ""
        resumed = p.resumed_ms is not None and now_ms - p.resumed_ms <= RESUME_HOLD_MS
        if not resumed and now_ms - p.endpoint_ms > self.grace_ms + STITCH_SLACK_MS:
            return ""
        full = p.full_text
        if len(tokens(full)) > MAX_STITCHED_WORDS or not detect(full, "interviewer", self.context).is_question:
            return ""
        return full

    def tick(self, now_ms: int) -> FinalizedQuestion | None:
        return self._evaluate(now_ms)

    def reset(self) -> None:
        self._pending = None

    def _evaluate(self, now_ms: int) -> FinalizedQuestion | None:
        p = self._pending
        if p is None:
            return None
        full = p.full_text
        if p.fired_text is not None and len(tokens(full)) < len(tokens(p.fired_text)) + REFIRE_EXTRA_WORDS:
            return None
        d = detect(full, "interviewer", self.context)
        if p.held_question:
            # extract_question keeps only the last question sentence; a stitched question keeps both parts,
            # and is at least as much a question as the part we were already holding.
            complete = is_complete(full)
            conf = max(d.confidence, detect(p.held_question, "interviewer", self.context).confidence)
            d = replace(d, question_text=full, is_complete=complete, confidence=conf, is_question=conf >= 0.5,
                        should_generate=conf >= 0.6 and complete)
        if not d.is_question:
            return None
        silence = now_ms - p.last_speech_ms
        trigger: str | None = None
        if p.endpointed and d.is_complete:
            if not self._holding(p, now_ms):
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
        p.fired_text = full
        return FinalizedQuestion(turn_id=p.turn_id, detection=d, trigger=trigger)

    def _holding(self, p: _Pending, now_ms: int) -> bool:
        """Still inside the patience window, or the interviewer resumed and their words aren't in yet."""
        if p.resumed_ms is not None and now_ms - p.resumed_ms < RESUME_HOLD_MS:
            return True
        return p.endpoint_ms is not None and now_ms - p.endpoint_ms < self.grace_ms
