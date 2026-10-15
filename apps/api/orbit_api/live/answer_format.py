"""Incremental parser for the line-oriented answer format the model is asked to stream.

JSON is a poor streaming format for a live UI (nothing is renderable until keys close), so the
model emits tagged lines and fenced code; we parse deltas into a `LiveAnswer` after every chunk:

    ANSWER:
    the spoken answer, in short paragraphs
    (blank line between paragraphs — kept as "\n\n" in direct_answer)
    - talking point            (legacy / if the model lists anyway)
    EXAMPLE: optional grounded example
    CODE: python
    ```python
    ...
    ```
    TIME: O(n)
    SPACE: O(n)
    TERMS: CI = tests run on every push | pod = one running copy of the app   (jargon the answer says, ≤ 3)
    FOLLOWUP: likely next question

Unknown/untagged prose before any tag is treated as the direct answer so a model that ignores the
format still produces something readable.
"""

import re
from collections.abc import Callable

from orbit_api.live.events import (
    CodeBlock,
    DebugInfo,
    DesignSection,
    DryRunTrace,
    FactSource,
    LiveAnswer,
    QuestionType,
    SpokenWalkthrough,
    Term,
)

# System design sections, in the order the prompt asks for them (keys are matched case-insensitively).
DESIGN_TITLES = ("Requirements", "Assumptions", "Scale", "APIs", "Data model", "Architecture", "Storage", "Caching",
                 "Queues", "Reliability", "Security", "Trade-offs")
_DESIGN_KEYS = {t.lower().replace("-", "").replace(" ", ""): t for t in DESIGN_TITLES}
_DESIGN_LINE = re.compile(r"^\s*(?:[-*•]\s*)?([A-Za-z][A-Za-z -]{1,20}?)\s*:\s*(.+)$")

_TAG = re.compile(r"^(GROUNDED|PROBLEM|ANSWER|EXAMPLE|CODE|TIME|SPACE|EDGE|TESTS|TERMS|FOLLOWUP|SOURCES|POINTS|DESIGN|"
                  r"ROOTCAUSE|FIX|WHY|DIFF|INTUITION|COMMENTARY|DEFENSE|TRACE)\s*:\s*(.*)$",
                  re.IGNORECASE)
MAX_LIST_ITEMS = 8
MAX_KEY_POINTS = 6
MAX_KEY_POINT_CHARS = 60
MAX_TERMS = 3
MAX_TERM_CHARS = 40
MAX_MEANING_CHARS = 120
# "term = plain meaning" (the format asks for "="; a colon or a spaced dash is read too).
_TERM_SPLIT = re.compile(r"\s*(?:=|:|\s[-–]\s)\s*")
# The model's own label for its personal claims (see live_system.md): only "example" is surfaced to the user.
_GROUNDING = {"verified": "verified", "inferred": "inferred", "example": "example", "general": "general",
              "unsupported": "example"}
_REF = re.compile(r"\bF(\d{1,2})\b", re.IGNORECASE)
_PERSONAL = frozenset({QuestionType.behavioral, QuestionType.resume, QuestionType.leadership, QuestionType.culture})
_BULLET = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.*)$")
_FENCE = re.compile(r"^\s*```\s*([\w+#-]*)\s*$")
# Inside code, only the tags the model writes AFTER the code end a block whose closing fence is missing, and only as it
# writes them: uppercase, at the start of the line, not an assignment. A docstring's "Time: O(n)", a typed local
# "answer: int = 0", a field "code: string;" are code (matched case-insensitively, they ended the block and the rest of
# the solution was lost or landed in the spoken answer).
_TRAILER = re.compile(r"^(?:TIME|SPACE|EDGE|TESTS|TERMS|FOLLOWUP|SOURCES|POINTS|"
                      r"INTUITION|COMMENTARY|DEFENSE|TRACE)\s*:\s*(.*)$")
_ASSIGNMENT = re.compile(r"\s=\s|;\s*$")
# A fence before anything else, followed by the reply's first tag, wraps the whole reply: it isn't code.
_OPENING_TAG = re.compile(r"^(?:GROUNDED|ANSWER)\s*:")


def _ends_code(line: str) -> bool:
    m = _TRAILER.match(line)
    # A TERMS line is "term = meaning" by format: its " = " is not an assignment.
    return m is not None and (line.startswith("TERMS") or not _ASSIGNMENT.search(m.group(1)))

# The spoken answer is read out by a person, and a few marks of machine writing give it away whatever the prompt
# says (live_system.md, "HOW IT SOUNDS"). These are the safe, mechanical ones: an em dash (or a spaced en dash) is
# said as a pause, so it becomes a comma; an opening "Great question." goes; a handful of stiff words become the
# plain ones. Only whole words change, so a word still streaming in isn't touched until it's complete.
# (?<!\s): start only at the beginning of a run of spaces, so 20,000 spaces cost one pass, not 20,000.
_DASH = re.compile(r"(?<!\s)\s*(?:—|(?<=\s)–(?=\s))\s*")
_DOUBLED = re.compile(r",\s*([,.;:!?])")
_OPENER = re.compile(r"^(?:great question|that's a (?:great|good|really good) question|good question|absolutely|"
                     r"certainly|sure thing|of course)\s*[.!,]+\s+(?=\S)", re.IGNORECASE)
_PLAIN: tuple[tuple[re.Pattern[str], str], ...] = tuple((re.compile(p, re.IGNORECASE), r) for p, r in (
    (r"\butili[sz]ing\b", "using"),
    (r"\butili[sz]ed\b", "used"),
    (r"\butili[sz]es\b", "uses"),
    (r"\butili[sz]e\b", "use"),
    (r"\bleveraging\b", "using"),
    (r"\bleveraged\b(?= (?:the|our|their|a|an|this|that|my|existing|it|them)\b)", "used"),
    (r"\bleverage\b(?= (?:the|our|their|a|an|this|that|my|existing|it|them)\b)", "use"),
    (r"\bin order to\b", "to"),
    (r"\bdelve into\b", "dig into"),
))


def humanize(text: str) -> str:
    """The mechanical half of making the spoken answer sound like a person (see _DASH above). Idempotent, and stable
    while the answer streams in (it's applied to every snapshot)."""
    if not text:
        return text
    out = _DASH.sub(", ", text)
    out = _DOUBLED.sub(r"\1", out)
    m = _OPENER.match(out)
    if m:
        rest = out[m.end():]
        out = rest[:1].upper() + rest[1:]
    for pattern, plain in _PLAIN:
        out = pattern.sub(_keep_case(plain), out)
    return out


def _keep_case(plain: str) -> Callable[[re.Match[str]], str]:
    """"Utilize" → "Use", "utilize" → "use": the replacement keeps a sentence's opening capital."""
    return lambda m: plain[:1].upper() + plain[1:] if m.group(0)[:1].isupper() else plain


class AnswerStreamParser:
    def __init__(self, question: str, qtype: QuestionType, context_used: list[str], *,
                 max_points: int | None = None, facts: dict[str, FactSource] | None = None) -> None:
        self._facts = facts or {}  # "F1" → the fact as numbered in the prompt
        self._buf = ""
        self._max_points = max_points  # hard cap for the chosen answer length; prompts alone don't enforce it
        self._question = question
        self._qtype = qtype
        self._context_used = context_used
        self._done = False

    def feed(self, delta: str) -> LiveAnswer:
        self._buf += delta
        return self.snapshot()

    def finish(self) -> LiveAnswer:
        """The answer once the stream has ended: a last line still without its newline counts as complete."""
        self._done = True
        return self.snapshot()

    @property
    def raw(self) -> str:
        return self._buf

    def snapshot(self) -> LiveAnswer:
        ans = LiveAnswer(question=self._question, type=self._qtype, context_used=list(self._context_used))
        section: str | None = None
        in_code = False
        wrapper = False  # the open block began before anything else: it may be a fence around the whole reply
        code_lang = ""
        code_tagged = False  # a CODE: line arrived: show the code box even before its first line streams
        code_lines: list[str] = []  # the block being read
        # Every code block: (written under CODE:, its lines). The solution under CODE: wins over snippets elsewhere.
        blocks: list[tuple[bool, list[str]]] = []
        in_diff = False
        diff_lines: list[str] = []
        stray: list[str] = []
        para_break = False  # a blank line inside the spoken answer starts a new paragraph
        terms: list[Term] = []

        lines = self._buf.split("\n")
        last = len(lines) - 1  # the line still being written (complete only once the stream ends)
        for i, line in enumerate(lines):
            tag = _TAG.match(line.strip())
            if in_diff:
                if _ends_code(line) or _FENCE.match(line):
                    in_diff = False
                    if not _ends_code(line):
                        continue
                else:
                    diff_lines.append(line)
                    continue
            if section == "DIFF" and _FENCE.match(line) and not in_code:
                in_diff = True
                continue
            if in_code:
                # A trailer tag (TIME/SPACE/FOLLOWUP/…) ends the code block even if the model's closing fence is
                # missing or mismatched — otherwise trailing sections would be swallowed as code.
                if wrapper and not code_lines and _OPENING_TAG.match(line):
                    in_code = wrapper = False  # "```text" then "GROUNDED: …": a fence around the reply, not code
                    blocks.pop()
                    code_lang = ""
                elif _ends_code(line):
                    in_code = False
                elif _FENCE.match(line):
                    in_code = False
                    if section == "CODE":
                        section = None  # anything after the closing fence is not more code
                    continue
                else:
                    code_lines.append(line)
                    continue
            elif _FENCE.match(line):
                fence = _FENCE.match(line)
                assert fence is not None
                # A fence on its own line opens a code block wherever it is: the model often writes the code right
                # after the talk track with no CODE: line, and read as prose it became a wall of words. (A ``` inside
                # a sentence isn't a fence: _FENCE needs the whole line.)
                in_code = True
                wrapper = section is None and not blocks and not stray and not ans.grounding and not ans.direct_answer
                code_lines = []
                blocks.append((section == "CODE", code_lines))
                code_lang = fence.group(1).lower() or code_lang
                continue
            if section == "CODE" and not _ends_code(line):
                # Code under CODE: with no fence around it is still code, indentation and blank lines kept, and so is
                # a line that only looks like a tag ("answer: int = 0").
                if not blocks or not blocks[-1][0] or blocks[-1][1] is not code_lines:
                    code_lines = []
                    blocks.append((True, code_lines))
                code_lines.append(line)
                continue

            if tag:
                section, value = tag.group(1).upper(), tag.group(2).strip()
                if section == "GROUNDED":
                    label = value.lower().strip(" .")
                    ans.grounding = _GROUNDING.get(label)  # type: ignore[assignment]
                    section = None  # a one-line tag: nothing continues it
                elif section == "SOURCES":
                    # Only refs the prompt actually contained count; anything else is ignored, not trusted.
                    seen: set[str] = set()
                    for n in _REF.findall(value):
                        ref = f"F{int(n)}"
                        if ref in self._facts and ref not in seen:
                            seen.add(ref)
                            ans.sources.append(self._facts[ref])
                    section = None
                elif section == "ANSWER":
                    ans.direct_answer = value
                elif section == "EXAMPLE":
                    ans.example = value or None
                elif section == "CODE":
                    code_lang = value.strip("` ").lower() or code_lang
                    code_tagged = True
                elif section == "TIME":
                    ans.time_complexity = value or None
                elif section == "SPACE":
                    ans.space_complexity = value or None
                elif section in ("INTUITION", "COMMENTARY", "DEFENSE"):
                    ans.walkthrough = ans.walkthrough or SpokenWalkthrough()
                    if section == "INTUITION":
                        ans.walkthrough.intuition = humanize(value)[:500]
                    elif section == "DEFENSE":
                        ans.walkthrough.complexity_defense = humanize(value)[:600]
                    else:
                        ans.walkthrough.commentary = [humanize(s.strip())[:400] for s in value.split("|")
                                                     if s.strip()][:3]
                    if section != "COMMENTARY" or value:
                        section = None
                elif section == "FOLLOWUP":
                    ans.follow_up = value or None
                elif section == "PROBLEM":
                    ans.problem = value[:300] or None
                    section = None
                elif section == "TRACE":
                    parts = [p.strip()[:200] for p in value.split("|") if p.strip()]
                    if len(parts) >= 2:
                        ans.trace = DryRunTrace(input=parts[0], steps=parts[1:7])
                    section = None
                elif section in ("EDGE", "TESTS"):
                    items = [p.strip(" .•-")[:200] for p in value.split("|") if p.strip(" .•-")][:MAX_LIST_ITEMS]
                    if section == "EDGE":
                        ans.edge_cases = items
                    else:
                        ans.tests = items
                    section = None
                elif section == "DESIGN":
                    if value:
                        self._design_line(ans, value)
                elif section in ("ROOTCAUSE", "FIX", "WHY"):
                    dbg = ans.debug or DebugInfo()
                    setattr(dbg, {"ROOTCAUSE": "root_cause", "FIX": "fix", "WHY": "why"}[section], value[:600] or None)
                    ans.debug = dbg
                elif section == "DIFF":
                    ans.debug = ans.debug or DebugInfo()
                elif section == "TERMS":
                    if self._done or i < last:  # only a whole line, as POINTS
                        terms = _terms(value)
                    section = None
                elif section == "POINTS":
                    # Only a whole line: a label still streaming ("Team" of "Team alignment") would be ticked off by
                    # the candidate saying one word, and the tick stuck once the full label arrived.
                    if self._done or i < last:
                        ans.key_points = [p.strip(" .•-")[:MAX_KEY_POINT_CHARS]
                                          for p in value.split("|") if p.strip(" .•-")][:MAX_KEY_POINTS]
                    section = None  # one line; nothing continues it
                continue

            if section == "DESIGN" and line.strip():
                self._design_line(ans, line.strip())
                continue
            if section in ("ROOTCAUSE", "FIX", "WHY") and line.strip() and ans.debug is not None:
                key = {"ROOTCAUSE": "root_cause", "FIX": "fix", "WHY": "why"}[section]
                setattr(ans.debug, key, f"{getattr(ans.debug, key) or ''} {line.strip()}".strip()[:600])
                continue

            bullet = _BULLET.match(line)
            if section == "COMMENTARY" and line.strip() and ans.walkthrough:
                value = bullet.group(1).strip() if bullet else line.strip()
                if len(ans.walkthrough.commentary) < 3:
                    ans.walkthrough.commentary.append(humanize(value)[:400])
                continue
            if bullet and section in (None, "ANSWER"):
                point = bullet.group(1).strip()
                if point and (self._max_points is None or len(ans.talking_points) < self._max_points):
                    ans.talking_points.append(point)
                continue

            text = line.strip()
            if not text:
                para_break = para_break or (section == "ANSWER" and bool(ans.direct_answer)) or (
                    section is None and bool(stray))
                continue
            sep = "\n\n" if para_break else " "
            para_break = False
            # continuation lines extend the current section
            if section == "ANSWER":
                ans.direct_answer = f"{ans.direct_answer}{sep}{text}".strip() if ans.direct_answer else text
            elif section == "EXAMPLE":
                ans.example = f"{ans.example or ''} {text}".strip()
            elif section == "FOLLOWUP":
                ans.follow_up = f"{ans.follow_up or ''} {text}".strip()
            elif section is None:
                stray.append(f"\n\n{text}" if sep == "\n\n" else text)

        if stray and not ans.direct_answer:
            ans.direct_answer = " ".join(stray).replace(" \n\n", "\n\n")
        ans.direct_answer = humanize(ans.direct_answer)
        # Only the jargon the answer actually says: a glossary of words the user won't say is noise.
        spoken = ans.direct_answer.lower()
        ans.terms = [t for t in terms if _says(spoken, t.term)][:MAX_TERMS]
        if ans.example:
            ans.example = humanize(ans.example)
        if (ans.grounding is None and ans.direct_answer and self._qtype in _PERSONAL
                and not any(c.startswith("resume") for c in self._context_used)):
            # Model skipped the label on a question about the user's own past with no verified facts to draw
            # on: whatever it said about "me" is illustrative.
            ans.grounding = "example"
        solution = [lines for under_code, lines in blocks if under_code] or [lines for _, lines in blocks]
        content = "\n\n".join(t for t in ("\n".join(lines).strip("\n").rstrip() for lines in solution) if t)
        if content or code_tagged:
            ans.code = CodeBlock(language=code_lang or "text", content=content)
        if diff_lines:
            ans.debug = ans.debug or DebugInfo()
            ans.debug.diff = "\n".join(diff_lines).rstrip()[:6000]
        return ans

    @staticmethod
    def _design_line(ans: LiveAnswer, line: str) -> None:
        """"Title: text" starts a known design section; anything else continues the previous one."""
        m = _DESIGN_LINE.match(line)
        title = _DESIGN_KEYS.get(m.group(1).lower().replace("-", "").replace(" ", "")) if m else None
        if m and title:
            ans.design.append(DesignSection(title=title, text=m.group(2).strip()[:800]))
        elif ans.design:
            last = ans.design[-1]
            last.text = f"{last.text} {line.lstrip('-*• ').strip()}".strip()[:800]


def _terms(value: str) -> list[Term]:
    """'CI = tests run on every push | idempotent = safe to repeat' → terms, at most a few, deduplicated."""
    out: list[Term] = []
    for entry in value.split("|"):
        parts = _TERM_SPLIT.split(entry.strip(" .•-"), maxsplit=1)
        if len(parts) != 2:
            continue
        term, meaning = parts[0].strip(" \"'*`"), parts[1].strip(" .\"'")
        if not term or not meaning or len(term) > MAX_TERM_CHARS or term.lower() in {t.term.lower() for t in out}:
            continue
        out.append(Term(term=term, meaning=meaning[:MAX_MEANING_CHARS]))
    return out[:MAX_TERMS * 2]  # filtered down to what the answer says once it's complete


def _says(spoken: str, term: str) -> bool:
    """The answer uses the term ("Kubernetes", "pods" for "pod", "CI/CD")."""
    key = term.lower()
    stem = key[:-1] if key.endswith("s") and len(key) > 3 else key
    return re.search(r"(?<![\w])" + re.escape(stem), spoken) is not None


_SENTENCE_END = re.compile(r"[.!?…][\"')\]]*(?=\s|$)")


def trim_cut_off(answer: LiveAnswer) -> LiveAnswer:
    """An answer that hit its token cap stops mid-sentence: end it at its last complete sentence instead, so the user
    never reads (or says) half a thought."""
    text = answer.direct_answer.rstrip()
    if not text or re.search(r"[.!?…][\"')\]]*$", text):
        return answer
    ends = list(_SENTENCE_END.finditer(text))
    if not ends:
        return answer
    return answer.model_copy(update={"direct_answer": text[: ends[-1].end()]})


def finalize_grounding(answer: LiveAnswer) -> LiveAnswer:
    """Brief §19: never present unsupported candidate history as real. Applied to the completed answer.
    "verified" must cite at least one verified fact (the user's own document). Citing only non-candidate sources
    (a JD requirement, a note) makes it "inferred"; citing nothing makes it "example" (unsupported). "inferred"
    with no source at all is likewise "example". Other labels pass through unchanged."""
    if answer.grounding == "verified" and not any(s.verified for s in answer.sources):
        answer.grounding = "inferred" if answer.sources else "example"
    elif answer.grounding == "inferred" and not answer.sources:
        answer.grounding = "example"
    return answer
