"""Model routing (spec §17): cheap/fast by default, deeper reasoning only where it pays off."""

from typing import Literal

from orbit_api.live.events import AnswerLength, QuestionType, SessionType

ReasoningLevel = Literal["light", "deep"]

_DEEP_TYPES = {QuestionType.coding, QuestionType.system_design}
_COMPLEX_MARKERS = ("optimi", "debug", "race condition", "deadlock", "distributed", "trade-off", "tradeoff",
                    "scale to", "million", "billion", "consisten", "concurren", "dynamic programming")


def estimate_complexity(text: str) -> float:
    t = text.lower()
    score = min(len(t) / 400, 0.5)
    score += 0.15 * sum(1 for m in _COMPLEX_MARKERS if m in t)
    return min(score, 1.0)


def choose_reasoning_level(
    question_type: QuestionType, complexity: float, session_type: SessionType = "interview"
) -> ReasoningLevel:
    if question_type in _DEEP_TYPES and (complexity >= 0.3 or session_type in ("coding", "assessment")):
        return "deep"
    return "light"


MAX_TOKENS: dict[AnswerLength, int] = {"short": 220, "standard": 420, "detailed": 800}
CODE_MAX_TOKENS = 1400
