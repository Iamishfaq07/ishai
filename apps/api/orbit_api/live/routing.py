"""Model routing (spec §17): cheap/fast by default, deeper reasoning only where it pays off."""

from typing import Literal

from orbit_api.live.events import AnswerLength, QuestionType, SessionType

ReasoningLevel = Literal["light", "deep"]

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
    # System design is architectural — always deep, even for a terse "Design Twitter."
    if question_type == QuestionType.system_design:
        return "deep"
    if question_type == QuestionType.coding and (complexity >= 0.3 or session_type in ("coding", "assessment")):
        return "deep"
    # A hard technical question (long or many complexity markers) also warrants deep reasoning.
    if question_type == QuestionType.technical and complexity >= 0.5:
        return "deep"
    return "light"


MAX_TOKENS: dict[AnswerLength, int] = {"short": 220, "standard": 420, "detailed": 800}
CODE_MAX_TOKENS = 1400
MAX_TALKING_POINTS: dict[AnswerLength, int] = {"short": 3, "standard": 5, "detailed": 8}
