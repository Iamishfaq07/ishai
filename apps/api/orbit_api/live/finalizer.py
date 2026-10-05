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
answer is regenerated for the whole question). A manual "Answer" likewise gets the whole question. Not when the
interviewer opens by moving on ("Let's switch to system design.", "Next question."): that's a new question.
Talk around the interview ("I'll make a note of that.", "You cut out.") is never carried over.

`tick(now_ms)` must be called periodically (the engine does every ~50 ms); the clock is injected so
this is fully deterministic under test.
"""

from collections import deque
from dataclasses import dataclass, replace

from orbit_api.live.question_detector import (
    Detection,
    DetectorContext,
    continue_question,
    detect,
    is_complete,
    lead_in,
    starts_new_topic,
    tokens,
)

QUESTION_MARK_SILENCE_MS = 250
COMPLETE_SILENCE_MS = 650
MAX_SILENCE_MS = 1300
# Fallback when a VAD provider's endpoint event is lost (noisy audio, dropped message).
PROVIDER_FALLBACK_SILENCE_MS = 2500
# A fired turn may fire again once it has grown by this many words (dedup marks it `extends`), or by fewer words
# that ask something ("…would you pick? <pause> And why?", "…design a cache? <pause> In Go?"). A short aside
# ("Yeah, that's right.") doesn't restart the answer.
REFIRE_EXTRA_WORDS = 4
# "Wait before answering" presets: extra silence after the provider endpoint before a question fires.
GRACE_MS = {"quick": 0, "balanced": 1500, "patient": 3000}
# Interviewer speech this soon after their last endpoint continues the same question (until the candidate talks).
CONTINUE_WINDOW_MS = 8000
# Candidate speech shorter than this is a backchannel ("mm-hmm", "okay"), not the start of their answer.
CANDIDATE_ANSWER_MIN_WORDS = 3
# "Candidate" speech made mostly of the interviewer's own words is the interviewer's voice leaking into the
# mic (speakers, no headphones) — not the candidate answering. The mic copy can be transcribed BEFORE the
# interviewer channel's, so a candidate "answer" only counts once it has survived ECHO_CONFIRM_MS without
# matching what the interviewer said around it.
ECHO_OVERLAP = 0.7
ECHO_CONFIRM_MS = 1500
RECENT_INTERVIEWER_MS = 8000
# Interim transcripts trail speech by ~1 s, so after the interviewer resumes (VAD) keep holding until
# their words arrive - bounded, in case the VAD event was just noise.
RESUME_HOLD_MS = 2000
MAX_STITCHED_WORDS = 120


@dataclass
class FinalizedQuestion:
    turn_id: str
    detection: Detection
    # endpoint | question_mark | silence | max_silence | classify (ambiguous: ask the classifier before answering)
    trigger: str


@dataclass
class _Pending:
    turn_id: str
    text: str
    last_speech_ms: int
    endpointed: bool = False
    fired_text: str | None = None
    fired_question: str | None = None  # the cleaned question text that was actually sent when it fired
    held_question: str = ""  # earlier part(s) of this question, from before a pause
    held_confidence: float = 0.0  # best question-confidence of those earlier parts (carried across stitches)
    answered: str | None = None  # the held part as it already fired: the stitched question refires only on real growth
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
        self._claim: tuple[int, str] | None = None  # candidate speech that may be the start of their answer
        self._recent: deque[tuple[int, list[str]]] = deque()  # recent interviewer words, for echo checks

    def on_transcript(
        self, turn_id: str, text: str, now_ms: int, *, is_final: bool, endpoint: bool = False
    ) -> FinalizedQuestion | None:
        """Feed interviewer transcript (partial or final). Returns a question if it should fire now."""
        self._remember(text, now_ms)
        early = self._settle_claim(now_ms)
        p = self._pending
        if p is None or p.turn_id != turn_id:
            # "Let's switch to system design. How would you design…" is a new question, however soon it comes.
            held = "" if starts_new_topic(text) else self._held_question(p, now_ms)
            held_conf = self._confidence_of(p) if held and p is not None else 0.0
            answered = held if held and p is not None and p.fired_question == held else None
            p = self._pending = _Pending(turn_id=turn_id, text=text, last_speech_ms=now_ms, held_question=held,
                                         held_confidence=held_conf, answered=answered)
        else:
            if text != p.text:
                p.last_speech_ms = now_ms
                p.resumed_ms = None
            p.text = text
            if p.held_question and starts_new_topic(text):
                # The turn's first words ("Let's") didn't say it yet; now it's clear the interviewer moved on.
                p.held_question, p.held_confidence, p.answered = "", 0.0, None
                p.fired_text = p.fired_question = None
        if is_final and endpoint:
            p.endpointed = True
            p.endpoint_ms = now_ms
            p.resumed_ms = None
        return early or self._evaluate(now_ms)

    def on_speech_activity(self, now_ms: int) -> None:
        """VAD says the interviewer is still talking — push the silence window out."""
        if self._pending:
            self._pending.last_speech_ms = now_ms
            if self._pending.endpointed:
                self._pending.resumed_ms = now_ms

    def on_candidate_speech(self, now_ms: int, text: str = "") -> FinalizedQuestion | None:
        """The candidate is talking. A real start of their answer (not "mm-hmm", not the interviewer's voice
        leaking into the mic) ends the interviewer's question: stop holding it (fire if complete) and never
        stitch later interviewer words onto it. Confirmed after ECHO_CONFIRM_MS (see tick)."""
        p = self._pending
        if p is None or len(tokens(text)) < CANDIDATE_ANSWER_MIN_WORDS:
            return self._settle_claim(now_ms)
        if self._is_echo(text):
            return None
        if p.endpointed and p.resumed_ms is None:
            # The interviewer is quiet (hasn't resumed since their last pause), so this can't be their voice
            # leaking in: the candidate is answering.
            self._claim = None
            return self._close(now_ms)
        # The interviewer is talking right now: this may be their voice in the mic, transcribed before the
        # interviewer channel. Only count it once it survives ECHO_CONFIRM_MS.
        self._claim = (self._claim[0] if self._claim else now_ms, text)
        return self._settle_claim(now_ms)

    def _remember(self, text: str, now_ms: int) -> None:
        self._recent.append((now_ms, tokens(text)))
        while self._recent and now_ms - self._recent[0][0] > RECENT_INTERVIEWER_MS:
            self._recent.popleft()

    def _is_echo(self, text: str) -> bool:
        words = tokens(text)
        heard = {w for _, ws in self._recent for w in ws}
        if self._pending is not None:
            heard |= set(tokens(self._pending.full_text))
        return bool(words) and sum(w in heard for w in words) >= ECHO_OVERLAP * len(words)

    def _settle_claim(self, now_ms: int) -> FinalizedQuestion | None:
        claim = self._claim
        if claim is None:
            return None
        if self._is_echo(claim[1]):
            self._claim = None  # it was the interviewer's own voice
            return None
        if now_ms - claim[0] < ECHO_CONFIRM_MS:
            return None
        self._claim = None
        return self._close(now_ms)

    def _close(self, now_ms: int) -> FinalizedQuestion | None:
        p = self._pending
        if p is None:
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
        """If the interviewer is still going (no candidate answer in between, within the continuation window),
        what they said before: the new turn continues it. A question carries over whole; a non-question
        set-up ("Let's talk about image classification.") carries over as a cleaned lead-in."""
        if p is None or not (p.endpointed or p.fired_text is not None):
            return ""
        since = p.endpoint_ms if p.endpoint_ms is not None else p.last_speech_ms
        resumed = p.resumed_ms is not None and now_ms - p.resumed_ms <= RESUME_HOLD_MS
        if not resumed and now_ms - since > CONTINUE_WINDOW_MS:
            return ""
        # What already fired carries over exactly as it was shown/answered (so the refire is a clean
        # extension of it); anything else is cleaned of fillers and bare acknowledgements.
        if p.fired_question and p.fired_text == p.full_text:
            return p.fired_question
        return lead_in(p.full_text, MAX_STITCHED_WORDS)

    def _confidence_of(self, p: _Pending) -> float:
        """How surely `p` (with everything stitched into it) is a question. The detector scores only the last
        question sentence, so a stitched question keeps the best score of its parts; one that already fired
        was a confirmed question."""
        conf = max(p.held_confidence, detect(p.full_text, "interviewer", self.context).confidence,
                   detect(p.text, "interviewer", self.context).confidence)
        return max(conf, 0.6) if p.fired_text is not None else conf

    def tick(self, now_ms: int) -> FinalizedQuestion | None:
        return self._settle_claim(now_ms) or self._evaluate(now_ms)

    def reset(self) -> None:
        self._pending = None

    def _evaluate(self, now_ms: int) -> FinalizedQuestion | None:
        p = self._pending
        if p is None:
            return None
        full = p.full_text
        if not self._grown(p):
            return None
        d = self._detection(p)
        if not d.is_question and not d.needs_llm:
            return None
        silence = now_ms - p.last_speech_ms
        answerable = d.should_generate or d.needs_llm
        trigger: str | None = None
        if p.endpointed and d.is_complete:
            if not self._holding(p, now_ms):
                trigger = "endpoint"
        elif self.provider_endpoints:
            if silence >= PROVIDER_FALLBACK_SILENCE_MS and d.is_complete and answerable:
                trigger = "max_silence"
        elif d.is_question and p.text.rstrip().endswith("?") and silence >= QUESTION_MARK_SILENCE_MS:
            trigger = "question_mark"
        elif d.is_complete and answerable and silence >= COMPLETE_SILENCE_MS:
            trigger = "silence"
        elif silence >= MAX_SILENCE_MS and d.confidence >= 0.6:
            trigger = "max_silence"
        if trigger is None:
            return None
        if not d.should_generate:
            # Ambiguous ("Compare REST and gRPC." / "Share price is up."): the interviewer has finished, so ask
            # the classifier once instead of guessing either way.
            if d.needs_llm:
                trigger = "classify"
            elif trigger != "max_silence":
                return None
        p.fired_text = full
        p.fired_question = d.question_text
        return FinalizedQuestion(turn_id=p.turn_id, detection=d, trigger=trigger)

    def speculation(self, now_ms: int) -> Detection | None:
        """The question as it will fire, while it's held only for the patience window ("wait before answering"):
        the interviewer has stopped and it's complete and clearly a question. The engine starts the answer now
        and shows it only if the question fires unchanged, so the wait no longer adds the model's start-up time."""
        p = self._pending
        if (p is None or not p.endpointed or p.resumed_ms is not None or p.endpoint_ms is None
                or self.grace_ms <= 0 or now_ms - p.endpoint_ms >= self.grace_ms or not self._grown(p)):
            return None
        d = self._detection(p)
        return d if d.should_generate and d.is_complete else None

    def _grown(self, p: _Pending) -> bool:
        """Not yet answered, or it has grown enough since it was."""
        already = p.fired_text if p.fired_text is not None else p.answered
        return already is None or self._grew_enough(already, p.full_text)

    def _detection(self, p: _Pending) -> Detection:
        full = p.full_text
        d = detect(full, "interviewer", self.context)
        if p.held_question:
            # extract_question keeps only the last question sentence; a stitched question keeps both parts,
            # and is at least as much a question as the part we were already holding.
            complete = is_complete(full)
            conf = max(d.confidence, p.held_confidence)
            d = replace(d, question_text=full, is_complete=complete, confidence=conf, is_question=conf >= 0.5,
                        should_generate=conf >= 0.6 and complete, needs_llm=0.35 <= conf < 0.6 and complete)
        return d

    def _grew_enough(self, fired: str, full: str) -> bool:
        grown = len(tokens(full)) - len(tokens(fired))
        if grown <= 0:
            return False
        if grown >= REFIRE_EXTRA_WORDS:
            return True
        added = full[len(fired):].strip() if full.startswith(fired) else full
        return added.endswith("?") or detect(added, "interviewer", self.context).is_question

    def _holding(self, p: _Pending, now_ms: int) -> bool:
        """Still inside the patience window, or the interviewer resumed and their words aren't in yet."""
        if p.resumed_ms is not None and now_ms - p.resumed_ms < RESUME_HOLD_MS:
            return True
        return p.endpoint_ms is not None and now_ms - p.endpoint_ms < self.grace_ms
