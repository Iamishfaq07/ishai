"""Versioned live-session event schemas. Mirror: packages/types/src/events.ts. See docs/PROTOCOL.md."""

import time
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

PROTOCOL_VERSION = 1

Speaker = Literal["interviewer", "candidate", "other"]
# "auto" (the default for new sessions) sizes each answer to its question (routing.pick_size); the others are fixed.
AnswerLength = Literal["auto", "short", "standard", "detailed"]
# What "auto" picks per question: a sentence or two for "Have you used Docker?", a story's minute, a design's two.
AnswerSize = Literal["brief", "short", "medium", "long", "detailed"]
# The candidate's level, which answers are pitched at. "auto" infers it from the resume and the role (live/background).
ExperienceLevel = Literal["auto", "fresher", "junior", "mid", "senior"]
# natural / concise / story are the offered styles; the rest are legacy values still stored on older
# sessions (mapped onto the new ones in context_builder).
AnswerStyle = Literal["natural", "concise", "story", "bullets", "star", "technical", "executive"]
# How long to wait after the interviewer stops before auto-answering (finalizer.GRACE_MS).
ResponseTiming = Literal["quick", "balanced", "patient"]
Thinking = Literal["off", "low", "high", "max"]
CodingLanguage = Literal["python", "java", "javascript", "typescript", "cpp", "csharp", "go", "rust", "sql"]
SessionType = Literal["interview", "meeting", "coding", "assessment", "phone", "mock"]


class QuestionType(StrEnum):
    behavioral = "behavioral"
    technical = "technical"
    coding = "coding"
    system_design = "system_design"
    resume = "resume"
    leadership = "leadership"
    salary = "salary"
    culture = "culture"
    clarification = "clarification"
    follow_up = "follow_up"
    small_talk = "small_talk"
    non_question = "non_question"


class LiveState(StrEnum):
    idle = "idle"
    listening = "listening"
    speech_detected = "speech_detected"
    question_detected = "question_detected"
    generating = "generating"
    streaming = "streaming"
    answer_complete = "answer_complete"
    follow_up_detected = "follow_up_detected"
    stt_reconnecting = "stt_reconnecting"
    ai_reconnecting = "ai_reconnecting"
    error = "error"
    paused = "paused"
    ended = "ended"


class LiveSettings(BaseModel):
    auto_answer: bool = True
    length: AnswerLength = "auto"
    style: AnswerStyle = "natural"
    answer_language: str | None = None
    response_timing: ResponseTiming = "balanced"
    thinking: Thinking = "off"
    coding_language: CodingLanguage | None = None  # None = the model picks (usually Python)
    experience: ExperienceLevel = "auto"


class LiveSettingsPatch(BaseModel):
    auto_answer: bool | None = None
    length: AnswerLength | None = None
    style: AnswerStyle | None = None
    answer_language: str | None = None
    response_timing: ResponseTiming | None = None
    thinking: Thinking | None = None
    coding_language: CodingLanguage | None = None
    experience: ExperienceLevel | None = None


class CodeBlock(BaseModel):
    language: str = "text"
    content: str = ""


class FactSource(BaseModel):
    """A document fact an answer's claims about the user rely on (resolved from the model's SOURCES line)."""

    ref: str  # "F2": the fact's number in the prompt
    chunk_id: str
    doc_kind: str  # resume | job_description | notes | other
    document: str  # document title
    label: str
    excerpt: str
    verified: bool  # a candidate fact from the user's own documents (resume), not a JD requirement or a note


class DesignSection(BaseModel):
    title: str  # Requirements | Assumptions | Scale | APIs | Data model | Architecture | Storage | Caching | …
    text: str


class DebugInfo(BaseModel):
    """Debug mode (a bug, error or failing test): the corrected code itself is in `code`."""

    root_cause: str | None = None
    fix: str | None = None  # the minimal fix, in one or two lines
    why: str | None = None  # why it failed
    diff: str | None = None  # unified diff of the fix


class Term(BaseModel):
    """A technical word the spoken answer uses, in plain words, so the candidate knows what they're saying."""

    term: str
    meaning: str


class SpokenWalkthrough(BaseModel):
    intuition: str = Field("", max_length=500)
    commentary: list[str] = Field(default_factory=list, max_length=3)
    complexity_defense: str = Field("", max_length=600)


class DryRunTrace(BaseModel):
    """A coding answer's dry run: one tricky input, then the key variables after each step."""

    input: str = Field("", max_length=200)
    steps: list[str] = Field(default_factory=list, max_length=6)


class LiveAnswer(BaseModel):
    question: str = ""
    type: QuestionType = QuestionType.technical
    direct_answer: str = ""
    talking_points: list[str] = Field(default_factory=list)
    example: str | None = None
    code: CodeBlock | None = None
    walkthrough: SpokenWalkthrough | None = None
    time_complexity: str | None = None
    space_complexity: str | None = None
    follow_up: str | None = None
    context_used: list[str] = Field(default_factory=list)
    # Where the answer's personal claims come from (launch brief §19: VERIFIED / INFERRED / GENERAL / UNSUPPORTED):
    # "verified" (stated in the user's own documents), "inferred" (built on them but going beyond what they say),
    # "general" (no personal claims), "example" (= unsupported: an illustrative story/details the user must swap
    # for their real experience). The server never lets "verified" stand without a cited verified fact.
    grounding: Literal["verified", "inferred", "example", "general"] | None = None
    sources: list[FactSource] = Field(default_factory=list)
    # 3–6 short labels for the points the answer makes, in order — the UI ticks them off as the candidate
    # covers them ("NEXT" guidance).
    key_points: list[str] = Field(default_factory=list)
    # Coding answers: the task restated in one line, edge cases to mention, and example tests (input → expected).
    problem: str | None = None
    edge_cases: list[str] = Field(default_factory=list)
    trace: DryRunTrace | None = None
    tests: list[str] = Field(default_factory=list)
    # System design mode: the structured sections behind the spoken talk track (direct_answer).
    design: list[DesignSection] = Field(default_factory=list)
    # Debug mode: root cause / minimal fix / why / diff; the talk track explains it aloud.
    debug: DebugInfo | None = None
    # Up to 3 technical words the answer uses, with their plain meaning (shown dimmed, never said).
    terms: list[Term] = Field(default_factory=list)


class Envelope(BaseModel):
    v: int = PROTOCOL_VERSION
    type: str
    seq: int = 0
    ts: int = Field(default_factory=lambda: int(time.time() * 1000))
    data: dict[str, Any] = Field(default_factory=dict)


# ---- client → server payloads -------------------------------------------------------------------------


class AnswerRequest(BaseModel):
    question_text: str | None = Field(None, max_length=4000)
    # One answer only (the card's Shorter / Longer / Simpler on an auto-length session): the session keeps its settings.
    size: AnswerSize | None = None
    simpler: bool = False


class AnswerPin(BaseModel):
    answer_id: str
    pinned: bool


class ChatMessage(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class MockAnswer(BaseModel):
    """Mock interview: an answer typed instead of spoken (no microphone, or speech-to-text is down)."""

    text: str = Field(min_length=1, max_length=4000)


class MockVoice(BaseModel):
    """The AI video interview: what the client's voice did with one of the interviewer's lines (a question's id or
    a `mock.say` line's): started or finished saying it, the candidate talked over it, or it couldn't be heard (the
    browser refused to play it until a tap, it stalled, there's no voice at all, or it fell back to the device's)."""

    event: Literal["started", "finished", "interrupted", "blocked", "stalled", "unavailable", "fallback"]
    line_id: str | None = Field(None, max_length=36)
    detail: str | None = Field(None, max_length=120)


class SpeakerCorrect(BaseModel):
    turn_id: str = Field(max_length=36)  # a uuid the engine issued
    speaker: Speaker


class DevSimulate(BaseModel):
    fixture: str = Field(pattern=r"^[a-z0-9_]{1,64}$")
    speed: float = Field(1.0, ge=0.5, le=50.0)


CLIENT_EVENT_TYPES = frozenset(
    {
        "session.start",
        "session.pause",
        "session.resume",
        "session.end",
        "answer.request",
        "mock.next",
        "mock.answer",
        "mock.voice",
        "answer.pin",
        "answer.clear",
        "answer.stop",
        "chat.message",
        "settings.update",
        "speaker.correct",
        "dev.simulate",
    }
)
