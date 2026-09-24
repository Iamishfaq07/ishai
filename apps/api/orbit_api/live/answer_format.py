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

from orbit_api.live.events import CodeBlock, LiveAnswer, QuestionType

_TAG = re.compile(r"^(ANSWER|EXAMPLE|CODE|TIME|SPACE|FOLLOWUP)\s*:\s*(.*)$", re.IGNORECASE)
_BULLET = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+(.*)$")
_FENCE = re.compile(r"^\s*```\s*([\w+#-]*)\s*$")


class AnswerStreamParser:
    def __init__(self, question: str, qtype: QuestionType, context_used: list[str], *,
                 max_points: int | None = None) -> None:
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
        stray: list[str] = []
        para_break = False  # a blank line inside the spoken answer starts a new paragraph

        for line in self._buf.split("\n"):
            tag = _TAG.match(line.strip())
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
                if section == "ANSWER":
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
        if code_lines or code_lang:
            ans.code = CodeBlock(language=code_lang or "text", content="\n".join(code_lines).rstrip())
        return ans
