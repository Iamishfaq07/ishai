"""Heuristic question detection (spec §7, §12).

Cheap and deterministic: it runs on every partial/final transcript update, so it must stay in the
microsecond range. Results in the ambiguous band set `needs_llm=True`; the engine may escalate those
to an LLM classifier, but the default path never waits on one.
"""

import re
from dataclasses import dataclass, field

from orbit_api.live.events import QuestionType, SessionType, Speaker

_WORD = re.compile(r"[a-z0-9']+")

# Utterances that are acknowledgements, not requests.
_FILLERS = {
    "okay", "ok", "okay great", "interesting", "right", "alright", "all right", "great", "cool", "nice",
    "sure", "yes", "yeah", "yep", "no", "nope", "mhm", "mm hmm", "uh huh", "hmm", "got it", "i see",
    "makes sense", "that makes sense", "perfect", "awesome", "thanks", "thank you", "i agree",
    "agreed", "exactly", "good", "very good", "sounds good", "let's continue", "lets continue",
    "let's move on", "moving on", "give me one second", "give me a second", "one second",
    "just a second", "hold on", "one moment", "can you hear me", "you're on mute", "sorry go ahead",
    "go ahead", "no worries", "fair enough", "understood",
}

_FILLER_TOKENS = frozenset({"okay", "ok", "right", "so", "yeah", "great", "um", "uh", "hmm", "cool", "nice",
                            "alright", "interesting", "perfect", "sure", "yes", "yep", "got", "it", "thanks"})

_WH = ("what", "what's", "whats", "why", "how", "how's", "when", "where", "which", "who", "whom", "whose")
_AUX = (
    "can", "could", "would", "will", "do", "does", "did", "is", "are", "was", "were", "have", "has",
    "had", "should", "shall", "may", "might",
)
_IMPERATIVE = (
    "tell me", "walk me through", "walk us through", "describe", "explain", "give me", "give us",
    "talk about", "talk me through", "talk us through", "share", "design", "implement", "write",
    "optimize", "optimise", "compare", "define", "list", "outline", "summarize", "summarise",
    "elaborate", "expand on", "go over", "take me through", "show me", "debug", "solve", "estimate",
    "introduce yourself", "let's talk about", "i'd like to hear", "i'd love to hear", "i want to hear",
    "i'm curious", "i am curious", "help me understand",
)
# Phrases that turn a statement into a question even mid-sentence.
_EMBEDDED = ("could you", "can you", "would you", "do you", "have you", "are you", "what would", "how would")

# Tokens that mean the speaker hasn't finished the thought.
_TRAILING = {
    "and", "or", "but", "so", "the", "a", "an", "to", "of", "for", "with", "about", "in", "on", "at",
    "your", "my", "our", "their", "that", "which", "if", "because", "like", "um", "uh", "is", "are",
    "was", "how", "what", "why", "when", "where", "would", "could", "can", "do", "you", "me", "some",
    "any", "this", "these", "those", "from", "into", "by", "as", "than", "then",
}

_TYPE_RULES: list[tuple[QuestionType, tuple[str, ...]]] = [
    (QuestionType.salary, ("salary", "compensation", "pay range", "expected pay", "expectations for pay",
                           "notice period", "ctc", "equity")),
    (QuestionType.clarification, ("what do you mean", "can you clarify", "could you clarify",
                                  "could you repeat", "can you repeat", "say that again", "rephrase")),
    (QuestionType.coding, ("write a function", "write code", "implement", "algorithm", "leetcode", "array",
                           "linked list", "binary tree", "time complexity", "big o", "optimize this code",
                           "optimise this code", "this code", "the code", "string reversal", "two sum",
                           "hash map", "recursion", "sql query", "write a query", "debug this")),
    (QuestionType.system_design, ("design a", "design an", "design the", "how would you design",
                                  "how would you build", "build a system", "let's design", "scale",
                                  "architecture", "architect", "distributed", "throughput",
                                  "high availability", "load balancer", "sharding", "rate limiter",
                                  "microservice", "capacity", "qps", "requests per second",
                                  "design twitter", "design instagram", "design a url", "design youtube")),
    (QuestionType.resume, ("tell me about yourself", "introduce yourself", "walk me through your",
                           "your background", "your resume", "your experience", "your current role",
                           "your last role", "your previous role", "your role at", "at your last",
                           "in your current", "your career")),
    (QuestionType.behavioral, ("tell me about a time", "describe a time", "give me an example of a time",
                               "a situation where", "conflict", "disagree", "failure", "failed", "mistake",
                               "proud", "difficult", "challenge", "pressure", "deadline", "feedback",
                               "strength", "weakness")),
    (QuestionType.leadership, ("lead a team", "led a team", "leadership", "mentor", "manage people",
                               "managed a team", "delegate", "stakeholder", "influence")),
    (QuestionType.culture, ("why do you want", "why this company", "why us", "why are you leaving",
                            "our culture", "values", "where do you see yourself", "what motivates you",
                            "why should we hire")),
]

# Phrases that only make sense relative to the previous answer. Deliberately NOT bare pronouns
# ("it"/"that"/"they"/"there"): a new short question that merely contains one ("how does that work in Go?")
# is usually a fresh topic, and flagging it as a follow-up pollutes retrieval with the prior question.
_FOLLOW_UP_MARKERS = (
    "why did you", "why that", "why not", "how so", "what about", "and then", "what was your",
    "what was the", "how did you", "how did that", "can you go deeper", "go deeper", "more detail",
    "such as", "what happened", "what would you do differently", "that database", "that approach",
    "that decision", "that project", "that one", "that role", "there instead", "tell me more",
)


def normalize(text: str) -> str:
    return " ".join(_WORD.findall(text.lower()))


def tokens(text: str) -> list[str]:
    return _WORD.findall(text.lower())


@dataclass(frozen=True)
class DetectorContext:
    session_type: SessionType = "interview"
    previous_question: str | None = None
    seconds_since_previous_answer: float | None = None


@dataclass
class Detection:
    is_question: bool
    confidence: float
    question_text: str
    question_type: QuestionType
    is_complete: bool
    is_follow_up: bool = False
    should_generate: bool = False
    needs_llm: bool = False
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, object]:
        return {
            "is_question": self.is_question,
            "confidence": round(self.confidence, 3),
            "question_text": self.question_text,
            "question_type": self.question_type.value,
            "should_generate": self.should_generate,
        }


def _starts_with(norm: str, prefixes: tuple[str, ...]) -> bool:
    return any(norm == p or norm.startswith(p + " ") for p in prefixes)


def _clause_starts(norm: str, prefixes: tuple[str, ...]) -> bool:
    """True if any clause (split on common discourse markers) starts with a prefix."""
    for clause in re.split(r"\b(?:so|and|okay|ok|now|alright|great)\b", norm):
        if _starts_with(clause.strip(), prefixes):
            return True
    return False


def classify_type(norm: str) -> QuestionType:
    for qtype, needles in _TYPE_RULES:
        if any(n in norm for n in needles):
            return qtype
    return QuestionType.technical


def is_complete(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if stripped.endswith(("?", ".", "!")):
        return True
    toks = tokens(stripped)
    if not toks:
        return False
    return toks[-1] not in _TRAILING


_SENTENCE = re.compile(r"(?<=[.?!])\s+")
_PLEASANTRIES = (
    "thanks for joining", "thank you for joining", "thanks for having", "thank you for having",
    "thanks for coming", "thank you for coming", "nice to meet you", "good to meet you", "great to meet you",
    "welcome", "great to have you", "good to see you", "glad you could make it",
)
_WAIT_PHRASE = re.compile(r"^(give me|just|hold on|wait) (a|one|1) (second|sec|moment|minute)")
# A short sentence right before the question that frames it ("Let's talk about your time at Acme.").
_LEAD_IN = ("let's talk about", "lets talk about", "moving on", "switching gears", "you mentioned", "i see you",
            "i noticed", "on your resume", "looking at your", "in your last role", "at your last company")


def _is_noise(sentence: str) -> bool:
    n = normalize(sentence)
    toks = n.split()
    return (not toks or n in _FILLERS or bool(_WAIT_PHRASE.match(n))
            or any(n.startswith(p) for p in _PLEASANTRIES)
            or (len(toks) <= 3 and all(t in _FILLER_TOKENS for t in toks)))


def extract_question(text: str) -> str:
    """The question inside a multi-sentence turn: drops fillers, pleasantries and trailing fragments.

    Real system audio merges things into one turn ("Right. Okay. Give me one second. <other app audio>",
    "Thanks for joining us today. So tell me about yourself."), so detection is per sentence.
    """
    raw = text.strip()
    sentences = [x.strip() for x in _SENTENCE.split(raw) if x.strip()]
    if len(sentences) <= 1:
        return raw
    for i in range(len(sentences) - 1, -1, -1):
        if not _is_noise(sentences[i]) and _detect_one(sentences[i], "interviewer", DetectorContext()).is_question:
            start = i
            if i > 0 and not _is_noise(sentences[i - 1]) and normalize(sentences[i - 1]).startswith(_LEAD_IN):
                start = i - 1
            return " ".join(sentences[start : i + 1])
    kept = [x for x in sentences if not _is_noise(x)]
    return " ".join(kept) if kept else sentences[-1]


def continue_question(question: str, more: str) -> str:
    """A held question plus what the interviewer added after pausing, minus fillers ("okay", "um")."""
    kept = [x.strip() for x in _SENTENCE.split(more.strip()) if x.strip() and not _is_noise(x)]
    return " ".join([question.strip(), *kept]).strip()


def detect(text: str, speaker: Speaker, ctx: DetectorContext | None = None) -> Detection:
    return _detect_one(extract_question(text), speaker, ctx)


def _detect_one(text: str, speaker: Speaker, ctx: DetectorContext | None = None) -> Detection:
    ctx = ctx or DetectorContext()
    raw = text.strip()
    norm = normalize(raw)
    toks = norm.split()
    reasons: list[str] = []

    def result(conf: float, qtype: QuestionType, **kw: object) -> Detection:
        complete = is_complete(raw)
        conf = max(0.0, min(1.0, conf))
        is_q = conf >= 0.5 and qtype not in (QuestionType.non_question, QuestionType.small_talk)
        d = Detection(
            is_question=is_q,
            confidence=conf,
            question_text=raw,
            question_type=qtype,
            is_complete=complete,
            reasons=reasons,
            **kw,  # type: ignore[arg-type]
        )
        d.should_generate = is_q and complete and conf >= 0.6
        d.needs_llm = 0.35 <= conf < 0.6 and complete
        return d

    if not toks:
        return result(0.0, QuestionType.non_question)

    # In mock mode the AI is the interviewer, so nothing the user's side says should trigger.
    answerable_speakers = ("interviewer", "other")
    if speaker not in answerable_speakers:
        reasons.append("speaker_not_interviewer")
        return result(0.0, QuestionType.non_question)

    if norm in _FILLERS or _WAIT_PHRASE.match(norm) or (len(toks) <= 3 and all(t in _FILLER_TOKENS for t in toks)):
        reasons.append("filler")
        return result(0.02, QuestionType.small_talk)

    score = 0.0
    if raw.endswith("?"):
        score += 0.45
        reasons.append("question_mark")
    if _clause_starts(norm, _WH):
        score += 0.4
        reasons.append("wh_word")
    elif _clause_starts(norm, _AUX):
        score += 0.3
        reasons.append("aux_inversion")
    if _clause_starts(norm, _IMPERATIVE):
        score += 0.55
        reasons.append("imperative_request")
    if any(p in norm for p in _EMBEDDED):
        score += 0.2
        reasons.append("embedded_request")
    if len(toks) < 3:
        score -= 0.25
        reasons.append("very_short")
    if len(toks) >= 6:
        score += 0.05

    qtype = classify_type(norm)
    if qtype is not QuestionType.technical:
        score += 0.1  # a recognised interview category is itself evidence

    # Follow-up: short-ish, refers back, and there was a recent question.
    follow_up = False
    if ctx.previous_question and (ctx.seconds_since_previous_answer or 0) < 600 and len(toks) <= 14:
        padded = f" {norm} "
        if any(f" {m} " in padded or norm.startswith(m) for m in _FOLLOW_UP_MARKERS):
            follow_up = True
            reasons.append("follow_up_reference")
            if qtype in (QuestionType.technical,):
                qtype = QuestionType.follow_up

    if ctx.session_type == "mock":
        score = 0.0  # the model asks in mock mode; user speech is an answer, not a question
        reasons.append("mock_mode")

    return result(score, qtype, is_follow_up=follow_up)
