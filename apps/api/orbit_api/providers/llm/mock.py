"""Deterministic offline LLM for development and tests. Clearly labelled — never presented as real."""

import asyncio
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
"""

_GENERAL = """ANSWER: [mock answer — set DEEPSEEK_API_KEY for real responses] {q}
- Lead with the direct answer in one sentence
- Support it with one concrete, verified example
- Close with the impact or trade-off
FOLLOWUP: Can you give a specific example?
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
        if request.request_type == "classify":
            return '{"is_question": true, "confidence": 0.7}'
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
