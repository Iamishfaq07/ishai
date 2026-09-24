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
for grace_ms more before it fires.

Continuation: real interviewers pause for seconds mid-question ("Walk me through an image pipeline.
<2 s> Start with data, then preprocessing…"). Until the CANDIDATE starts talking, anything the
interviewer says within CONTINUE_WINDOW_MS of their last endpoint is stitched onto the question —
even if it already fired — and the combined question fires again (dedup treats it as `extends`, so the
answer is regenerated for the whole question). A manual "Answer" likewise gets the whole question.

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
GRACE_MS = {"quick": 0, "balanced": 1500, "patient": 3000}
# Interviewer speech this soon after their last endpoint continues the same question (until the candidate talks).
CONTINUE_WINDOW_MS = 8000
# Candidate speech shorter than this is a backchannel ("mm-hmm", "okay"), not the start of their answer.
CANDIDATE_ANSWER_MIN_WORDS = 3
# Interim transcripts trail speech by ~1 s, so after the interviewer resumes (VAD) keep holding until
# their words arrive - bounded, in case the VAD event was just noise.
RESUME_HOLD_MS = 2000
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
    held_confidence: float = 0.0  # best question-confidence of those earlier parts (carried across stitches)
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
            held_conf = self._confidence_of(p) if held and p is not None else 0.0
            p = self._pending = _Pending(turn_id=turn_id, text=text, last_speech_ms=now_ms, held_question=held,
                                         held_confidence=held_conf)
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

    def on_candidate_speech(self, now_ms: int, text: str = "") -> FinalizedQuestion | None:
        """The candidate is talking. A real start of their answer (not "mm-hmm") ends the interviewer's
        question: stop holding it (fire now if complete) and never stitch later interviewer words onto it."""
        p = self._pending
        if p is None or len(tokens(text)) < CANDIDATE_ANSWER_MIN_WORDS:
            return None
        fired = None
        if p.fired_text is None and p.endpointed:
            p.resumed_ms = None
            p.endpoint_ms = now_ms - self.grace_ms
            fired = self._evaluate(now_ms)
        self._pending = None
        return fired

    def pending_question(self) -> str | None:
        """The whole question currently being listened to (for a manual "Answer"), including any parts said
        before a pause — whether or not it already auto-fired."""
        p = self._pending
        if p is None:
            return None
        return p.full_text if detect(p.full_text, "interviewer", self.context).is_question else None

    def _held_question(self, p: _Pending | None, now_ms: int) -> str:
        """If the interviewer's previous turn was a question and they're still going (no candidate answer in
        between, within the continuation window), its text: the new turn continues it."""
        if p is None or not (p.endpointed or p.fired_text is not None):
            return ""
        since = p.endpoint_ms if p.endpoint_ms is not None else p.last_speech_ms
        resumed = p.resumed_ms is not None and now_ms - p.resumed_ms <= RESUME_HOLD_MS
        if not resumed and now_ms - since > CONTINUE_WINDOW_MS:
            return ""
        full = p.full_text
        if len(tokens(full)) > MAX_STITCHED_WORDS or not detect(full, "interviewer", self.context).is_question:
            return ""
        return full

    def _confidence_of(self, p: _Pending) -> float:
        """How surely `p` (with everything stitched into it) is a question. The detector scores only the last
        question sentence, so a stitched question keeps the best score of its parts; one that already fired
        was a confirmed question."""
        conf = max(p.held_confidence, detect(p.full_text, "interviewer", self.context).confidence,
                   detect(p.text, "interviewer", self.context).confidence)
        return max(conf, 0.6) if p.fired_text is not None else conf

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
            conf = max(d.confidence, p.held_confidence)
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
