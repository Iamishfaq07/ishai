"""Duplicate suppression for auto-generated answers (spec §61).

Handles two cases:
  * Same turn growing ("Tell me" → "Tell me about" → "Tell me about yourself"): the finalizer fires once
    per turn, but STT can split one question across turns, so we also compare against recent answers.
  * The interviewer repeating/rephrasing a question within a cooldown window.
"""

from dataclasses import dataclass
from enum import StrEnum

from orbit_api.live.question_detector import tokens

COOLDOWN_MS = 20_000
SIMILARITY_THRESHOLD = 0.8
# Words whose presence or absence doesn't change what's being asked.
_FILLER = frozenset({"the", "a", "an", "and", "so", "okay", "ok", "um", "uh", "like", "just", "really", "then", "now",
                     "well", "you", "can", "could", "would", "please", "me", "actually", "basically", "right",
                     "alright", "yeah", "maybe", "quickly", "briefly", "again"})


class DedupDecision(StrEnum):
    new = "new"
    duplicate = "duplicate"
    extends = "extends"  # longer version of the in-flight question → regenerate


@dataclass
class _Seen:
    question_id: str
    turn_id: str
    toks: list[str]
    at_ms: int


def fingerprint(text: str) -> str:
    return " ".join(tokens(text))


def similarity(a: list[str], b: list[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _is_prefix(short: list[str], long: list[str]) -> bool:
    return len(short) < len(long) and long[: len(short)] == short


class Deduplicator:
    def __init__(self) -> None:
        self._seen: list[_Seen] = []

    def check(self, turn_id: str, text: str, now_ms: int, *,
              continues: bool = False) -> tuple[DedupDecision, str | None]:
        """Returns the decision and, for duplicate/extends, the matching earlier question id. `continues`: the
        finalizer stitched this question onto the one it held (said after a pause), so starting with an earlier
        question's words means it's that question, grown; otherwise, on another turn, it's a new question that
        happens to start the same way ("Why?" … "Why not use DynamoDB instead?")."""
        toks = tokens(text)
        self._seen = [s for s in self._seen if now_ms - s.at_ms <= COOLDOWN_MS]
        for s in reversed(self._seen):
            if s.toks == toks:
                return DedupDecision.duplicate, s.question_id
            same = continues or s.turn_id == turn_id
            # A stitched continuation starts with the exact earlier question, however long the pause was.
            if same and _is_prefix(s.toks, toks):
                return DedupDecision.extends, s.question_id
            if same and _is_prefix(toks, s.toks):
                return DedupDecision.duplicate, s.question_id  # a fragment of what we already answered
            # Rephrased: nearly the same words, and the ones that differ don't carry meaning ("So tell me about
            # yourself" / "Tell me about yourself"). "…if the array is sorted?" after "…if the array is empty?" isn't.
            if similarity(s.toks, toks) >= SIMILARITY_THRESHOLD and set(s.toks) ^ set(toks) <= _FILLER:
                return DedupDecision.duplicate, s.question_id
        return DedupDecision.new, None

    def record(self, question_id: str, turn_id: str, text: str, now_ms: int) -> None:
        self._seen.append(_Seen(question_id, turn_id, tokens(text), now_ms))

    def replace(self, question_id: str, text: str, now_ms: int) -> None:
        for s in self._seen:
            if s.question_id == question_id:
                s.toks = tokens(text)
                s.at_ms = now_ms
