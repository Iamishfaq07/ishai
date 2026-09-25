"""System design mode (brief §30) and debug mode (§29): parsing, mode choice, plan gating, prompt wiring."""

from orbit_api.live.answer_format import AnswerStreamParser
from orbit_api.live.context_builder import PromptInputs, SessionMemory, build_prompt
from orbit_api.live.engine import answer_mode
from orbit_api.live.events import QuestionType
from orbit_api.retrieval.index import SessionIndex

ALL = frozenset({"system_design", "advanced_coding"})

DESIGN_REPLY = """GROUNDED: general
ANSWER:
I'd start with the requirements.
DESIGN:
Requirements: shorten URLs, redirect fast
Scale: 100M links, 10k rps
- Data model: code -> url
  with created_at
Unknown heading: ignored as a new section, joins the previous
Trade-offs: base62 vs hashing
FOLLOWUP: How would you add analytics?
POINTS: a | b
"""

DEBUG_REPLY = """GROUNDED: general
ANSWER:
It's an off-by-one.
ROOTCAUSE: range(len(a)+1) reads past the end
FIX: use range(len(a))
WHY: indices stop at len(a)-1
DIFF:
```diff
-for i in range(len(a)+1):
+for i in range(len(a)):
```
CODE: python
```python
for i in range(len(a)):
    print(a[i])
```
TIME: O(n)
POINTS: x
"""


def _parse(reply: str, qtype: QuestionType):  # type: ignore[no-untyped-def]
    p = AnswerStreamParser("q", qtype, [])
    p.feed(reply)
    return p.snapshot()


def test_design_sections_parse_in_order_with_continuations() -> None:
    a = _parse(DESIGN_REPLY, QuestionType.system_design)
    assert [d.title for d in a.design] == ["Requirements", "Scale", "Data model", "Trade-offs"]
    assert a.design[2].text.startswith("code -> url with created_at")
    assert "Unknown heading" in a.design[2].text  # an unknown title continues the previous section
    assert a.follow_up == "How would you add analytics?" and a.key_points == ["a", "b"]
    assert a.direct_answer == "I'd start with the requirements."


def test_design_parses_while_streaming() -> None:
    p = AnswerStreamParser("q", QuestionType.system_design, [])
    p.feed(DESIGN_REPLY[: DESIGN_REPLY.index("Scale:")])
    assert [d.title for d in p.snapshot().design] == ["Requirements"]


def test_debug_fields_diff_and_corrected_code() -> None:
    a = _parse(DEBUG_REPLY, QuestionType.coding)
    assert a.debug is not None
    assert a.debug.root_cause == "range(len(a)+1) reads past the end" and a.debug.fix == "use range(len(a))"
    assert a.debug.why == "indices stop at len(a)-1"
    assert a.debug.diff == "-for i in range(len(a)+1):\n+for i in range(len(a)):"
    assert a.code is not None and a.code.content.startswith("for i in range(len(a)):")  # not the diff
    assert a.time_complexity == "O(n)"


def test_normal_coding_answer_has_no_debug_or_design() -> None:
    a = _parse("ANSWER:\nIterate.\nCODE: python\n```python\nx = 1\n```\nPOINTS: a\n", QuestionType.coding)
    assert a.debug is None and a.design == []


def test_mode_choice_and_plan_gating() -> None:
    assert answer_mode(QuestionType.system_design, "Design Twitter", "auto", False, ALL) == "design"
    assert answer_mode(QuestionType.system_design, "Design Twitter", "auto", False, frozenset()) == "normal"
    bug = "My code throws a KeyError, can you fix this?"
    assert answer_mode(QuestionType.coding, bug, "manual", True, ALL) == "debug"
    assert answer_mode(QuestionType.coding, bug, "manual", True, frozenset({"system_design"})) == "normal"
    assert answer_mode(QuestionType.coding, "Reverse a linked list", "auto", True, ALL) == "normal"
    assert answer_mode(QuestionType.coding, "anything", "screenshot", True, ALL) == "debug_if_error"
    assert answer_mode(QuestionType.behavioral, "Tell me about a bug you fixed", "auto", False, ALL) == "normal"
    # bug reports the classifier calls "technical" still get debug mode when there's code context
    for q in ("Why does my code throw a KeyError?", "This test is failing, can you fix it?",
              "def f(a): for i in range(len(a)+1): print(a[i]) raises IndexError", "Here's a stack trace, what broke?"):
        assert answer_mode(QuestionType.technical, q, "chat", False, ALL) == "debug", q
    for q in ("What is an exception in Java?", "How do you debug distributed systems in general?",
              "What causes memory errors?"):
        assert answer_mode(QuestionType.technical, q, "chat", False, ALL) == "normal", q


def test_prompt_carries_the_mode_instruction() -> None:
    def prompt(mode: str) -> str:
        inputs = PromptInputs(question="q", qtype=QuestionType.system_design, is_follow_up=False,
                              session_type="interview", role=None, length="standard", style="natural",
                              answer_language="en", mode=mode)
        return build_prompt(SessionIndex([]), inputs, SessionMemory()).messages[-1].content

    assert "SYSTEM DESIGN MODE" in prompt("design") and "Trade-offs" in prompt("design")
    assert "DEBUG MODE" in prompt("debug") and "```diff" in prompt("debug")
    assert "MODE" not in prompt("normal")
