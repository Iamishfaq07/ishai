"""Heuristic question detection (spec §7, §12).

Cheap and deterministic: it runs on every partial/final transcript update, so it must stay in the
microsecond range. Results in the ambiguous band set `needs_llm=True`; the engine may escalate those
to an LLM classifier, but the default path never waits on one.
"""

import re
from dataclasses import dataclass, field, replace

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

# Stripped from the front before judging the rest ("Hmm, and the database layer?"); "and" is kept on purpose,
# it's what marks a follow-up fragment.
_LEAD_FILLERS = _FILLER_TOKENS | {"um", "uh", "hmm", "well", "but", "so"}

_WH = ("what", "what's", "whats", "why", "how", "how's", "when", "where", "which", "who", "whom", "whose")
_AUX = (
    "can", "could", "would", "will", "do", "does", "did", "is", "are", "was", "were", "have", "has",
    "had", "should", "shall", "may", "might",
)
# Multi-word requests: unambiguous at the start of a clause.
_IMPERATIVE = (
    "tell me", "walk me through", "walk us through", "give me", "give us",
    "talk about", "talk me through", "talk us through", "expand on", "go over", "take me through", "show me",
    "introduce yourself", "let's talk about", "i'd like to hear", "i'd love to hear", "i want to hear",
    "i'm curious", "i am curious", "help me understand",
    # asks for more on the current topic ("A little more on the security side.")
    "say more", "tell me more", "a little more on", "a little more about", "a bit more on", "a bit more about",
    "a little more detail", "a bit more detail", "more detail on", "go deeper", "dig into", "dig deeper",
    "run me through", "run us through", "take us through", "break down", "go into",
)
# One-word verbs double as nouns/statements ("Design is a big part of our culture", "Share price is up"): they
# only count as a request when followed by what they act on.
_VERB_IMPERATIVE = (
    "describe", "explain", "share", "design", "implement", "write", "optimize", "optimise", "compare", "define",
    "list", "outline", "summarize", "summarise", "elaborate", "debug", "solve", "estimate", "clarify", "unpack",
    "build", "sketch", "code", "model", "reverse", "sort", "calculate", "prove", "evaluate", "justify",
)
_OBJECT_START = frozenset({
    "your", "you", "yourself", "me", "us", "a", "an", "the", "this", "that", "these", "those", "how", "what", "why",
    "when", "where", "which", "who", "some", "one", "two", "three", "each", "every", "any", "on", "for", "it",
})
# A verb later in the clause means the "imperative" was a noun ("Design reviews happen weekly.").
_FINITE = frozenset({"is", "are", "was", "were", "has", "have", "had", "will", "would", "can", "could", "should",
                     "takes", "took", "happen", "happens", "happened", "matters", "matter", "went", "goes", "comes",
                     "came", "looks", "seems", "keeps", "needs", "works", "runs", "ran", "got", "gets",
                     "made", "makes", "does", "did", "isn't", "aren't", "wasn't", "won't", "doesn't", "didn't"})
# A verb right after the "imperative" means it was the subject of a statement ("Tell me is what my manager says").
_COPULA = frozenset({"is", "are", "was", "were", "has", "have", "had", "will", "would", "can", "could", "ups", "up",
                     "s", "took", "takes", "went", "goes"})
# Indirect asks anywhere in the sentence ("So the next thing I wanted to ask is how you handle secrets").
_INDIRECT = (
    "wanted to ask", "want to ask", "like to ask", "i'd like to know", "i would like to know", "want to know",
    "love to know", "question for you is", "my question is",
)
_WONDERING = re.compile(r"\b(?:wondering|curious) (?:if|whether|how|what|why|when|where|which|who|about)\b")
# "I'm especially interested in how you…", "I'd like to understand your approach to…", "I want you to…": asks phrased
# as statements, often the main question of a multi-part turn.
_INTEREST = re.compile(r"\b(?:i'm|i am) (?:\w+ )?(?:interested in|curious about|keen to hear)\b"
                       r"|\bi(?:'d| would)? (?:like|want|love) (?:you )?to (?:understand|hear|know|learn|see)\b"
                       r"|\bi(?:'d| would)? (?:like|want) you to\b")
# Explicit open floors for the candidate.
_DIRECT_ASKS = ("any questions for", "questions for me", "questions for us", "anything you'd like to ask",
                "anything you want to ask", "anything else you'd like to add", "anything to add")
# Bare continuers: a request ONLY when a question was just discussed ("Go on." after an answer).
_CONTINUERS = {"go on", "keep going", "continue", "and", "and then", "why", "how so", "how", "such as", "like what",
               "for example", "for instance", "meaning", "why not", "and why", "what else", "anything else", "more"}
# Coding prompts are often statements ("Two sum, given an array of integers.").
_CODING_PROMPT = re.compile(r"\bgiven (?:a|an|two|the|n|k)\b|\breturn (?:the|all|true|a)\b|\bfind (?:the|all)\b")
# Screen-share / call logistics that start like requests but aren't interview questions.
_LOGISTICS = ("share your screen", "share my screen", "let me share", "can you see my screen", "can you hear me",
              "you're on mute", "you are on mute", "turn on your camera", "let me know when")
# Talk around the interview, never part of a question: the call itself and the interviewer's note-taking. Not carried
# over onto the next question ("I'll make a note of that." <pause> "Let's do a coding question...").
_ASIDES = ("you cut out", "you're cutting out", "you're breaking up", "you broke up", "you froze", "you're frozen",
           "bad connection", "my internet", "lost you for", "i'll make a note", "let me make a note", "let me note",
           "i'll note that", "noting that down", "let me write that", "i'm writing that", "i'm taking notes",
           "taking some notes", "jotting")
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
                           "subarray", "substring", "subsequence",
                           "linked list", "binary tree", "time complexity", "big o", "optimize this code",
                           "optimise this code", "this code", "the code", "string reversal", "two sum",
                           "hash map", "recursion", "sql query", "write a query", "debug this",
                           # how people name the classic problems and ask for code out loud
                           "write a program", "write a script", "write a method", "write a class", "write an algorithm",
                           "write some code", "write the code", "write a sql", "write a python", "write a java",
                           "show me the code", "give me the code", "pseudocode", "pseudo code",
                           "palindrom", "anagram", "fibonacci", "factorial", "fizzbuzz", "fizz buzz", "prime number",
                           "parenthes", "balanced bracket", "dynamic programming", "memoiz", "binary search",
                           "bubble sort", "merge sort", "quick sort", "quicksort", "insertion sort", "selection sort",
                           "heap sort", "heapsort", "counting sort", "radix sort", "sorting algorithm", "sorted list",
                           "sorted array", "two sorted", "directed graph", "undirected graph", "weighted graph",
                           "acyclic graph", "graph travers", "tree travers", "inorder", "preorder", "postorder",
                           "level order", "depth first", "breadth first", "topological sort", "shortest path",
                           "dijkstra", "connected component", "number of islands", "detect a cycle", "has a cycle",
                           "cycle detection", "lru cache", "lfu cache", "reverse a string", "reverse a number",
                           "reverse an integer", "reverse the string", "reverse a word", "reverse the word",
                           "reverse words", "reverse a sentence", "second largest", "second highest",
                           "second smallest", "kth largest", "kth smallest", "missing number", "duplicate number",
                           "remove duplicates", "find duplicates", "find the duplicate", "sum of digits", "even or odd",
                           "odd or even", "vowel", "frequency of each", "count the frequency", "count the occurrences",
                           "occurrences of each", "sliding window", "two pointer", "kadane", "n queens",
                           "sudoku solver", "tower of hanoi", "rotate a matrix", "spiral matrix", "2d matrix",
                           "matrix multiplication", "binary search tree", "min heap", "max heap", "prefix tree",
                           "longest common", "longest increasing", "string compression", "compress a string")),
    (QuestionType.system_design, ("design a", "design an", "design the", "how would you design",
                                  "how would you build", "build a system", "let's design", "scale",
                                  "architecture", "architect", "distributed", "throughput",
                                  "high availability", "load balancer", "sharding", "rate limiter",
                                  "microservice", "capacity", "qps", "requests per second",
                                  "design twitter", "design instagram", "design a url", "design youtube")),
    (QuestionType.resume, ("tell me about yourself", "about yourself", "introduce yourself",
                           "walk me through your", "your background", "your resume", "your experience",
                           "your current role", "your last role", "your previous role", "your role at", "at your last",
                           "in your current", "your career", "your last project", "your current project",
                           "your recent project", "your most recent project", "a recent project", "a project you",
                           "university", "college", "your degree", "your education", "you studied", "did you study",
                           "experience with", "worked with", "have you used", "have you worked", "familiar with",
                           # "the payment service you built at Acme": about the candidate's own work
                           "you built", "you led", "you designed", "you worked on", "you shipped", "you owned",
                           "you created", "you wrote", "you ran", "you managed", "you implemented")),
    (QuestionType.behavioral, ("tell me about a time", "describe a time", "give me an example of a time",
                               "a situation where", "conflict", "disagree", "failure", "failed", "mistake",
                               "proud", "difficult", "challenge", "pressure", "deadline", "feedback",
                               "strength", "weakness", "prioritize", "prioritise", "prioritization",
                               "prioritisation", "work style", "working style")),
    (QuestionType.leadership, ("lead a team", "led a team", "leadership", "mentor", "manage people",
                               "managed a team", "delegate", "stakeholder", "influence")),
    (QuestionType.culture, ("why do you want", "why this company", "why us", "why are you leaving",
                            "our culture", "values", "where do you see yourself", "what motivates you",
                            "why should we hire", "why this role", "why this position", "why are you looking",
                            "what interests you about", "what attracted you", "why are you interested",
                            "what do you know about us", "what do you know about our",
                            # the open floor at the end: the candidate asks the questions now
                            "any questions for", "questions for me", "questions for us",
                            "anything you'd like to ask", "anything you want to ask")),
]

# Phrases that only make sense relative to the previous answer. Deliberately NOT bare pronouns
# ("it"/"that"/"they"/"there"): a new short question that merely contains one ("how does that work in Go?")
# is usually a fresh topic, and flagging it as a follow-up pollutes retrieval with the prior question.
_FOLLOW_UP_MARKERS = (
    "why did you", "why that", "why not", "how so", "what about", "and then", "what was your",
    "what was the", "how did you", "how did that", "can you go deeper", "go deeper", "more detail",
    "such as", "what happened", "what would you do differently", "that database", "that approach",
    "that decision", "that project", "that one", "that role", "there instead", "tell me more",
    "and the", "and your", "and what", "and how", "and why", "expand on that", "more on that", "that part",
    "that side", "your thinking", "when it failed",
    # back-references to what the candidate just described
    "the team", "the project", "the outcome", "the result", "same way", "do it again", "looking back",
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


def _imperative_strength(norm: str) -> float:
    """Score for a request phrased as a command, judged per clause. 0.6 = clearly a request, 0.45 = maybe
    (ambiguous band → classifier), 0 = not a request."""
    best = 0.0
    for clause in re.split(r"\b(?:so|and|okay|ok|now|alright|great)\b", norm):
        toks = clause.split()
        if not toks:
            continue
        for phrase in _IMPERATIVE:
            n = len(phrase.split())
            if toks[:n] == phrase.split():
                nxt = toks[n] if len(toks) > n else ""
                best = max(best, 0.0 if nxt in _COPULA else 0.6)
        if toks[0] in _VERB_IMPERATIVE:
            nxt = toks[1] if len(toks) > 1 else ""
            if nxt in _COPULA:
                continue
            # "Explain microservices." / "Define idempotency." are commands; "Design reviews happen weekly." and
            # "Share price is up." are statements: a noun phrase followed by its own verb.
            statement = not nxt or any(t in _FINITE for t in toks[2:])
            best = max(best, 0.6 if nxt in _OBJECT_START or not statement else 0.45)
    return best


# "Second highest salary from an Employee table" is a SQL problem, not a pay negotiation.
_DATA_CUES = re.compile(r"\b(?:table|tables|query|queries|sql|column|columns|rows|select|join|schema)\b")


# Coding cues that must match as whole words: "code for" isn't "code formatting", "a trie" isn't "a tried and tested",
# "top k" isn't "top KPIs".
_CODING_WORDS = ("bfs", "dfs", "bst", "code it", "code this", "code that", "code up", "code for", "a trie", "the trie",
                 "using a stack", "with a stack", "top k", "a matrix", "the matrix", "a graph with")


def _type_pattern(qtype: QuestionType, needles: tuple[str, ...]) -> re.Pattern[str]:
    pattern = r"\b(?:" + "|".join(re.escape(n) for n in needles) + ")"
    if qtype is QuestionType.coding:
        pattern += r"|\b(?:" + "|".join(re.escape(n) for n in _CODING_WORDS) + r")\b"
    return re.compile(pattern)


# Needles match at the start of a word: "backpressure" is not about "pressure", "escalate" is not "scale".
_TYPE_PATTERNS: list[tuple[QuestionType, re.Pattern[str]]] = [
    (qtype, _type_pattern(qtype, needles)) for qtype, needles in _TYPE_RULES
]

# A small programming task said plainly ("check whether a number is prime", "merge two lists", "count the words in a
# sentence"): a verb that does something to data, then the data. Only for questions no other type claimed.
_CODING_TASK = re.compile(
    r"\b(?:find|count|check|reverse|sort|merge|remove|print|return|compute|calculate|detect|convert|rotate|flatten|"
    r"traverse|search|swap|split|validate|sum|generate|delete|insert|parse|group|filter|compress|encode|decode|"
    r"transpose|partition|shuffle|determine)\b(?: \w+){0,5}? (?:strings?|substrings?|lists?|arrays?|integers?|"
    r"numbers?|digits?|words?|characters?|chars?|nodes?|trees?|matrix|matrices|elements?|duplicates?|sentences?|"
    r"vowels?|intervals?)\b")


# Asking for a story is behavioral whatever the story is about: "Tell me about a time you had to scale a service" is
# not a system-design question, and "…a time you debugged a nasty bug" is not a coding one.
_STORY_ASK = re.compile(r"\b(?:tell me about|describe|give me an example of|share|walk me through|talk about) "
                        r"(?:a|one|the|another) (?:time|situation|moment|occasion|project|example)\b"
                        r"|\b(?:a|one) (?:time|situation) (?:when|where|that|you)\b|\bhave you ever\b")


def classify_type(norm: str) -> QuestionType:
    if _STORY_ASK.search(norm):
        return QuestionType.behavioral
    if _DATA_CUES.search(norm) and any(n in norm for n in ("salary", "salaries", "compensation", "pay")):
        return QuestionType.coding
    for qtype, pattern in _TYPE_PATTERNS:
        if pattern.search(norm):
            return qtype
    if _CODING_TASK.search(norm):
        return QuestionType.coding
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
            "i noticed", "on your resume", "looking at your", "in your last role", "at your last company",
            "my next question", "next question", "the next question", "the next thing", "next i want", "next i'd like",
            "i want to ask about", "i'd like to ask about", "let's move on to", "let's switch to", "let's shift to",
            "switching to", "turning to", "let's go back to", "going back to", "let's dig into", "let's dive into",
            "on the topic of", "speaking of", "let's look at", "let's turn to", "this one is about", "this is about",
            # a new round or topic ("Let's do a quick coding question.", "Let's switch gears.", "One more question.")
            "let's do a", "let's do another", "let's do some", "let's try a", "let's try another", "let's start with",
            "let's begin with", "let's get into", "let's jump into", "let's jump to", "let's move to",
            "let's change gears", "let's switch gears", "let's shift gears", "changing gears", "let's change topics",
            "let's switch topics", "changing topics", "a different topic", "another question", "one more question",
            "a different question", "last question", "final question", "my last question", "let's wrap up with",
            "i'd like to switch", "i want to switch", "let's go to", "let's move over to", "let's head to",
            "for the next part", "for this next part", "in this next part")
_OPENERS = frozenset({"so", "okay", "ok", "now", "alright", "and", "right", "well", "um", "uh"})
# The interviewer moving on: what follows is a new question, never more of the last one. Narrower than _LEAD_IN:
# "Let's talk about the architecture." or "You mentioned Kafka." may well still be about the same question.
_NEW_TOPIC = ("moving on", "switching gears", "next question", "my next question", "the next question",
              "the next thing", "next i want", "next i'd like", "let's move on", "let's switch to", "let's shift to",
              "switching to", "let's do a", "let's do another", "let's try a", "let's try another",
              "let's change gears", "let's switch gears", "let's shift gears", "changing gears", "let's change topics",
              "let's switch topics", "changing topics", "a different topic", "another question", "one more question",
              "a different question", "last question", "final question", "my last question", "i'd like to switch",
              "i want to switch",
              "let's move to", "let's move over to", "let's go to", "let's jump to", "let's go back to",
              "going back to", "for the next part", "for this next part", "in this next part", "let's wrap up with")


def _without_openers(sentence: str) -> str:
    toks = normalize(sentence).split()
    while toks and toks[0] in _OPENERS:
        toks = toks[1:]
    return " ".join(toks)


def _is_lead_in(sentence: str) -> bool:
    """Framing that names the topic of the question that follows ("So, my next question is about testing.")."""
    return _without_openers(sentence).startswith(_LEAD_IN)


def starts_new_topic(text: str) -> bool:
    """The interviewer opens by moving on ("Let's switch to system design.", "Okay, next question.", "Moving on."):
    a new question, not the continuation of the one before. Fillers before it are skipped."""
    for sentence in (x.strip() for x in _SENTENCE.split(text.strip())):
        if not sentence:
            continue
        if _without_openers(sentence).startswith(_NEW_TOPIC):
            return True
        if not _is_noise(sentence):
            return False
    return False


def _is_aside(sentence: str) -> bool:
    """Talk around the interview that isn't itself a question (a question that mentions a connection still is one)."""
    n = normalize(sentence)
    return ((any(p in n for p in _ASIDES) or any(p in n for p in _LOGISTICS))
            and not _detect_one(sentence, "interviewer").is_question)


def _is_noise(sentence: str) -> bool:
    n = normalize(sentence)
    toks = n.split()
    return (not toks or n in _FILLERS or bool(_WAIT_PHRASE.match(n))
            or any(n.startswith(p) for p in _PLEASANTRIES)
            or (len(toks) <= 3 and all(t in _FILLER_TOKENS for t in toks)))


def _question_span(sentences: list[str]) -> tuple[int, int] | None:
    """(first, last) sentence index of the last question in a turn. A framing lead-in before it ("Next question.")
    isn't part of what's scored: scored together, "Next question. Write a function that reverses a list." read as a
    statement (0.15) and was never answered. question_in_context still keeps the lead-in with the question."""
    for i in range(len(sentences) - 1, -1, -1):
        if not _is_noise(sentences[i]) and _detect_one(sentences[i], "interviewer", DetectorContext()).is_question:
            return i, i
    return None


def extract_question(text: str) -> str:
    """The question inside a multi-sentence turn: drops fillers, pleasantries and trailing fragments.

    Real system audio merges things into one turn ("Right. Okay. Give me one second. <other app audio>",
    "Thanks for joining us today. So tell me about yourself."), so detection is per sentence. This is the part
    that's *scored* as a question; `question_in_context` is what gets answered.
    """
    raw = text.strip()
    sentences = [x.strip() for x in _SENTENCE.split(raw) if x.strip()]
    if len(sentences) <= 1:
        return raw
    span = _question_span(sentences)
    if span is not None:
        return " ".join(sentences[span[0] : span[1] + 1])
    kept = [x for x in sentences if not _is_noise(x)]
    return " ".join(kept) if kept else sentences[-1]


# Set-up said before the question in the same breath ("Let's say you have a queue that's backing up. How would
# you debug it?"): answering only the last sentence loses what it's about.
_SETUP = ("let's say", "lets say", "say you", "imagine", "suppose", "assume", "consider", "given", "we have",
          "we've got", "we are", "we're", "you have", "you've got", "you are", "you're", "there is", "there's",
          "there are", "our ", "in this", "here's", "here is", "the problem", "the scenario", "the context",
          "for this", "for context", "a customer", "a user", "your team", "your manager", "so we", "so you",
          "so let's", "so imagine", "so say")
# Said right after the question, still part of it ("How would you design it? Assume a million users.").
_CONTINUATION = ("assume", "consider", "think about", "keep in mind", "focus on", "for example", "for instance",
                 "especially", "in particular", "including", "also ", "and ", "feel free", "you can assume",
                 "let's assume", "given that", "suppose", "start with", "then ", "bonus if")
# The interviewer reacting to the previous answer: what comes before it belongs to that exchange.
_REACTION = ("great", "good", "nice", "perfect", "awesome", "excellent", "thanks", "thank you", "okay", "ok",
             "alright", "all right", "got it", "makes sense", "that makes sense", "that's great", "that's a great",
             "that's helpful", "that's interesting", "that's fair", "fair enough", "interesting", "cool",
             "understood", "i see", "love that", "sounds good")
_BACK_REFERENCE = frozenset({"it", "its", "this", "that", "these", "those", "they", "them", "their", "there"})
MAX_CONTEXT_WORDS = 80
MAX_BRIDGE_SENTENCES = 2


def _is_reaction(sentence: str) -> bool:
    n = normalize(sentence)
    return len(n.split()) <= 8 and n.startswith(_REACTION)


def question_in_context(text: str) -> str:
    """The whole question as the interviewer put it in this turn: the question sentence plus the set-up and earlier
    parts said before it ("Tell me about your last project. What was the hardest part?"), and constraints added
    right after ("Assume a million users."). Unrelated speech merged into the turn (another app's audio, the
    interviewer reacting to your last answer) stays out: a sentence before the question is kept only if it's
    itself part of the question, opens like set-up, or the question refers back to it."""
    raw = text.strip()
    sentences = [x.strip() for x in _SENTENCE.split(raw) if x.strip()]
    span = _question_span(sentences) if len(sentences) > 1 else None
    if span is None:
        return extract_question(text)
    start, end = span
    before: list[str] = []
    words = 0
    # Statements between two parts of one question ("Tell me about your last project. I'm especially interested in
    # the scaling. What would you do differently?") are kept only once an earlier part is found before them.
    bridge: list[str] = []
    for j in range(start - 1, -1, -1):
        sentence = sentences[j]
        if _is_reaction(sentence):
            break
        if _is_noise(sentence):
            continue  # "um", "so", a pleasantry: skip over it
        n = normalize(sentence)
        size = len(tokens(sentence))
        if words + sum(len(tokens(b)) for b in bridge) + size > MAX_CONTEXT_WORDS:
            break
        chain = [*bridge, *before, *sentences[start : end + 1]]
        refers_back = bool(set(tokens(chain[0])) & _BACK_REFERENCE)
        related = (_detect_one(sentence, "interviewer", DetectorContext()).is_question or n.startswith(_SETUP)
                   or _is_lead_in(sentence) or (refers_back and size > 3))
        if not related:
            if len(bridge) >= MAX_BRIDGE_SENTENCES:
                break
            bridge.insert(0, sentence)
            continue
        before[:0] = [sentence, *bridge]
        words += size + sum(len(tokens(b)) for b in bridge)
        bridge = []
    after: list[str] = []
    for sentence in sentences[end + 1 :]:
        if _is_noise(sentence) or len(tokens(sentence)) < 3 or not normalize(sentence).startswith(_CONTINUATION):
            break
        after.append(sentence)
    return " ".join([*before, *sentences[start : end + 1], *after])


def lead_in(text: str, max_words: int) -> str:
    """Interviewer set-up before the actual question ("Let's talk about image classification.") — kept as
    part of the question, minus fillers/pleasantries/bare acknowledgements ("Great.", "Okay, thanks."), and
    trimmed from the front to the last `max_words` words. Talk around the interview ("I'll make a note of that.",
    "You cut out for a second.") and reactions to the last answer ("Right, good.") aren't set-up, so they stay out
    unless they open like one ("Okay, so let's say you have a queue...")."""
    def keep(x: str) -> bool:
        if _is_noise(x):
            return False
        if _detect_one(x, "interviewer").is_question:
            return True
        reaction = _is_reaction(x) and not (_without_openers(x).startswith(_SETUP) or _is_lead_in(x))
        return len(tokens(x)) > 3 and not reaction and not _is_aside(x)

    kept = [x.strip() for x in _SENTENCE.split(text.strip()) if x.strip() and keep(x)]
    while kept and sum(len(tokens(x)) for x in kept) > max_words:
        kept.pop(0)
    return " ".join(kept)


def continue_question(question: str, more: str) -> str:
    """A held question plus what the interviewer added after pausing, minus fillers ("okay", "um") and talk around
    the interview ("Sorry, you cut out.")."""
    kept = [x.strip() for x in _SENTENCE.split(more.strip()) if x.strip() and not _is_noise(x) and not _is_aside(x)]
    return " ".join([question.strip(), *kept]).strip()


# "…how you'd debug it, and what metrics you'd look at first": a second ask joined by "and" inside one sentence.
_JOINED_ASK = re.compile(r",?\s+(?:and|but|plus)\s+(?:also\s+|then\s+)?(?=(?:what|how|why|when|where|which|who|whether|"
                         r"would|could|can|do|does|did|is|are|should|tell|walk|explain|describe|give)\b)",
                         re.IGNORECASE)
MAX_PARTS = 6


def question_parts(question: str) -> list[str]:
    """The separate asks in a question, in order ("Tell me about your last project. What was the hardest part, and
    what would you do differently?" → three). Set-up and constraint sentences aren't parts of their own; they stay
    with the question text. A single ask gives one part."""
    parts: list[str] = []
    for sentence in (x.strip() for x in _SENTENCE.split(question.strip()) if x.strip()):
        if _is_noise(sentence) or not (_detect_one(sentence, "interviewer").is_question or _INTEREST.search(
                normalize(sentence))):
            continue
        pieces = [x.strip(" ,") for x in _JOINED_ASK.split(sentence) if x.strip(" ,")]
        end = sentence[-1] if sentence.endswith(("?", ".", "!")) else ""
        parts += [x if x.endswith(("?", ".", "!")) else x + end for x in pieces]
    return parts[:MAX_PARTS] if len(parts) > 1 else [question.strip()]


def detect(text: str, speaker: Speaker, ctx: DetectorContext | None = None) -> Detection:
    """Scored on the question sentence itself; `question_text` is the question in context (set-up and earlier
    parts from the same turn), which is what gets answered."""
    core = extract_question(text)
    d = _detect_one(core, speaker, ctx)
    if speaker != "interviewer":
        return d
    full = question_in_context(text)
    if full == core:
        return d
    # The type comes from the whole question when the last sentence alone doesn't name one ("Tell me about a time
    # you disagreed with your manager. How did you resolve it?" is behavioral, not technical).
    qtype = d.question_type
    if qtype is QuestionType.technical:
        qtype = classify_type(normalize(full))
    return replace(d, question_text=full, question_type=qtype)


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

    recent_question = bool(ctx.previous_question) and (ctx.seconds_since_previous_answer or 0) < 600
    # "Hmm, and the database layer?" → judge "and the database layer" (leading fillers carry no meaning).
    core = toks
    while len(core) > 1 and core[0] in _LEAD_FILLERS:
        core = core[1:]
    core_norm = " ".join(core)
    if recent_question and core_norm.rstrip(" ?") in _CONTINUERS:
        reasons.append("continuer_after_question")
        return result(0.7, QuestionType.follow_up, is_follow_up=True)

    if norm in _FILLERS or _WAIT_PHRASE.match(norm) or (len(toks) <= 3 and all(t in _FILLER_TOKENS for t in toks)):
        reasons.append("filler")
        return result(0.02, QuestionType.small_talk)
    if any(p in norm for p in _LOGISTICS):
        reasons.append("call_logistics")
        return result(0.05, QuestionType.small_talk)

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
    # An explicit request ("Expand on that.") is a question without a question mark.
    imperative = max(_imperative_strength(core_norm), _imperative_strength(norm))
    if imperative:
        score += imperative
        reasons.append("imperative_request" if imperative >= 0.6 else "possible_request")
    if any(p in norm for p in _EMBEDDED):
        score += 0.2
        reasons.append("embedded_request")
    if any(p in norm for p in _INDIRECT) or _WONDERING.search(norm) or _INTEREST.search(norm):
        score += 0.55
        reasons.append("indirect_request")
    if any(p in norm for p in _DIRECT_ASKS):
        score += 0.3
        reasons.append("open_floor")
    if len(toks) < 3 and imperative < 0.6:  # "Explain microservices." is short but plainly a request
        score -= 0.25
        reasons.append("very_short")
    if len(toks) >= 6:
        score += 0.05

    qtype = classify_type(norm)
    if qtype is not QuestionType.technical:
        score += 0.1  # a recognised interview category is itself evidence
    if qtype is QuestionType.coding and _CODING_PROMPT.search(norm):
        score += 0.5  # "Two sum, given an array of integers…" is the problem statement itself
        reasons.append("coding_prompt")

    # Follow-up: short-ish, refers back, and there was a recent question.
    follow_up = False
    if recent_question and len(toks) <= 14:
        padded = f" {core_norm} "
        if any(f" {m} " in padded or core_norm.startswith(m) for m in _FOLLOW_UP_MARKERS):
            follow_up = True
            reasons.append("follow_up_reference")
            if raw.endswith("?"):
                score += 0.2  # "…and the database layer?" only reads as a question next to the last one
            if qtype in (QuestionType.technical,):
                qtype = QuestionType.follow_up

    if ctx.session_type == "mock":
        score = 0.0  # the model asks in mock mode; user speech is an answer, not a question
        reasons.append("mock_mode")

    return result(score, qtype, is_follow_up=follow_up)
