"""Builds the compact prompt for each answer (spec §14, §25, §57).

Sends only what this question needs: short profile, top retrieved facts, rolling summary, the last few
turns, and the question. Never the whole resume, JD, transcript, or document library.
"""

from collections import deque
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

from orbit_api.live.events import AnswerLength, AnswerStyle, QuestionType, SessionType, Speaker
from orbit_api.providers.llm.base import LLMMessage
from orbit_api.retrieval.index import Hit, IndexedChunk, SessionIndex

RECENT_TURNS = 6
MAX_TURN_CHARS = 500
MAX_CONTEXT_CHARS = 5000  # ≈1.2k tokens of retrieved context

_LENGTH_RULES: dict[AnswerLength, str] = {
    "short": "Length: 20–30 seconds spoken. ANSWER line plus AT MOST 3 talking points. No EXAMPLE line.",
    "standard": "Length: 45–75 seconds spoken. ANSWER line plus at most 5 talking points.",
    "detailed": "Length: 90–150 seconds spoken. ANSWER line plus 6–8 talking points and an EXAMPLE.",
}
_STYLE_RULES: dict[AnswerStyle, str] = {
    "bullets": "Style: crisp bullets.",
    "star": "Style: STAR — talking points labelled Situation, Task, Action, Result.",
    "technical": "Style: technical depth — precise terms, trade-offs, one concrete mechanism.",
    "executive": "Style: executive — outcome and business impact first, minimal jargon.",
}
_SESSION_RULES: dict[SessionType, str] = {
    "interview": "Context: job interview. The user is the candidate.",
    "phone": "Context: phone/room-audio interview. The user is the candidate.",
    "meeting": "Context: professional meeting. Help the user contribute clearly; no candidate framing.",
    "coding": "Context: coding interview. Prefer approach + code + complexity.",
    "assessment": "Context: online assessment PRACTICE. Teach the approach clearly.",
    "mock": "Context: mock interview practice.",
}


@cache
def live_system_prompt() -> str:
    return (Path(__file__).resolve().parents[1] / "prompts" / "live_system.md").read_text(encoding="utf-8")


def fence(text: str) -> str:
    """Neutralise attempts to close the reference fence from inside untrusted text."""
    return text.replace("<reference_data", "‹reference_data").replace("</reference_data", "‹/reference_data")


@dataclass
class Turn:
    speaker: Speaker
    text: str


@dataclass
class SessionMemory:
    """Recent turns + rolling summary + question history (spec §25)."""

    recent: deque[Turn] = field(default_factory=lambda: deque(maxlen=RECENT_TURNS * 2))
    rolling_summary: str = ""
    questions: list[str] = field(default_factory=list)
    last_answer_brief: str = ""

    def add_turn(self, speaker: Speaker, text: str) -> None:
        self.recent.append(Turn(speaker, text[:MAX_TURN_CHARS]))

    def recent_turns(self, n: int = RECENT_TURNS) -> list[Turn]:
        return list(self.recent)[-n:]


@dataclass
class PromptInputs:
    question: str
    qtype: QuestionType
    is_follow_up: bool
    session_type: SessionType
    role: str | None
    length: AnswerLength
    style: AnswerStyle
    answer_language: str
    instruction: str | None = None  # chat-mode instruction ("make this shorter")


@dataclass
class BuiltPrompt:
    messages: list[LLMMessage]
    context_used: list[str]
    hits: list[Hit]


# Question types that ask for the user's own story/position, where invented specifics are most tempting.
_PERSONAL_TYPES = {
    QuestionType.behavioral,
    QuestionType.leadership,
    QuestionType.follow_up,
    QuestionType.resume,
    QuestionType.salary,
    QuestionType.culture,
}
_GROUNDING_RULE = (
    "Give a complete, ready-to-say answer. Use VERIFIED CANDIDATE FACT lines to make it specific when they "
    "fit; if they don't, answer fully with a generic, adaptable structure — never a fabricated specific "
    "(employer, project, metric, 'I did X'), and never announce the absence (no grounding disclaimers). For a "
    "genuinely personal detail you can't know, you may leave AT MOST ONE inline [bracketed] cue the UI shows "
    "as a dim non-spoken hint; never let a bracketed cue or caveat replace a real answer. For salary/comp, "
    "never state a number as the user's own unless verified — use a negotiation-safe framing."
)

# "Tell me about yourself" is about the whole arc, not the facts that happen to share words with it,
# so these always get the profile summary and the most recent roles (resumes list newest first).
_ANCHORED_TYPES = {QuestionType.resume}


def _anchor_hits(index: SessionIndex) -> list[Hit]:
    anchors: list[IndexedChunk] = index.by_category("resume", ("summary",), 2)
    anchors += index.by_category("resume", ("experience",), 4)
    return [Hit(c, 1.0) for c in anchors]


def retrieve(index: SessionIndex, inputs: PromptInputs, memory: SessionMemory) -> list[Hit]:
    query = inputs.question
    if inputs.is_follow_up and memory.questions:
        query = f"{memory.questions[-1]} {inputs.question}"  # follow-ups inherit the prior topic
    hits = index.search(query, inputs.qtype, k=6)
    if inputs.qtype in _ANCHORED_TYPES:
        anchored = _anchor_hits(index)
        seen = {h.chunk.id for h in anchored}
        hits = anchored + [h for h in hits if h.chunk.id not in seen]
    if not any(h.chunk.doc_kind == "job_description" for h in hits):
        hits += index.search(query, inputs.qtype, k=2, doc_kind="job_description")
    return hits


def build_prompt(index: SessionIndex, inputs: PromptInputs, memory: SessionMemory) -> BuiltPrompt:
    hits = retrieve(index, inputs, memory)

    ctx_lines: list[str] = []
    used: list[str] = []
    budget = MAX_CONTEXT_CHARS
    for h in hits:
        tag = "VERIFIED CANDIDATE FACT" if h.chunk.verified else h.chunk.doc_kind.upper()
        prefix = f"[{tag}] ({h.chunk.label}) "
        # Hits are ranked, so once we can't fit a fact, truncate it rather than skipping to a
        # lower-ranked one (which would invert priority). Keep a little headroom for the tag.
        avail = budget - len(prefix)
        if avail < 120:
            break
        line = prefix + h.chunk.text[:avail]
        budget -= len(line)
        ctx_lines.append(line)
        if h.chunk.label not in used:
            used.append(h.chunk.label)

    settings_block = "\n".join(
        [
            _SESSION_RULES[inputs.session_type],
            f"Target role: {inputs.role}" if inputs.role else "",
            _LENGTH_RULES[inputs.length] + " Pick the strongest points; more context does not mean more bullets.",
            _STYLE_RULES[inputs.style] if inputs.qtype != QuestionType.coding else "",
            f"Answer language: {(inputs.answer_language or '').strip() or 'English'}",
            _GROUNDING_RULE if inputs.qtype in _PERSONAL_TYPES or inputs.is_follow_up else "",
            f"Question type: {inputs.qtype.value}" + (" (follow-up to the previous question)" if inputs.is_follow_up
                                                     else ""),
        ]
    ).strip()

    parts: list[str] = [settings_block]
    if ctx_lines:
        parts.append("<reference_data source=\"documents\">\n" + fence("\n".join(ctx_lines)) + "\n</reference_data>")
    else:
        parts.append("No resume/document context matched this question — that's fine. Answer it fully from "
                     "professional knowledge; just don't claim specific personal experience the user "
                     "didn't provide.")
    if memory.rolling_summary:
        parts.append("<reference_data source=\"session_summary\">\n" + fence(memory.rolling_summary)
                     + "\n</reference_data>")
    turns = memory.recent_turns()
    if turns:
        convo = "\n".join(f"{t.speaker.upper()}: {t.text}" for t in turns)
        parts.append("<reference_data source=\"recent_conversation\">\n" + fence(convo) + "\n</reference_data>")
    if memory.last_answer_brief and (inputs.is_follow_up or inputs.instruction):
        parts.append("<reference_data source=\"previous_answer\">\n" + fence(memory.last_answer_brief)
                     + "\n</reference_data>")
    if inputs.instruction:
        parts.append("USER REQUEST (from the user, not the interviewer):\n" + fence(inputs.instruction))
    parts.append("QUESTION: " + fence(inputs.question))

    return BuiltPrompt(
        messages=[LLMMessage("system", live_system_prompt()), LLMMessage("user", "\n\n".join(parts))],
        context_used=used,
        hits=hits,
    )
