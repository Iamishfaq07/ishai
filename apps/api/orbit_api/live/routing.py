"""Model routing (spec §17): cheap/fast by default, deeper reasoning only where it pays off. And answer sizing: with
the "auto" length, how much to say for each question, picked from its type and wording (no model call)."""

import re
from typing import Literal

from orbit_api.live.events import AnswerLength, AnswerSize, QuestionType, SessionType
from orbit_api.live.question_detector import asks_for_story, normalize

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


MAX_TOKENS: dict[AnswerLength, int] = {"auto": 420, "short": 220, "standard": 420, "detailed": 800}
CODE_MAX_TOKENS = 1400
MAX_TALKING_POINTS: dict[AnswerLength, int] = {"auto": 5, "short": 3, "standard": 5, "detailed": 8}

# ---- auto length ---------------------------------------------------------------------------------------------------
# Every answer used to come out the same size: ~150 words for "Have you used Docker?" as for "Design a URL shortener"
# (tools/orbit-drive/plain_probe.py). A real candidate says a sentence or two to a quick question and keeps the long
# answers for the questions that need them; "auto" picks the size per question, from cheap signals only.
SIZE_ORDER: tuple[AnswerSize, ...] = ("brief", "short", "medium", "long", "detailed")
SIZE_TOKENS: dict[AnswerSize, int] = {"brief": 150, "short": 220, "medium": 320, "long": 450, "detailed": 800}
SIZE_POINTS: dict[AnswerSize, int] = {"brief": 2, "short": 3, "medium": 4, "long": 5, "detailed": 8}
# The fixed length closest to each size: what answer.started's `length` says (older clients know only these).
SIZE_LENGTH: dict[AnswerSize, AnswerLength] = {"brief": "short", "short": "short", "medium": "standard",
                                               "long": "standard", "detailed": "detailed"}

_LEAD = frozenset({"so", "okay", "ok", "and", "alright", "right", "well", "um", "uh", "now", "great", "cool"})
# "Are you comfortable with Git?", "Can you start next month?": answered yes or no, plus a line.
_YES_NO = re.compile(r"^(?:are|is|do|does|did|have|has|can|could|would|will|were|was|should|shall)\b")
# …unless they ask for an explanation inside ("Can you explain how a hash map works?", "Do you know why…").
_EXPLAIN = re.compile(r"\b(?:explain|describe|walk|talk|tell|how|why|what|compare|difference|design|approach|"
                      r"example|elaborate|think about)\b")
# "Have you used Kubernetes?", "Any experience with Kafka?": a quick yes/no about the candidate's own background.
_EXPERIENCE_ASK = re.compile(r"\b(?:have you (?:ever )?(?:used|worked|tried|touched|done|built)|experience (?:with|in)|"
                             r"familiar with|comfortable with|worked with|do you (?:know|use|code)|ever used)\b")
_DEFINE = re.compile(r"^(?:what(?:'s| is| are| does| do)|whats|define|what do you mean by|meaning of)\b")
_COMPARE = re.compile(r"\b(?:difference between|differences between|compare|versus|vs)\b")
_HOW_WORKS = re.compile(r"^(?:how (?:does|do|is|are|can)|explain|why (?:do|does|is|are|would|should)|what happens)\b")
_APPROACH = re.compile(r"\b(?:how (?:would|will|should|could) you|what would you do|how (?:would|do) you go about|"
                       r"your approach|walk me through how)\b")
_BRIEF_CUES = re.compile(r"\b(?:in (?:a|one) (?:word|sentence|line)|one liner|yes or no|quick question)\b")
_SHORT_CUES = re.compile(r"\b(?:briefly|brief|in short|short version|high level|in a nutshell|summari[sz]e|"
                         r"just the gist|quick overview)\b")
_DEEP_CUES = re.compile(r"\b(?:in detail|in depth|step by step|deep dive|dive deep|thorough(?:ly)?|elaborate|"
                        r"end to end|from scratch|walk (?:me|us) through|go deep(?:er)?|comprehensive|everything)\b")
_BROAD_INTRO = re.compile(r"\b(?:about yourself|introduce yourself|your background|walk me through your (?:resume|cv|"
                          r"career|background|journey)|your career)\b")
_PROJECT = re.compile(r"\b(?:a project|your (?:last|latest|current|recent|most recent|favou?rite|biggest) project|"
                      r"projects? you)\b")
_OPEN_FLOOR = re.compile(r"\b(?:questions for (?:me|us)|any questions|anything you'd like to ask|"
                         r"anything you want to ask)\b")
_LOGISTICS = re.compile(r"\b(?:notice period|start date|when can you (?:start|join)|join(?:ing)? date|"
                        r"available to start|serving notice)\b")


def step_size(size: AnswerSize, steps: int) -> AnswerSize:
    """One size shorter (-1) or longer (+1), staying on the scale."""
    i = min(max(SIZE_ORDER.index(size) + steps, 0), len(SIZE_ORDER) - 1)
    return SIZE_ORDER[i]


def _at_least(size: AnswerSize, floor: AnswerSize) -> AnswerSize:
    return size if SIZE_ORDER.index(size) >= SIZE_ORDER.index(floor) else floor


def _at_most(size: AnswerSize, cap: AnswerSize) -> AnswerSize:
    return size if SIZE_ORDER.index(size) <= SIZE_ORDER.index(cap) else cap


def _base_size(n: str, words: int, qtype: QuestionType) -> AnswerSize:
    """The size the question's type and shape call for, before cues and parts."""
    short_q = words <= 12
    if qtype == QuestionType.coding:
        return "medium"  # the talk track: the approach in a few spoken sentences (the code is shown, not said)
    if qtype == QuestionType.small_talk:
        return "brief"
    if qtype == QuestionType.clarification:
        return "short"
    if qtype == QuestionType.salary:
        return "brief" if _LOGISTICS.search(n) else "short"
    if qtype == QuestionType.culture:
        return "short" if _OPEN_FLOOR.search(n) else "medium"
    if qtype in (QuestionType.behavioral, QuestionType.leadership):
        return "long" if asks_for_story(n) or _PROJECT.search(n) else "medium"
    if qtype == QuestionType.resume:
        if _BROAD_INTRO.search(n):
            return "medium"
        if _PROJECT.search(n):
            return "long"
        if _EXPERIENCE_ASK.search(n) and short_q:
            return "brief"
        return "medium"
    if _LOGISTICS.search(n):
        return "brief"
    if _DEFINE.search(n) and short_q and not _APPROACH.search(n):
        return "short"
    if _COMPARE.search(n):
        return "short" if words <= 14 else "medium"
    if _YES_NO.search(n) and short_q and not _EXPLAIN.search(n):
        return "short" if " or " in f" {n} " else "brief"  # "Would you pick SQL or NoSQL here?" wants a reason
    if qtype == QuestionType.system_design:
        return "detailed"
    if qtype == QuestionType.follow_up:
        return "medium" if _APPROACH.search(n) or _HOW_WORKS.search(n) else "short"
    if _APPROACH.search(n):
        return "long"
    return "medium"  # how does X work, explain X, how do you…


def pick_size(question: str, qtype: QuestionType, parts: int = 1) -> AnswerSize:
    """The "auto" length's choice for one question: brief (1–3 sentences) for yes/no, quick facts and "have you used
    X"; short for a simple "what is X"; medium for intros, motivation, strengths and "how does X work"; long for a
    story or an approach; detailed for system design and deep or multi-part technical questions. Their own words win:
    "briefly" or "in detail" move it, and every extra part of a multi-part question gets room."""
    toks = normalize(question).split()
    while len(toks) > 1 and toks[0] in _LEAD:
        toks = toks[1:]
    n = " ".join(toks)
    words = len(toks)
    size = _base_size(n, words, qtype)
    technical = qtype in (QuestionType.technical, QuestionType.system_design, QuestionType.follow_up)
    if _BRIEF_CUES.search(n):
        return "brief"
    if _SHORT_CUES.search(n):
        return _at_most(size, "short")
    if _DEEP_CUES.search(n) and qtype != QuestionType.coding and not _BROAD_INTRO.search(n):
        size = _at_least(size, "detailed" if technical else step_size(size, 1))
    if parts >= 3:
        size = _at_least(size, "detailed" if technical else "long")
    elif parts == 2:
        size = step_size(_at_least(size, "short"), 1)
    if technical and words >= 35:
        size = _at_least(size, "long")  # a long, set-up question wants more than a line back
    if technical and estimate_complexity(n) >= 0.6:
        size = _at_least(size, "detailed")
    return size
