"""Incremental parser for the line-oriented answer format the model is asked to stream.

JSON is a poor streaming format for a live UI (nothing is renderable until keys close), so the
model emits tagged lines and fenced code; we parse deltas into a `LiveAnswer` after every chunk:

    ANSWER: one-sentence direct answer
    - talking point
    - talking point
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
    def __init__(self, question: str, qtype: QuestionType, context_used: list[str]) -> None:
        self._buf = ""
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

        for line in self._buf.split("\n"):
            fence = _FENCE.match(line)
            if fence:
                if in_code:
                    in_code = False
                else:
                    in_code = True
                    code_lang = fence.group(1) or code_lang
                continue
            if in_code:
                code_lines.append(line)
                continue

            tag = _TAG.match(line.strip())
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
                if point:
                    ans.talking_points.append(point)
                continue

            text = line.strip()
            if not text:
                continue
            # continuation lines extend the current section
            if section == "ANSWER":
                ans.direct_answer = f"{ans.direct_answer} {text}".strip()
            elif section == "EXAMPLE":
                ans.example = f"{ans.example or ''} {text}".strip()
            elif section == "FOLLOWUP":
                ans.follow_up = f"{ans.follow_up or ''} {text}".strip()
            elif section is None:
                stray.append(text)

        if stray and not ans.direct_answer:
            ans.direct_answer = " ".join(stray)
        if code_lines or code_lang:
            ans.code = CodeBlock(language=code_lang or "text", content="\n".join(code_lines).rstrip())
        return ans
