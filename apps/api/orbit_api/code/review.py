"""The AI interviewer's review of one attempt: what a coding-round interviewer would say. Whether it works, how it
scores on the four things coding rounds grade (problem solving, code, complexity, explaining it), the edge cases it
misses, what to fix, and the follow-up they'd ask next. Never the solution: code in its answer is taken out.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel

from orbit_api.code.problems import Problem
from orbit_api.live.context_builder import fence
from orbit_api.providers.llm.base import LLMMessage, LLMProvider, LLMRequest
from orbit_api.resumes.ai import _json

MAX_CODE = 12_000
Verdict = Literal["solved", "partly", "not_yet"]


class Scores(BaseModel):
    problem_solving: int
    code_quality: int
    complexity: int
    communication: int


class Review(BaseModel):
    verdict: Verdict
    summary: str
    scores: Scores
    complexity: str  # the attempt's time and space, as the reviewer reads it
    strengths: list[str]
    fixes: list[str]
    edge_cases: list[str]
    follow_up: str  # what the interviewer asks next


SYSTEM = """You are a senior engineer running a coding interview. Review the candidate's attempt at the problem.
Be specific to their code and kind, like a good interviewer debrief. NEVER write the solution or any code: describe
what to change in words, so they can fix it themselves.

You get the problem, the language, their code, how they explained their approach (may be empty), and how many of
the problem's tests passed when they ran it (JavaScript only; for other languages you judge the code yourself).

Return ONLY a JSON object:
{"verdict": "solved" | "partly" | "not_yet",
 "summary": "one or two sentences: where this attempt stands",
 "scores": {"problem_solving": 1-5, "code_quality": 1-5, "complexity": 1-5, "communication": 1-5},
 "complexity": "the attempt's time and space, e.g. O(n) time, O(n) space",
 "strengths": ["1-3 things done well"],
 "fixes": ["1-4 concrete changes, in words, most important first"],
 "edge_cases": ["0-4 inputs this code gets wrong or doesn't consider"],
 "follow_up": "the question you'd ask next in the interview"}
communication scores the explanation: 1-2 if it's missing or doesn't say why the approach works."""


def review_request(problem: Problem, language: str, code: str, approach: str, passed: int, total: int,
                   failing: str, llm: LLMProvider) -> LLMRequest:
    tests = (f"Tests: {passed} of {total} passed." + (f" First failing: {failing[:500]}" if failing else "")
             if total else "Tests: not run (only JavaScript runs in the browser).")
    body = (f"<reference_data source=\"problem\">\n{fence(problem.title)}\n{fence(problem.statement)}\n"
            f"A strong answer reaches: {problem.target}\n</reference_data>\n\n"
            f"Language: {language}\n{tests}\n\n"
            f"<reference_data source=\"candidate_code\">\n{fence(code[:MAX_CODE])}\n</reference_data>\n\n"
            f"<reference_data source=\"candidate_explanation\">\n{fence(approach[:3_000] or '(none given)')}\n"
            "</reference_data>")
    return LLMRequest(messages=[LLMMessage("system", SYSTEM), LLMMessage("user", body)],
                      json_mode=llm.supports_structured_output(), max_tokens=1_200, temperature=0.3,
                      request_type="code_review")


_CODE_BLOCK = re.compile(r"```.*?(```|$)", re.S)
_CODE_LINE = re.compile(r"^\s*(?:def |function |for \(|for \w+ in |while |return |const |let |var |if \(|class )")


def _clean(s: Any, limit: int = 400) -> str:
    """One point of the review, without code: a fenced block goes, and so does a point that is a line of code."""
    text = " ".join(_CODE_BLOCK.sub("", str(s or "")).split())[:limit]
    return "" if _CODE_LINE.match(text) else text


def _list(v: Any, n: int) -> list[str]:
    return [x for x in (_clean(i) for i in (v if isinstance(v, list) else [])) if x][:n]


def _score(v: Any) -> int:
    try:
        return min(5, max(1, int(v)))
    except (TypeError, ValueError):
        return 3


def parse_review(text: str, passed: int, total: int) -> Review:
    """The review, kept honest: a run where tests fail can't be "solved", and one where every test passed can't be
    "not_yet"."""
    raw = _json(text)
    verdict = raw.get("verdict") if raw.get("verdict") in ("solved", "partly", "not_yet") else "partly"
    if total and passed < total and verdict == "solved":
        verdict = "partly"
    if total and passed == total and verdict == "not_yet":
        verdict = "partly"
    raw_scores = raw.get("scores")
    s: dict[str, Any] = raw_scores if isinstance(raw_scores, dict) else {}
    summary = _clean(raw.get("summary"), 400)
    if not summary:
        raise ValueError("no summary")
    return Review(verdict=verdict, summary=summary,
                  scores=Scores(**{k: _score(s.get(k)) for k in Scores.model_fields}),
                  complexity=_clean(raw.get("complexity"), 120), strengths=_list(raw.get("strengths"), 3),
                  fixes=_list(raw.get("fixes"), 4), edge_cases=_list(raw.get("edge_cases"), 4),
                  follow_up=_clean(raw.get("follow_up"), 300))
