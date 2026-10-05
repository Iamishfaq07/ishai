"""Fixes from an audit of the live answer engine: each test is a scenario that went wrong before (the audit's repro
scripts, shortened)."""

import asyncio
from typing import Any

import pytest

from orbit_api.live.answer_format import AnswerStreamParser
from orbit_api.live.dedup import DedupDecision, Deduplicator
from orbit_api.live.engine import (
    SCREENSHOT_LABEL,
    LiveEngine,
    SessionProfile,
    answer_mode,
    is_rewrite_request,
)
from orbit_api.live.events import LiveSettings, QuestionType
from orbit_api.live.finalizer import QuestionFinalizer, answer_words
from orbit_api.live.mock_interviewer import TRAILING_OFF_MS, answer_silence_ms
from orbit_api.live.question_detector import detect
from orbit_api.providers.llm.base import LLMImage
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.providers.stt.base import TranscriptEvent
from orbit_api.providers.stt.mock import MockSTTProvider
from orbit_api.retrieval.index import SessionIndex
from tests.test_engine import Sink

ALL = frozenset({"system_design", "advanced_coding"})


def _engine(llm: MockLLMProvider | None = None, *, timing: str = "quick", session_type: str = "interview",
            clock: Any = None) -> tuple[LiveEngine, Sink, MockLLMProvider]:
    llm = llm or MockLLMProvider()
    sink = Sink()
    eng = LiveEngine(SessionProfile("s1", session_type, "Engineer", "en", "en", dev_mode=True),  # type: ignore[arg-type]
                     LiveSettings(response_timing=timing), send=sink, llm=llm,  # type: ignore[arg-type]
                     stt=MockSTTProvider(), index=SessionIndex([]), **({"clock": clock} if clock else {}))
    return eng, sink, llm


async def _ask(eng: LiveEngine, text: str, channel: str = "system") -> None:
    await eng.on_transcript(channel, TranscriptEvent("final", text, 0, 100, endpoint=True))  # type: ignore[arg-type]


def _answers(llm: MockLLMProvider) -> list[str]:
    return [r.messages[1].content for r in llm.requests if r.request_type in ("answer", "chat", "vision")]


# ---- code that looks like a tag stays code ---------------------------------------------------------------------------


@pytest.mark.parametrize(("code", "talk"), [
    ('def is_palindrome(s):\n    """Two pointers.\n\n    Example:\n        is_palindrome("aba")\n'
     '    Time: O(n)\n    """\n    return s == s[::-1]', "I'd use two pointers."),
    ("def best(nums):\n    answer: int = nums[0]\n    return answer", "Kadane's algorithm."),
    ("interface ApiError {\n  code: string;\n  message: string;\n}", "Model the response type."),
    ("const stats = {\n  count: 0,\n  time: 0,\n};", "Track the stats in an object."),
])
def test_lines_that_look_like_tags_inside_code_are_code(code: str, talk: str) -> None:
    raw = f"GROUNDED: general\nANSWER: {talk}\nCODE: python\n```python\n{code}\n```\nTIME: O(n)\nPOINTS: a | b\n"
    a = AnswerStreamParser("q", QuestionType.coding, []).feed(raw)
    assert a.code is not None and a.code.content == code
    assert a.direct_answer == talk and a.time_complexity == "O(n)" and a.example is None


def test_a_missing_closing_fence_still_ends_at_the_trailer() -> None:
    a = AnswerStreamParser("q", QuestionType.coding, []).feed(
        "ANSWER: Hash map.\nCODE: python\n```python\ndef f():\n    return 1\nTIME: O(n)\nSPACE: O(1)\n")
    assert a.code is not None and a.code.content == "def f():\n    return 1"
    assert a.time_complexity == "O(n)" and a.space_complexity == "O(1)"


# ---- pause ---------------------------------------------------------------------------------------------------------


async def test_an_answer_finishing_while_paused_keeps_the_session_paused() -> None:
    eng, sink, _ = _engine(MockLLMProvider(chunk_delay_s=0.02))
    await eng.start()
    await _ask(eng, "What is dependency injection?")
    await sink.wait_for("answer.chunk")
    await eng.handle_client({"type": "session.pause", "data": {}})
    await sink.wait_for("answer.completed")
    states = [e["data"]["state"] for e in sink.events if e["type"] == "state.changed"]
    assert states[-1] == "paused" and eng.state.value == "paused"
    await eng.handle_client({"type": "session.resume", "data": {}})
    assert eng.state.value == "listening"
    await eng.end()


async def test_a_question_held_when_pausing_is_not_answered_on_resume() -> None:
    now = {"t": 0.0}
    eng, sink, _ = _engine(timing="balanced", clock=lambda: now["t"])
    await eng.start()
    await _ask(eng, "What is dependency injection?")
    now["t"] += 0.3
    await asyncio.sleep(0.1)
    await eng.handle_client({"type": "session.pause", "data": {}})
    now["t"] += 600
    await asyncio.sleep(0.2)
    await eng.handle_client({"type": "session.resume", "data": {}})
    await asyncio.sleep(0.3)
    assert sink.of("question.detected") == [] and sink.of("answer.started") == []
    await eng.end()


# ---- chat: rewrites vs new questions ------------------------------------------------------------------------------


@pytest.mark.parametrize("text", ["Make it shorter", "again", "Rewrite it in STAR format", "What should I say?",
                                  "make it more technical and mention Kafka", "Can you expand on the second point?",
                                  "give an example"])
def test_rewrites(text: str) -> None:
    assert is_rewrite_request(text)


@pytest.mark.parametrize("text", ["How do you protect against SQL injection?", "What makes a good code review?",
                                  "Give an example of polymorphism in Java", "Is Kafka still relevant in startups?",
                                  "make a REST API idempotent - how?", "Explain it more simply"])
def test_questions_that_merely_contain_a_rewrite_word(text: str) -> None:
    assert not is_rewrite_request(text)


async def test_a_chat_question_is_answered_as_itself_not_as_a_rewrite() -> None:
    eng, sink, llm = _engine()
    await eng.start()
    await _ask(eng, "Tell me about a time you disagreed with your manager.")
    await sink.wait_for("answer.completed")
    await eng.handle_client({"type": "chat.message", "data": {"text": "How do you protect against SQL injection?"}})
    await sink.wait_for("answer.completed", n=2)
    assert "QUESTION: How do you protect against SQL injection?" in _answers(llm)[-1]
    assert eng.memory.questions[-1] == "How do you protect against SQL injection?"
    await eng.end()


# ---- memory keeps an answer that was cut off ---------------------------------------------------------------------


async def test_an_answer_cut_off_by_the_next_question_is_still_its_previous_answer() -> None:
    eng, sink, llm = _engine(MockLLMProvider(chunk_delay_s=0.03))
    await eng.start()
    await _ask(eng, "Tell me about your Kafka migration at Acme.")
    await sink.wait_for("answer.chunk", n=3)
    # the candidate is saying it, and the interviewer cuts in with a follow-up
    await _ask(eng, "So at Acme we moved our payment events over to Kafka.", channel="mic")
    await _ask(eng, "And what was the throughput?")
    await sink.wait_for("answer.completed")
    assert [c["reason"] for c in sink.of("answer.cancelled")] == ["superseded"]
    assert eng.memory.questions == ["Tell me about your Kafka migration at Acme.", "And what was the throughput?"]
    # the follow-up's prompt shows the (cut-off) Kafka answer as the previous answer
    previous = _answers(llm)[-1].split('source="previous_answer"')[1]
    assert previous.lstrip(">\n").startswith("[mock")
    await eng.end()


# ---- the interviewer's add-ons and the candidate's backchannels ------------------------------------------------------


@pytest.mark.parametrize("add_on", ["Take your time, no rush.", "Feel free to think out loud.", "Take your time."])
def test_a_reassurance_after_the_question_does_not_restart_the_answer(add_on: str) -> None:
    f = QuestionFinalizer(provider_endpoints=True, grace_ms=0)
    assert f.on_transcript("t1", "How would you design a rate limiter?", 0, is_final=True, endpoint=True)
    f.on_transcript("t2", add_on, 2000, is_final=True, endpoint=True)
    assert not any(f.tick(t) for t in range(2000, 5000, 50))


def test_a_reassurance_that_also_asks_is_a_question() -> None:
    assert detect("Take your time and walk me through how you'd design it.", "interviewer").should_generate


@pytest.mark.parametrize(("speech", "words"), [("Okay, got it.", 0), ("Um, uh, okay", 0), ("Yeah, yeah, yeah", 0),
                                               ("Right, okay, sure.", 0), ("Yeah, that makes sense.", 0),
                                               ("So I would start with a hash map", 7)])
def test_backchannels_are_not_the_start_of_an_answer(speech: str, words: int) -> None:
    assert len(answer_words(speech)) == words


# ---- debug mode needs code ----------------------------------------------------------------------------------------


@pytest.mark.parametrize(("qtype", "question"), [
    (QuestionType.behavioral, "Tell me about a time you failed."),
    (QuestionType.coding, "Write a function that retries failed HTTP requests with exponential backoff."),
    (QuestionType.coding, "How do you detect a cycle in a linked list without crashing on an empty list?"),
    (QuestionType.coding, "What's the difference between an error and an exception in Java?"),
])
def test_bug_words_alone_are_not_a_bug_to_fix(qtype: QuestionType, question: str) -> None:
    assert answer_mode(qtype, question, "auto", True, ALL) == "normal"


# ---- screenshots asked about again ------------------------------------------------------------------------------


async def test_retrying_or_rewriting_a_screenshot_answer_sends_the_screenshot_again() -> None:
    eng, sink, llm = _engine()
    await eng.start()
    await eng.answer_screenshot(LLMImage(b"png"))
    await sink.wait_for("answer.completed")
    await eng.handle_client({"type": "answer.request", "data": {"question_text": SCREENSHOT_LABEL}})
    await sink.wait_for("answer.completed", n=2)
    await eng.handle_client({"type": "chat.message", "data": {"text": "now in Java"}})
    await sink.wait_for("answer.completed", n=3)
    shots = [r for r in llm.requests if r.request_type in ("vision", "chat", "answer")]
    assert [len(r.images) for r in shots] == [1, 1, 1]
    await eng.end()


async def test_a_screenshot_too_old_to_ask_about_says_so() -> None:
    now = {"t": 0.0}
    eng, sink, llm = _engine(clock=lambda: now["t"])
    await eng.start()
    await eng.answer_screenshot(LLMImage(b"png"))
    await sink.wait_for("answer.completed")
    now["t"] += 3600
    await eng.handle_client({"type": "answer.request", "data": {"question_text": SCREENSHOT_LABEL}})
    assert sink.of("error")[-1]["code"] == "screenshot_expired" and len(llm.requests) == 1
    await eng.end()


# ---- manual "Answer" --------------------------------------------------------------------------------------------


async def test_answer_after_the_candidate_started_talking_gets_the_whole_question() -> None:
    eng, sink, _ = _engine(timing="balanced")
    eng.settings.auto_answer = False
    await eng.start()
    await _ask(eng, "Walk me through how you'd build an image classification pipeline.")
    await asyncio.sleep(0.05)
    await _ask(eng, "Start with data, then preprocessing.")
    await asyncio.sleep(0.05)
    await _ask(eng, "Okay, let me think about that for a second.", channel="mic")
    await asyncio.sleep(0.2)
    await eng.handle_client({"type": "answer.request", "data": {}})
    await sink.wait_for("answer.completed")
    assert sink.of("question.detected")[-1]["text"] == (
        "Walk me through how you'd build an image classification pipeline. Start with data, then preprocessing.")
    await eng.end()


async def test_answer_during_the_wait_is_one_question_and_one_answer() -> None:
    eng, sink, llm = _engine(timing="balanced")
    await eng.start()
    await _ask(eng, "Okay, great. What is dependency injection?")
    await asyncio.sleep(0.4)
    await eng.handle_client({"type": "answer.request", "data": {}})
    await sink.wait_for("answer.completed")
    await asyncio.sleep(1.6)  # past the wait: the auto-answer must not fire it again
    assert [q["text"] for q in sink.of("question.detected")] == ["What is dependency injection?"]
    assert sink.of("answer.cancelled") == [] and len([r for r in llm.requests if r.request_type == "answer"]) == 1
    await eng.end()


# ---- dedup ------------------------------------------------------------------------------------------------------


def test_a_different_follow_up_with_most_of_the_same_words_is_not_a_duplicate() -> None:
    d = Deduplicator()
    d.record("q1", "t1", "What's the time complexity of this approach in the worst case?", 0)
    assert d.check("t2", "What's the space complexity of this approach in the worst case?", 1000)[0] == \
        DedupDecision.new
    assert d.check("t3", "So what's the time complexity of this approach in the worst case?", 2000)[0] == \
        DedupDecision.duplicate  # only a filler word differs


# ---- check-ins ------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("text", ["Does that make sense?", "Is my audio okay?", "Are you still there?",
                                  "Can you see the document I shared?", "Do you need a minute?", "Shall we move on?",
                                  "Did I lose you?", "Are you able to see my screen?"])
def test_check_ins_are_not_answered(text: str) -> None:
    assert not detect(text, "interviewer").should_generate


@pytest.mark.parametrize("text", ["Can you see the problem with this code?",
                                  "Does that make sense, and how would you test it?", "Are you familiar with Kafka?"])
def test_questions_that_start_like_a_check_in_are(text: str) -> None:
    assert detect(text, "interviewer").should_generate


# ---- end() and start() ------------------------------------------------------------------------------------------


async def test_end_during_start_leaves_no_transcription_running() -> None:
    stt = MockSTTProvider()
    eng = LiveEngine(SessionProfile("s1", "interview", "Engineer", "en", "en", dev_mode=True), LiveSettings(),
                     send=Sink(), llm=MockLLMProvider(), stt=stt, index=SessionIndex([]))
    original = stt.start

    async def slow_start(config: Any) -> Any:
        await asyncio.sleep(0.2)
        return await original(config)

    stt.start = slow_start  # type: ignore[method-assign]
    starting = asyncio.ensure_future(eng.start())
    await asyncio.sleep(0.05)
    await eng.end()
    await starting
    assert stt._sessions == [] and not any(not t.done() for t in eng._tasks)


# ---- the mock interviewer waits for a thought to finish ---------------------------------------------------------


def test_the_mock_interviewer_does_not_cut_in_mid_sentence() -> None:
    assert answer_silence_ms("and that's why I picked Kafka over RabbitMQ, because the") == TRAILING_OFF_MS


# ---- phone mode: one mic, two voices ------------------------------------------------------------------------------


def _mic(kind: str, text: str, voice: int, *, endpoint: bool = False) -> TranscriptEvent:
    return TranscriptEvent(kind, text, 0, 100, endpoint=endpoint, speaker_hint=voice)  # type: ignore[arg-type]


async def test_phone_mode_trusts_the_final_speaker_not_the_interim_one() -> None:
    # Real Deepgram on one mic: interim results gave the candidate's first words the interviewer's number (0); the
    # final corrected it (1). The turn kept the interim's voice, so the candidate's answer became "interviewer".
    eng, sink, _ = _engine(session_type="phone")
    await eng.start()
    await eng.on_transcript("mic", _mic("final", "Can you hear me okay?", 0, endpoint=True))
    await eng.on_transcript("mic", _mic("partial", "Yes. I can hear", 0))
    await eng.on_transcript("mic", _mic("final", "Yes. I can hear you fine.", 1, endpoint=True))
    finals = [(t["speaker"], t["text"]) for t in sink.of("transcript.final")]
    assert finals == [("interviewer", "Can you hear me okay?"), ("candidate", "Yes. I can hear you fine.")]
    await eng.end()


async def test_phone_mode_a_change_of_voice_inside_a_turn_splits_it() -> None:
    eng, sink, _ = _engine(session_type="phone")
    await eng.start()
    await eng.on_transcript("mic", _mic("final", "What is dependency injection?", 0, endpoint=True))
    await eng.on_transcript("mic", _mic("final", "Okay.", 0))
    await eng.on_transcript("mic", _mic("final", "So you pass the dependencies in.", 1, endpoint=True))
    finals = [(t["speaker"], t["text"]) for t in sink.of("transcript.final")]
    assert finals[-2:] == [("interviewer", "Okay."), ("candidate", "So you pass the dependencies in.")]
    await eng.end()


async def test_an_utterance_end_before_the_final_does_not_say_the_words_twice() -> None:
    # "Write a" (still interim) when UtteranceEnd came, then the final for the whole sentence: committed at the
    # UtteranceEnd, the final was a new turn and the question read "Write a Write a function…".
    eng, sink, _ = _engine()
    await eng.start()
    await eng.on_transcript("system", TranscriptEvent("partial", "Write a", 0, 100))
    await eng.on_transcript("system", TranscriptEvent("utterance_end", "", 0, 100, endpoint=True))
    await eng.on_transcript("system", TranscriptEvent("final", "Write a function that reverses a linked list.", 0, 900))
    await sink.wait_for("question.detected")
    assert [t["text"] for t in sink.of("transcript.final")] == ["Write a function that reverses a linked list."]
    assert sink.of("question.detected")[0]["text"] == "Write a function that reverses a linked list."
    await eng.end()


async def test_an_utterance_end_whose_final_never_comes_still_commits_the_turn() -> None:
    eng, sink, _ = _engine()
    await eng.start()
    await eng.on_transcript("system", TranscriptEvent("partial", "Right, okay", 0, 100))
    await eng.on_transcript("system", TranscriptEvent("utterance_end", "", 0, 100, endpoint=True))
    await sink.wait_for("transcript.final", timeout=3.0)
    assert sink.of("transcript.final")[0]["text"] == "Right, okay"
    await eng.end()
