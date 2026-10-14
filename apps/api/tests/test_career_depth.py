import json
from typing import Any

import pytest

from orbit_api.live.answer_format import AnswerStreamParser
from orbit_api.live.events import QuestionType
from orbit_api.live.mock_interviewer import MockConfig, MockInterviewer
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.retrieval.index import SessionIndex


@pytest.mark.parametrize("score, expected", [(5, 4), (4, 4), (3, 3), (2, 2), (1, 2), (None, 3), (True, 3)])
async def test_depth_changes_only_for_a_real_bounded_assessment(score: Any, expected: int) -> None:
    async def noop(*args: Any) -> None:
        pass
    llm = MockLLMProvider(script=[json.dumps({"question": "How do you handle concurrent writes?",
                                              "is_follow_up": True, "last_answer_score": score})])
    interviewer = MockInterviewer(MockConfig(tech_stack=["Go", "Kafka"]), llm=llm, index=SessionIndex([]),
                                  role="Platform engineer", send=noop, on_question=noop, on_finish=noop)
    await interviewer._put("Explain a durable queue.", False)
    interviewer.asked[-1].depth = 3
    interviewer.asked[-1].answer = ["We persist events and commit offsets only after processing."]
    text, follow = await interviewer._generate()
    await interviewer._put(text, follow)
    assert interviewer.asked[-1].depth == expected
    assert interviewer._question_payload(interviewer.asked[-1])["concept_depth"] == expected
    assert "Kafka" in llm.requests[0].messages[0].content


async def test_a_superseded_prefetch_cannot_escalate_newer_speech() -> None:
    async def noop(*args: Any) -> None:
        pass
    interviewer = MockInterviewer(MockConfig(), llm=MockLLMProvider(script=[
        json.dumps({"question": "How does it scale?", "is_follow_up": True, "last_answer_score": 5})]),
        index=SessionIndex([]), role=None, send=noop, on_question=noop, on_finish=noop)
    await interviewer._put("Explain caching.", False)
    interviewer.asked[-1].answer = ["Cache popular keys."]
    text, follow = await interviewer._generate()
    interviewer.asked[-1].answer.append("Actually I do not know how invalidation works.")
    await interviewer._put(text, follow)
    assert interviewer.asked[-1].depth == 1 and not interviewer._proposed_depth


def test_streamed_code_walkthrough_does_not_corrupt_executable_code() -> None:
    parser = AnswerStreamParser("Explain two sum.", QuestionType.coding, [])
    response = ("TYPE: coding\nANSWER: Use a hash map.\nCODE:\n\x60\x60\x60python\n"
                "seen = {}\n\x60\x60\x60\nTIME: O(n)\nSPACE: O(n)\n"
                "INTUITION: Remember earlier complements.\nCOMMENTARY:\n"
                "- Create a map because repeated lookup must be fast.\n"
                "- Check first because one value cannot pair with itself.\n"
                "- Store the index because the answer needs positions.\n"
                "DEFENSE: One pass with at most n map entries gives O(n) time and space.\n")
    for char in response:
        parser.feed(char)
    result = parser.snapshot()
    assert result.code and result.code.content.strip() == "seen = {}"
    assert result.walkthrough and len(result.walkthrough.commentary) == 3
    assert result.time_complexity == "O(n)" and "One pass" in result.walkthrough.complexity_defense
