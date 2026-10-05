"""Coding questions get code. Reported: "in a coding interview it answers in English, not code snippets, and in chat
too". Three causes: code the model wrote straight after the talk track (no CODE: line) was read as prose unless the
question was typed "coding"; many coding asks were typed "technical" and the prompt never asked for code; and in chat,
"give me the code" was a new question of its own."""

import asyncio
from typing import Any

import pytest

from orbit_api.live.answer_format import AnswerStreamParser
from orbit_api.live.context_builder import PromptInputs, SessionMemory, build_prompt
from orbit_api.live.engine import TRAILER_TOKENS, LiveEngine, SessionProfile, answer_mode, is_code_request
from orbit_api.live.events import LiveSettings, QuestionType
from orbit_api.live.question_detector import classify_type, normalize
from orbit_api.live.routing import CODE_MAX_TOKENS
from orbit_api.providers.llm.base import LLMImage, LLMRequest
from orbit_api.providers.llm.mock import _CODING, MockLLMProvider
from orbit_api.providers.stt.base import TranscriptEvent
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.retrieval.index import SessionIndex
from tests.test_engine import Sink

# ---- parser: code is code wherever the model put it ----------------------------------------------------------------


def _parse(raw: str, qtype: QuestionType = QuestionType.technical) -> Any:
    return AnswerStreamParser("q", qtype, []).feed(raw)


def test_code_right_after_the_talk_track_is_code_not_prose() -> None:
    # Real DeepSeek reply to "Count the frequency of each word in a sentence in Python." (typed technical): the code
    # used to be merged into the spoken answer as one long line.
    a = _parse("GROUNDED: general\nANSWER:\nI'd use a Counter.\n\n```python\nfrom collections import Counter\n\n"
               "def word_frequency(s):\n    return Counter(s.lower().split())\n```\n\nTIME: O(n)\nPOINTS: Counter\n")
    assert a.direct_answer == "I'd use a Counter."
    assert a.code is not None and a.code.language == "python"
    assert a.code.content == ("from collections import Counter\n\ndef word_frequency(s):\n"
                              "    return Counter(s.lower().split())")
    assert a.time_complexity == "O(n)" and a.key_points == ["Counter"]


def test_code_under_a_code_line_without_a_fence_is_kept() -> None:
    a = _parse("ANSWER:\nTwo pointers.\nCODE: python\ndef rev(a):\n\n    return a[::-1]\nTIME: O(n)\n")
    assert a.code is not None and a.code.content == "def rev(a):\n\n    return a[::-1]"
    assert a.direct_answer == "Two pointers." and a.time_complexity == "O(n)"


def test_the_solution_under_code_wins_over_a_snippet_in_the_talk_track() -> None:
    a = _parse("ANSWER:\nLike this:\n```python\nx = 1\n```\nThen the full thing.\nCODE: Python\n```python\n"
               "def solve():\n    return 2\n```\nThat's linear.\nTIME: O(1)\n")
    assert a.code is not None and a.code.content == "def solve():\n    return 2" and a.code.language == "python"
    assert a.direct_answer == "Like this: Then the full thing."  # and prose after the closing fence isn't code


def test_snippets_with_no_code_section_are_all_kept() -> None:
    a = _parse("ANSWER:\nA tuple can't change.\n```python\nt = (1, 2)\n```\nA list can.\n```python\nl = [1, 2]\n```\n")
    assert a.code is not None and a.code.content == "t = (1, 2)\n\nl = [1, 2]"
    assert a.direct_answer == "A tuple can't change. A list can."


def test_a_fence_around_the_whole_reply_adds_no_empty_code_box() -> None:
    a = _parse("```text\nGROUNDED: general\nANSWER: TCP is reliable.\nPOINTS: Reliable\n```\n")
    assert a.code is None and a.direct_answer == "TCP is reliable." and a.key_points == ["Reliable"]


def test_a_code_line_shows_the_code_box_before_the_code_streams() -> None:
    a = _parse("ANSWER:\nHash map.\nCODE: python\n", QuestionType.coding)
    assert a.code is not None and a.code.language == "python" and a.code.content == ""


# ---- question types: the ways people ask for code --------------------------------------------------------------------


@pytest.mark.parametrize("text", [
    "Write a program to check if a string is a palindrome.",
    "Can you find the second largest number in a list?",
    "How do you detect a cycle in a directed graph?",
    "Fibonacci with dynamic programming.",
    "Merge two sorted lists into one sorted list.",
    "Check whether a number is prime.",
    "Count the frequency of each word in a sentence.",
    "Solve the valid parentheses problem.",
    "Give me the code for binary search.",
    "How would you do a BFS on this grid?",
    "Reverse the words in a sentence.",
    "Return the top k frequent elements.",
    "Can you code it up?",
])
def test_coding_asks_are_coding(text: str) -> None:
    assert classify_type(normalize(text)) is QuestionType.coding


@pytest.mark.parametrize("text", [
    "How do you enforce code formatting across the team?",
    "Have you tried pair programming?",
    "What's your tech stack?",
    "When would you use a graph database?",
    "How do you secure a GraphQL API?",
    "What are your top KPIs for an AppSec program?",
    "What sort of team do you work best in?",
    "How did you split the work between the teams?",
    "How do you check the quality of a pull request?",
    "How would you design a URL shortener?",
    "Tell me about a time you had to find duplicates in a messy dataset.",
])
def test_look_alikes_are_not_coding(text: str) -> None:
    assert classify_type(normalize(text)) is not QuestionType.coding


@pytest.mark.parametrize("text", ["give me the code", "Code it", "now in Java", "What about C++?", "code?",
                                  "Can you write it in Python please", "show me in code", "in go"])
def test_bare_code_asks_in_chat(text: str) -> None:
    assert is_code_request(text)


@pytest.mark.parametrize("text", ["Write code for binary search", "Make it shorter", "Explain the code",
                                  "What's a function?", "Why Java?", ""])
def test_chat_messages_that_are_not_bare_code_asks(text: str) -> None:
    assert not is_code_request(text)


# ---- the prompt asks for code ----------------------------------------------------------------------------------------


def _user_prompt(qtype: QuestionType, mode: str = "normal", session_type: str = "interview") -> str:
    inputs = PromptInputs("Reverse a linked list", qtype, False, session_type, None, "standard",  # type: ignore[arg-type]
                          "natural", "en", mode=mode)
    return build_prompt(SessionIndex([]), inputs, SessionMemory()).messages[1].content


def test_coding_answers_must_include_the_code() -> None:
    assert "CODING ANSWER" in _user_prompt(QuestionType.coding)
    assert "CODING ANSWER" not in _user_prompt(QuestionType.technical)
    assert "CODING ANSWER" not in _user_prompt(QuestionType.coding, mode="debug")  # debug has its own format
    assert "working code" in _user_prompt(QuestionType.coding, session_type="coding")


def test_technical_questions_let_the_model_switch_to_code() -> None:
    # A coding ask the detector missed in a normal interview: the model reads the conversation and decides.
    for qtype in (QuestionType.technical, QuestionType.follow_up):
        assert "If answering this properly means writing code" in _user_prompt(qtype)
    for qtype in (QuestionType.behavioral, QuestionType.coding):
        assert "If answering this properly means writing code" not in _user_prompt(qtype)


@pytest.mark.parametrize("mode", ["debug_if_error", "screenshot"])
def test_screenshots_decide_from_the_image_whether_to_write_code(mode: str) -> None:
    prompt = _user_prompt(QuestionType.technical, mode=mode)
    assert "SCREENSHOT: first work out what the image shows" in prompt and "CODE: <language>" in prompt
    assert "If answering this properly" not in prompt and "CODING ANSWER" not in prompt


def test_screenshots_use_the_screenshot_format_in_every_session_and_plan() -> None:
    every = frozenset({"system_design", "advanced_coding"})
    for qtype, is_code in ((QuestionType.technical, False), (QuestionType.coding, True)):
        assert answer_mode(qtype, "x", "screenshot", is_code, every) == "debug_if_error"
        assert answer_mode(qtype, "x", "screenshot", is_code, frozenset()) == "screenshot"


# ---- the engine: coding interviews and chat --------------------------------------------------------------------------


class CodeLLM(MockLLMProvider):
    """Always answers with code, whatever the question."""

    def _response_for(self, request: LLMRequest) -> str:
        return _CODING


def _engine(llm: MockLLMProvider, session_type: str = "interview") -> tuple[LiveEngine, Sink]:
    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", session_type, "Engineer", "en", "en", dev_mode=True),  # type: ignore[arg-type]
                     LiveSettings(response_timing="quick"), send=sink, llm=llm, stt=MockSTTProvider(),
                     index=SessionIndex([]))
    return eng, sink


async def _ask(eng: LiveEngine, text: str) -> None:
    await eng.on_transcript("system", TranscriptEvent("final", text, 0, 100, endpoint=True))


def _prompts(llm: MockLLMProvider) -> list[str]:
    return [r.messages[1].content for r in llm.requests if r.request_type in ("answer", "chat")]


async def test_a_technical_question_in_a_coding_interview_is_answered_with_code() -> None:
    llm = MockLLMProvider()
    eng, sink = _engine(llm, "coding")
    await eng.start()
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.completed")
    assert "Question type: coding" in _prompts(llm)[-1] and "CODING ANSWER" in _prompts(llm)[-1]
    assert sink.of("answer.completed")[0]["answer"]["type"] == "coding"
    await eng.end()


async def test_a_technical_question_in_an_interview_stays_technical() -> None:
    llm = MockLLMProvider()
    eng, sink = _engine(llm)
    await eng.start()
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.completed")
    assert "Question type: technical" in _prompts(llm)[-1] and "CODING ANSWER" not in _prompts(llm)[-1]
    await eng.end()


async def test_give_me_the_code_in_chat_redoes_the_last_question_as_code() -> None:
    llm = MockLLMProvider()
    eng, sink = _engine(llm)
    await eng.start()
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.completed")
    await eng.handle_client({"type": "chat.message", "data": {"text": "now give me the code in Java"}})
    await sink.wait_for("answer.completed", n=2)
    prompt = _prompts(llm)[-1]
    assert "Question type: coding" in prompt and "CODING ANSWER" in prompt
    assert "QUESTION: What is dependency injection?" in prompt and "now give me the code in Java" in prompt
    assert eng.memory.questions == ["What is dependency injection?"]  # a rewrite, not a new question
    await eng.end()


async def test_rewriting_an_answer_that_had_code_keeps_the_code() -> None:
    llm = CodeLLM()
    eng, sink = _engine(llm)
    await eng.start()
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.completed")
    assert sink.of("answer.completed")[0]["answer"]["code"]["content"].startswith("def two_sum")
    await eng.handle_client({"type": "chat.message", "data": {"text": "Make it shorter"}})
    await sink.wait_for("answer.completed", n=2)
    assert "Question type: coding" in _prompts(llm)[-1]
    await eng.end()


@pytest.mark.parametrize("session_type", ["interview", "coding"])
async def test_follow_ups_to_an_answer_with_code_stay_code(session_type: str) -> None:
    eng, _ = _engine(MockLLMProvider(), session_type)
    eng.memory.questions.append("Reverse a linked list.")
    assert eng._answer_type(QuestionType.follow_up) is QuestionType.follow_up  # the last answer had no code
    eng._coded_question = "Reverse a linked list."
    assert eng._answer_type(QuestionType.follow_up) is QuestionType.coding
    assert eng._answer_type(QuestionType.behavioral) is QuestionType.behavioral
    technical = QuestionType.coding if session_type == "coding" else QuestionType.technical
    assert eng._answer_type(QuestionType.technical) is technical
    await asyncio.sleep(0)


async def test_technical_answers_have_room_for_code_in_a_normal_interview() -> None:
    llm = MockLLMProvider()
    eng, sink = _engine(llm)
    await eng.start()
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.completed")
    assert llm.requests[-1].max_tokens == CODE_MAX_TOKENS + TRAILER_TOKENS
    await eng.end()


@pytest.mark.parametrize("session_type", ["interview", "meeting", "coding"])
async def test_a_screenshot_can_be_answered_with_code_in_any_session(session_type: str) -> None:
    llm = MockLLMProvider()
    eng, sink = _engine(llm, session_type)
    await eng.start()
    await eng.answer_screenshot(LLMImage(b"png"))
    await sink.wait_for("answer.completed")
    shot = llm.requests[-1]
    assert shot.images and shot.max_tokens == CODE_MAX_TOKENS + TRAILER_TOKENS
    assert "SCREENSHOT: first work out what the image shows" in shot.messages[1].content
    assert sink.of("answer.completed")[0]["answer"]["code"]["content"].startswith("def two_sum")
    await eng.end()
