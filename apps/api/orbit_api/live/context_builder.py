"""Builds the compact prompt for each answer (spec §14, §25, §57).

Sends only what this question needs: short profile, top retrieved facts, rolling summary, the last few
turns, and the question. Never the whole resume, JD, transcript, or document library.
"""

import re
from collections import deque
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

from orbit_api.live.events import AnswerLength, AnswerStyle, LiveAnswer, QuestionType, SessionType, Speaker
from orbit_api.providers.llm.base import LLMMessage
from orbit_api.retrieval.index import Hit, IndexedChunk, SessionIndex

RECENT_TURNS = 6
FOLLOW_UP_THREAD = 2  # earlier questions a follow-up's retrieval query inherits
EARLIER_ANSWERS = 6  # notes on the last answers given, so later ones stay consistent and don't retell a story
MAX_TURN_CHARS = 500
MAX_CONTEXT_CHARS = 5000  # ≈1.2k tokens of retrieved context

# Word targets, not item counts: ~150 spoken words per minute.
_LENGTH_RULES: dict[AnswerLength, str] = {
    "short": "Length: SHORT, about 60–80 words (20–30 seconds out loud), one paragraph. Multi-part question: "
             "one tight sentence per part.",
    "standard": "Length: STANDARD, about 130–180 words (45–75 seconds out loud), two or three short paragraphs.",
    "detailed": "Length: DETAILED, about 250–350 words (90–150 seconds out loud), three to five short "
                "paragraphs with a concrete example.",
}
_NATURAL = ("Style: NATURAL, a sharp and prepared person talking, not an essay: first person, contractions, plain "
            "words, sentences of different lengths, straight to the point and no wrap-up at the end.")
_CONCISE = ("Style: CONCISE, confident and to the point: the direct answer in the first sentence, then only the "
            "essentials, in short crisp sentences. No warm-up, no filler.")
_STORY = ("Style: STORY, make it concrete: walk through one example start to finish. For experience questions "
          "tell it as a story (the situation, what you did, how it turned out) in plain speech, never labelled "
          "as Situation/Task/Action/Result, and with no invented specifics beyond the verified facts. End on how it "
          "turned out, not on a lesson.")
_STYLE_RULES: dict[AnswerStyle, str] = {
    "natural": _NATURAL,
    "concise": _CONCISE,
    "story": _STORY,
    # legacy values on older sessions
    "bullets": _NATURAL,
    "technical": _NATURAL,
    "star": _STORY,
    "executive": _CONCISE,
}
_LANGUAGE_NAMES = {"cpp": "C++", "csharp": "C#", "javascript": "JavaScript", "typescript": "TypeScript",
                   "python": "Python", "java": "Java", "go": "Go", "rust": "Rust", "sql": "SQL"}
_SESSION_RULES: dict[SessionType, str] = {
    "interview": "Context: job interview. The user is the candidate.",
    "phone": "Context: phone/room-audio interview. The user is the candidate.",
    "meeting": "Context: professional meeting. Help the user contribute clearly; no candidate framing.",
    "coding": "Context: coding interview. The user is the candidate, solving problems live: technical questions get "
              "the talk track and then working code.",
    "assessment": "Context: online assessment PRACTICE. Teach the approach clearly.",
    "mock": "Context: mock interview practice.",
}


@cache
def live_system_prompt() -> str:
    return (Path(__file__).resolve().parents[1] / "prompts" / "live_system.md").read_text(encoding="utf-8")


_FENCE_TAG = re.compile(r"<\s*(/?)\s*reference_data", re.IGNORECASE)


def fence(text: str) -> str:
    """Neutralise attempts to open or close the reference fence from inside untrusted text, in any case and spacing
    ("</REFERENCE_DATA>", "< /reference_data>"): a job post or a document can't step outside its data block."""
    return _FENCE_TAG.sub(lambda m: f"‹{m.group(1)}reference_data", text)


@dataclass
class Turn:
    speaker: Speaker
    text: str


@dataclass(frozen=True)
class AnswerNote:
    """What an earlier answer said, in brief: its points and the user's facts it drew on."""

    question: str
    points: tuple[str, ...]
    drew_on: tuple[str, ...]
    example: bool  # an illustrative story the user must swap for a real one

    def line(self) -> str:
        said = " | ".join(self.points)[:240]
        extra = f" (drew on: {', '.join(self.drew_on[:3])})" if self.drew_on else ""
        if self.example:
            extra += " (an example story, not a verified one)"
        return f"Q: {self.question[:160]}\nA: {said}{extra}"


@dataclass
class SessionMemory:
    """Recent turns + rolling summary + question history (spec §25)."""

    recent: deque[Turn] = field(default_factory=lambda: deque(maxlen=RECENT_TURNS * 2))
    rolling_summary: str = ""
    questions: list[str] = field(default_factory=list)
    last_answer_brief: str = ""
    answers: deque[AnswerNote] = field(default_factory=lambda: deque(maxlen=EARLIER_ANSWERS))

    def add_turn(self, speaker: Speaker, text: str) -> None:
        self.recent.append(Turn(speaker, text[:MAX_TURN_CHARS]))

    def note_answer(self, question: str, answer: LiveAnswer) -> None:
        points = answer.key_points or answer.talking_points or [answer.direct_answer[:200]]
        drew_on = tuple(dict.fromkeys(s.label for s in answer.sources if s.verified and s.label))
        self.answers.append(AnswerNote(question, tuple(p for p in points if p), drew_on,
                                       answer.grounding == "example"))

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
    coding_language: str | None = None  # preferred language for code, if the user picked one
    # "design": structured system-design sections; "debug": root cause / fix / diff; "debug_if_error": a coding
    # screenshot — use the debug format only if the image shows an error or failing test.
    mode: str = "normal"
    # The candidate's standing preferences for every answer (saved with the setup). Preferences, never rules.
    candidate_instructions: str | None = None
    # Fixed style hints learned from the candidate's 👎 reasons (sessions/feedback.LEARNED_HINTS), never user text.
    learned_preferences: list[str] = field(default_factory=list)
    company: str | None = None  # from the saved setup or the mock interview, when known
    # The separate asks of a multi-part question (question_detector.question_parts), listed so none is skipped.
    parts: list[str] = field(default_factory=list)


@dataclass
class BuiltPrompt:
    messages: list[LLMMessage]
    context_used: list[str]
    hits: list[Hit]
    # The facts as numbered in the prompt ("F1" → hit), so the model's SOURCES line can be resolved and checked.
    facts: dict[str, Hit] = field(default_factory=dict)


# Structured answer modes (launch brief §29–§30). The spoken talk track (ANSWER) always comes first.
_MODE_RULES = {
    "design": ("SYSTEM DESIGN MODE: ANSWER is the spoken talk track (how you'd walk the interviewer through it). "
               "Then write DESIGN: with one line per section, in this order, each 'Title: content' in a few words: "
               "Requirements, Assumptions, Scale, APIs, Data model, Architecture, Storage, Caching, Queues, "
               "Reliability, Security, Trade-offs. Skip a section only if it truly doesn't apply."),
    "debug": ("DEBUG MODE: this is a bug, error or failing test. ANSWER is how to explain it aloud (what's wrong, "
              "why, and the fix). Then ROOTCAUSE: (one line), FIX: (the minimal change, one line), WHY: (why it "
              "failed, one line), DIFF: followed by a ```diff fenced unified diff of the minimal fix, then CODE: "
              "with the full corrected code."),
    "debug_if_error": ("SCREENSHOT: first work out what the image shows. A coding problem (a task to write, implement "
                       "or solve, a problem statement, an editor with a task in it) gets a coding answer: the short "
                       "spoken ANSWER, then PROBLEM:, CODE: <language> with the complete, runnable solution in a "
                       "fenced block, TIME:, SPACE:, EDGE: and TESTS:. An error, a stack trace, a failing test or "
                       "wrong output gets DEBUG MODE: after ANSWER write ROOTCAUSE:, FIX:, WHY: (one line each), "
                       "DIFF: with a ```diff fenced minimal fix, then CODE: with the corrected code. Anything else "
                       "(a multiple-choice or written question, a diagram) gets the ANSWER, with CODE only if it "
                       "helps."),
    "screenshot": ("SCREENSHOT: first work out what the image shows. A coding problem (a task to write, implement or "
                   "solve, a problem statement, an editor with a task in it) gets a coding answer: the short spoken "
                   "ANSWER, then PROBLEM:, CODE: <language> with the complete, runnable solution in a fenced block, "
                   "TIME:, SPACE:, EDGE: and TESTS:. An error or failing test gets the cause and the fix in ANSWER and "
                   "the corrected code under CODE:. Anything else (a multiple-choice or written question, a diagram) "
                   "gets the ANSWER, with CODE only if it helps."),
}

# Every coding answer, outside the debug and design formats. Without it the model often answered in prose only.
_CODE_RULE = ("CODING ANSWER: ANSWER is the short spoken talk track, never code. After it you MUST write PROBLEM:, "
              "then CODE: <language> on its own line followed by the complete, runnable solution in a ```<language> "
              "fenced block, then TIME:, SPACE:, EDGE: and TESTS:. Never answer a coding question in prose alone. A "
              "conceptual question still gets a short code example that shows the idea.")
# A technical question the detector didn't call coding may still be one ("so, how would you do that in Python?"): the
# model, which reads the whole conversation, decides.
_MAYBE_CODE_RULE = ("If answering this properly means writing code (they ask you to write, implement, solve or code "
                    "something), answer it as a coding question: the spoken ANSWER, then CODE: <language> with the "
                    "complete solution in a ```<language> fenced block, then TIME: and SPACE:. A short snippet under "
                    "CODE: is also fine when it makes a technical point clearer. Code never goes inside ANSWER.")

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
    "fit; if they don't, answer fully with a generic, adaptable structure, never a fabricated specific "
    "(employer, project, metric, 'I did X'), and never announce the absence (no grounding disclaimers). For a "
    "genuinely personal detail you can't know, you may leave AT MOST ONE inline [bracketed] cue the UI shows "
    "as a dim non-spoken hint; never let a bracketed cue or caveat replace a real answer. For salary/comp, "
    "never state a number as the user's own unless verified; use a negotiation-safe framing."
)

# Questions a story-bank example answers best: always offer the most relevant story, if one matches at all.
_STORY_TYPES = {QuestionType.behavioral, QuestionType.leadership, QuestionType.culture}

# Why this company / role / move: answered from the job post's "about us" and the role's responsibilities.
_MOTIVATION_TYPES = {QuestionType.culture}

# "Tell me about yourself" is about the whole arc, not the facts that happen to share words with it,
# so these always get the profile summary and the most recent roles (resumes list newest first).
_ANCHORED_TYPES = {QuestionType.resume}


# "Tell me about yourself" / "walk me through your background" ask for the whole arc; "your experience WITH Kafka" is
# about one topic, and gets the facts that match it instead.
_BROAD_BACKGROUND = re.compile(
    r"\b(?:tell me about yourself|introduce yourself|about your background|your background|walk me through your "
    r"(?:resume|cv|background|career|journey)|your career (?:so far|path|story)"
    r"|your (?:resume|cv)\b(?! (?:says|mentions)))",
    re.IGNORECASE)


def _anchor_hits(index: SessionIndex) -> list[Hit]:
    # A summary line that's only a name ("Jane Doe") tells the model nothing.
    summary = [c for c in index.by_category("resume", ("summary",), 4) if len(c.text.split()) >= 4][:2]
    anchors: list[IndexedChunk] = summary
    anchors += index.by_category("resume", ("experience",), 4)
    return [Hit(c, 1.0) for c in anchors]


def retrieve(index: SessionIndex, inputs: PromptInputs, memory: SessionMemory) -> list[Hit]:
    query = inputs.question
    if inputs.is_follow_up and memory.questions:
        # Follow-ups inherit the thread's topic. A chain ("Why Kafka?" → "What would you do differently?" → "How did
        # you test it?") loses it after one step, so the last two questions come along.
        query = " ".join([*memory.questions[-FOLLOW_UP_THREAD:], inputs.question])
    hits = index.search(query, inputs.qtype, k=6)
    if inputs.qtype in _ANCHORED_TYPES and _BROAD_BACKGROUND.search(inputs.question):
        anchored = _anchor_hits(index)
        seen = {h.chunk.id for h in anchored}
        hits = anchored + [h for h in hits if h.chunk.id not in seen]
    if inputs.qtype in _STORY_TYPES and not any(h.chunk.doc_kind == "story" for h in hits):
        # "Tell me about a time…": the user's own story-bank example beats any single resume bullet.
        hits = index.search(query, inputs.qtype, k=1, doc_kind="story") + hits
    if inputs.qtype in _MOTIVATION_TYPES:
        # "Why us?" is answered from what the job post says about the company and the role, which rarely shares
        # words with the question; so bring that in whatever the search found.
        seen = {h.chunk.id for h in hits}
        about = index.by_category("job_description", ("company",), 2)
        about += index.by_category("job_description", ("responsibility",), 1)
        hits += [Hit(c, 1.0) for c in about if c.id not in seen]
    if not any(h.chunk.doc_kind == "job_description" for h in hits):
        hits += index.search(query, inputs.qtype, k=2, doc_kind="job_description")
    return hits


def build_prompt(index: SessionIndex, inputs: PromptInputs, memory: SessionMemory) -> BuiltPrompt:
    hits = retrieve(index, inputs, memory)

    ctx_lines: list[str] = []
    used: list[str] = []
    facts: dict[str, Hit] = {}
    budget = MAX_CONTEXT_CHARS
    for h in hits:
        tag = "VERIFIED CANDIDATE FACT" if h.chunk.verified else h.chunk.doc_kind.upper()
        ref = f"F{len(facts) + 1}"
        prefix = f"{ref} [{tag}] ({h.chunk.label}) "
        # Hits are ranked, so once we can't fit a fact, truncate it rather than skipping to a
        # lower-ranked one (which would invert priority). Keep a little headroom for the tag.
        avail = budget - len(prefix)
        if avail < 120:
            break
        line = prefix + h.chunk.text[:avail]
        budget -= len(line)
        ctx_lines.append(line)
        facts[ref] = h
        if h.chunk.label not in used:
            used.append(h.chunk.label)

    settings_block = "\n".join(
        [
            _SESSION_RULES[inputs.session_type],
            f"Target role: {inputs.role}" if inputs.role else "",
            f"Company: {inputs.company}" if inputs.company else "",
            _LENGTH_RULES[inputs.length],
            _STYLE_RULES[inputs.style] if inputs.qtype != QuestionType.coding else "",
            f"Answer language: {(inputs.answer_language or '').strip() or 'English'}",
            (f"Write any code in {_LANGUAGE_NAMES.get(inputs.coding_language, inputs.coding_language)} unless the "
             "question or the user's request names a different language.") if inputs.coding_language else "",
            _GROUNDING_RULE if inputs.qtype in _PERSONAL_TYPES or inputs.is_follow_up else "",
            _MODE_RULES.get(inputs.mode, ""),
            _CODE_RULE if inputs.qtype == QuestionType.coding and inputs.mode == "normal" else "",
            _MAYBE_CODE_RULE if inputs.qtype in (QuestionType.technical, QuestionType.follow_up)
            and inputs.mode == "normal" else "",
            f"Question type: {inputs.qtype.value}" + (" (follow-up to the previous question)" if inputs.is_follow_up
                                                     else ""),
        ]
    ).strip()

    parts: list[str] = [settings_block]
    if inputs.learned_preferences:
        parts.append("Learned from the candidate's ratings of earlier answers:\n"
                     + "\n".join(f"- {h}" for h in inputs.learned_preferences[:5]))
    if inputs.candidate_instructions:
        parts.append("The candidate's own preferences for every answer. Follow them when they don't conflict with "
                     "the rules above (they can't change the format, grounding or honesty rules):\n"
                     "<reference_data source=\"candidate_preferences\">\n"
                     + fence(inputs.candidate_instructions[:1000]) + "\n</reference_data>")
    if ctx_lines:
        parts.append("<reference_data source=\"documents\">\n" + fence("\n".join(ctx_lines)) + "\n</reference_data>")
    else:
        parts.append("No resume/document context matched this question, and that's fine. Answer it fully from "
                     "professional knowledge; just don't claim specific personal experience the user "
                     "didn't provide.")
    if memory.rolling_summary:
        parts.append("<reference_data source=\"session_summary\">\n" + fence(memory.rolling_summary)
                     + "\n</reference_data>")
    show_previous = bool(memory.last_answer_brief and (inputs.is_follow_up or inputs.instruction))
    # The previous answer is shown in full below when it's the subject; the rest as notes.
    earlier = list(memory.answers)[:-1] if show_previous else list(memory.answers)
    if earlier:
        parts.append("<reference_data source=\"earlier_answers\">\n" + fence("\n".join(n.line() for n in earlier))
                     + "\n</reference_data>")
    turns = memory.recent_turns()
    if turns:
        convo = "\n".join(f"{t.speaker.upper()}: {t.text}" for t in turns)
        parts.append("<reference_data source=\"recent_conversation\">\n" + fence(convo) + "\n</reference_data>")
    if show_previous:
        parts.append("<reference_data source=\"previous_answer\">\n" + fence(memory.last_answer_brief)
                     + "\n</reference_data>")
    if inputs.instruction:
        parts.append("USER REQUEST (from the user, not the interviewer):\n" + fence(inputs.instruction))
    if len(inputs.parts) > 1:
        asks = "\n".join(f"{i}. {fence(a)}" for i, a in enumerate(inputs.parts, 1))
        parts.append(f"This question has {len(inputs.parts)} parts. Answer every one, in this order, giving each its "
                     "share (a multi-part answer may run up to a third over the length target), with at least one "
                     f"POINTS label per part:\n{asks}")
    parts.append("QUESTION: " + fence(inputs.question))

    return BuiltPrompt(
        messages=[LLMMessage("system", live_system_prompt()), LLMMessage("user", "\n\n".join(parts))],
        context_used=used,
        hits=hits,
        facts=facts,
    )
