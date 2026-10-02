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
    FOLLOWUP: likely next question

Unknown/untagged prose before any tag is treated as the direct answer so a model that ignores the
format still produces something readable.
"""

import re
from collections.abc import Callable

from orbit_api.live.events import CodeBlock, DebugInfo, DesignSection, FactSource, LiveAnswer, QuestionType

# System design sections, in the order the prompt asks for them (keys are matched case-insensitively).
DESIGN_TITLES = ("Requirements", "Assumptions", "Scale", "APIs", "Data model", "Architecture", "Storage", "Caching",
                 "Queues", "Reliability", "Security", "Trade-offs")
_DESIGN_KEYS = {t.lower().replace("-", "").replace(" ", ""): t for t in DESIGN_TITLES}
_DESIGN_LINE = re.compile(r"^\s*(?:[-*•]\s*)?([A-Za-z][A-Za-z -]{1,20}?)\s*:\s*(.+)$")

_TAG = re.compile(r"^(GROUNDED|PROBLEM|ANSWER|EXAMPLE|CODE|TIME|SPACE|EDGE|TESTS|FOLLOWUP|SOURCES|POINTS|DESIGN|"
                  r"ROOTCAUSE|FIX|WHY|DIFF)\s*:\s*(.*)$",
                  re.IGNORECASE)
MAX_LIST_ITEMS = 8
MAX_KEY_POINTS = 6
MAX_KEY_POINT_CHARS = 60
# The model's own label for its personal claims (see live_system.md): only "example" is surfaced to the user.
_GROUNDING = {"verified": "verified", "inferred": "inferred", "example": "example", "general": "general",
              "unsupported": "example"}
_REF = re.compile(r"\bF(\d{1,2})\b", re.IGNORECASE)
_PERSONAL = frozenset({QuestionType.behavioral, QuestionType.resume, QuestionType.leadership, QuestionType.culture})
_BULLET = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.*)$")
_FENCE = re.compile(r"^\s*```\s*([\w+#-]*)\s*$")

# The spoken answer is read out by a person, and a few marks of machine writing give it away whatever the prompt
# says (live_system.md, "HOW IT SOUNDS"). These are the safe, mechanical ones: an em dash (or a spaced en dash) is
# said as a pause, so it becomes a comma; an opening "Great question." goes; a handful of stiff words become the
# plain ones. Only whole words change, so a word still streaming in isn't touched until it's complete.
_DASH = re.compile(r"\s*(?:—|(?<=\s)–(?=\s))\s*")
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

    def feed(self, delta: str) -> LiveAnswer:
        self._buf += delta
        return self.snapshot()

    @property
    def raw(self) -> str:
        return self._buf

    def snapshot(self) -> LiveAnswer:
        ans = LiveAnswer(question=self._question, type=self._qtype, context_used=list(self._context_used))
        section: str | None = None
        in_code = False
        code_lang = ""
        code_lines: list[str] = []
        in_diff = False
        diff_lines: list[str] = []
        stray: list[str] = []
        para_break = False  # a blank line inside the spoken answer starts a new paragraph

        for line in self._buf.split("\n"):
            tag = _TAG.match(line.strip())
            if in_diff:
                if tag or _FENCE.match(line):
                    in_diff = False
                    if not tag:
                        continue
                else:
                    diff_lines.append(line)
                    continue
            if section == "DIFF" and _FENCE.match(line) and not in_code:
                in_diff = True
                continue
            if in_code:
                # A real tag line (TIME/SPACE/FOLLOWUP/…) ends the code block even if the model's closing
                # fence is missing or mismatched — otherwise trailing sections would be swallowed as code.
                if tag:
                    in_code = False
                elif _FENCE.match(line):
                    in_code = False
                    continue
                else:
                    code_lines.append(line)
                    continue
            elif _FENCE.match(line):
                fence = _FENCE.match(line)
                assert fence is not None
                # Only a fence inside a CODE section (or a coding question) opens a code block — a stray ```
                # in EXAMPLE prose must not be mistaken for code.
                if section == "CODE" or self._qtype == QuestionType.coding:
                    in_code = True
                    code_lang = fence.group(1) or code_lang
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
                    code_lang = value.lower() or code_lang
                elif section == "TIME":
                    ans.time_complexity = value or None
                elif section == "SPACE":
                    ans.space_complexity = value or None
                elif section == "FOLLOWUP":
                    ans.follow_up = value or None
                elif section == "PROBLEM":
                    ans.problem = value[:300] or None
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
                elif section == "POINTS":
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
        if ans.example:
            ans.example = humanize(ans.example)
        if (ans.grounding is None and ans.direct_answer and self._qtype in _PERSONAL
                and not any(c.startswith("resume") for c in self._context_used)):
            # Model skipped the label on a question about the user's own past with no verified facts to draw
            # on: whatever it said about "me" is illustrative.
            ans.grounding = "example"
        if code_lines or code_lang:
            ans.code = CodeBlock(language=code_lang or "text", content="\n".join(code_lines).rstrip())
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
