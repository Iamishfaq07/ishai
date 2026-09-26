"""Deterministic offline LLM for development and tests. Clearly labelled — never presented as real."""

import asyncio
import json
import re
from collections.abc import AsyncIterator

from orbit_api.live.routing import ReasoningLevel
from orbit_api.providers.llm.base import LLMChunk, LLMProvider, LLMRequest, Usage

_CODING = """ANSWER: [mock] Use a hash map to find each complement in one pass.
- Iterate once, storing value → index
- For each x, check whether target - x was seen
- Return both indices on the first hit
CODE: python
```python
def two_sum(nums: list[int], target: int) -> list[int]:
    seen: dict[int, int] = {}
    for i, x in enumerate(nums):
        if target - x in seen:
            return [seen[target - x], i]
        seen[x] = i
    return []
```
TIME: O(n)
SPACE: O(n)
FOLLOWUP: How would you handle duplicate values?
POINTS: Hash map of complements | One pass | O(n) time and space
"""

_GENERAL = """ANSWER: [mock answer — set DEEPSEEK_API_KEY for real responses] {q}
- Lead with the direct answer in one sentence
- Support it with one concrete, verified example
- Close with the impact or trade-off
FOLLOWUP: Can you give a specific example?
POINTS: Direct answer first | One verified example | Impact or trade-off
"""


def _mock_report(user: str) -> str:
    """Canned report whose review scores every paired question (4 when answered) so tests exercise the
    server-side validation of the model's scorecard."""
    import json
    import re

    items = [{"q": int(n), "feedback": f"[mock] feedback {n}", "score": 4, "better": f"[mock] better {n}"}
             for n in re.findall(r"^Q(\d+):", user, flags=re.MULTILINE)]
    return json.dumps({
        "summary": "[mock] Session summary.", "topics": [], "important_follow_ups": [],
        "potential_weak_areas": [], "suggested_preparation": [],
        "review": {"overall_score": 4, "strengths": ["[mock] clear structure"], "improvements": ["[mock] add metrics"],
                   "practice": ["[mock] rehearse STAR stories"], "items": items},
    })


class MockLLMProvider(LLMProvider):
    name = "mock"

    def __init__(self, *, chunk_delay_s: float = 0.0, script: list[str] | None = None) -> None:
        self._delay = chunk_delay_s
        self._script = script  # queued exact responses for tests
        self.requests: list[LLMRequest] = []

    def model_for(self, reasoning: ReasoningLevel) -> str:
        return "mock"

    def supports_vision(self) -> bool:
        return True

    def _response_for(self, request: LLMRequest) -> str:
        if self._script:
            return self._script.pop(0)
        if request.request_type == "summary":
            return _mock_report(request.messages[-1].content if request.messages else "")
        if request.request_type == "prep":
            body = request.messages[-1].content if request.messages else ""
            m = re.search(r"Number of questions: (\d+)", body)
            n = int(m.group(1)) if m else 8
            cats = ["behavioral", "technical", "role", "motivation", "curveball"]
            return json.dumps({"role": "[mock] Role", "company": None, "questions": [
                {"question": f"[mock] Prep question {i + 1}?", "category": cats[i % len(cats)],
                 "why": "[mock] The job description asks for this.",
                 "talking_points": ["[mock] point A", "[mock] point B"],
                 "suggested_answer": f"[mock] In my last role I [name the project] — answer {i + 1}."}
                for i in range(n)]})
        if request.request_type == "story_draft":
            body = request.messages[-1].content if request.messages else ""
            m = re.search(r"Number of stories: (\d+)", body)
            comps = ["leadership", "conflict", "failure", "impact", "teamwork", "ambiguity"]
            return json.dumps({"stories": [
                {"title": f"[mock] Story {i + 1}", "situation": "[mock] The team was behind on a launch.",
                 "task": "[mock] I owned the release.", "action": "[mock] I re-planned the work and [what you did].",
                 "result": "[mock] We shipped on time [with a number].", "competencies": [comps[i % len(comps)]]}
                for i in range(int(m.group(1)) if m else 1)]})
        if request.request_type == "follow_up":
            return json.dumps({
                "debrief": {"went_well": ["[mock] clear example"], "to_improve": ["[mock] add a metric"],
                            "promised": ["[mock] send the portfolio link"], "next_steps": []},
                "thank_you": {"subject": "[mock] Thank you",
                              "body": "Hi [Interviewer name],\n\n[mock] Thanks for the conversation.\n\n[Your name]"},
            })
        if request.request_type == "mock_question" and "call_so_far" in (request.messages[-1].content
                                                                           if request.messages else ""):
            body = request.messages[-1].content
            n = body.count("Recruiter:") + 1
            return json.dumps({"question": f"[mock] Recruiter turn {n}: what number did you have in mind?",
                               "is_follow_up": n > 1, "done": "set done to true" in body})
        if request.request_type == "mock_question":
            body = request.messages[-1].content if request.messages else ""
            n = body.count("Interviewer:") + 1
            follow = "follow-up on the last answer" in body and n > 1 and n % 2 == 0
            return json.dumps({"question": f"[mock] Question {n}: tell me about a project you're proud of.",
                               "is_follow_up": follow})
        if request.request_type == "classify":
            # Deterministic stand-in for the ambiguous-question classifier: statements about prices/values are
            # not questions; anything else in the band is answered as-is.
            body = request.messages[-1].content if request.messages else ""
            utterance = body.split('source="utterance">', 1)[-1].split("</reference_data>", 1)[0].strip()
            statement = any(w in utterance.lower() for w in ("price", "we value", "our culture"))
            return json.dumps({"kind": "non_question" if statement else "question", "should_answer": not statement,
                               "normalized_question": "" if statement else utterance})
        user = request.messages[-1].content if request.messages else ""
        q = ""
        for line in user.splitlines():
            if line.startswith("QUESTION:"):
                q = line.removeprefix("QUESTION:").strip()
        low = user.lower()
        if request.images or any(k in low for k in ("two sum", "write a function", "implement")):
            return _CODING
        return _GENERAL.format(q=q or "Here is a structured answer.")

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        self.requests.append(request)
        text = self._response_for(request)
        words = text.split(" ")
        for i, w in enumerate(words):
            if self._delay:
                await asyncio.sleep(self._delay)
            yield LLMChunk(delta=w if i == 0 else " " + w)
        yield LLMChunk(usage=Usage(sum(len(m.content) for m in request.messages) // 4, len(text) // 4))
