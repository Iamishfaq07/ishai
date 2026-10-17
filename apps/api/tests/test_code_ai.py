from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import update

from orbit_api.code.problems import PATTERNS, PROBLEMS
from orbit_api.code.review import parse_review
from orbit_api.db import sessionmaker
from orbit_api.models import User
from tests.test_api import _register
from tests.test_jobs import run


def test_every_pattern_has_an_easier_and_a_harder_problem() -> None:
    assert len({p.id for p in PROBLEMS}) == len(PROBLEMS)
    for pattern in PATTERNS:
        mine = [p for p in PROBLEMS if p.pattern == pattern]
        assert len(mine) == 2, pattern
    for p in PROBLEMS:
        assert len(p.hints) == 3 and len(p.tests) >= 3 and p.function in p.js


def test_a_review_never_carries_code_and_stays_honest_about_tests() -> None:
    import json
    raw = json.dumps({"verdict": "solved", "summary": "Close.", "scores": {"problem_solving": 9, "code_quality": "x"},
                      "fixes": ["Use a map", "```py\nprint(1)\n```", "for i in range(n):"], "edge_cases": []})
    r = parse_review(raw, passed=3, total=5)
    assert r.verdict == "partly"  # tests failed: not solved
    assert r.fixes == ["Use a map"]
    assert r.scores.problem_solving == 5 and r.scores.code_quality == 3
    assert parse_review(json.dumps({"verdict": "not_yet", "summary": "x"}), 5, 5).verdict == "partly"


def _verify(client: TestClient, h: dict[str, str]) -> None:
    uid = client.get("/v1/auth/me", headers=h).json()["id"]

    async def go() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(User).where(User.id == uid).values(email_verified=True))
            await db.commit()
    run(client, go)


def test_attempts_are_reviewed_tracked_and_private(client: TestClient) -> None:
    _register(client)  # the first account is the admin when this runs alone
    h = _register(client)
    _verify(client, h)
    listing = client.get("/v1/code/problems", headers=h).json()
    assert listing["patterns"] == PATTERNS and listing["reviews_left"] == 15
    assert not any(p["solved"] for p in listing["problems"])
    detail = client.get("/v1/code/problems/pair-sum", headers=h).json()
    n = len(detail["problem"]["tests"])
    assert detail["attempts"] == [] and detail["problem"]["hints"]
    r = client.post("/v1/code/problems/pair-sum/attempts", headers=h, json={
        "language": "javascript", "code": "function pairSum(n, t) { return [0, 1]; }", "approach": "",
        "passed": 1, "total": n, "failing": "pairSum([4,9,1,7], 8) gave [0,1], expected [2,3]"})
    assert r.status_code == 201, r.text
    first = r.json()
    assert not first["solved"] and first["review"]["verdict"] == "partly"
    assert all("```" not in f and not f.startswith("return") for f in first["review"]["fixes"])
    ok = client.post("/v1/code/problems/pair-sum/attempts", headers=h, json={
        "language": "javascript", "code": "function pairSum(n, t) { /* map */ }", "approach": "A map of seen values.",
        "passed": n, "total": n}).json()
    assert ok["solved"] and ok["review"]["verdict"] == "solved"
    # A count that isn't this problem's isn't trusted; Python isn't run, so the AI's verdict decides.
    fake = client.post("/v1/code/problems/pair-sum/attempts", headers=h, json={
        "language": "javascript", "code": "x", "passed": 99, "total": 99}).json()
    assert fake["total"] == 0 and not fake["solved"]
    py = client.post("/v1/code/problems/climb-stairs/attempts", headers=h, json={
        "language": "python", "code": "def ways_up(n): ...", "passed": 5, "total": 5}).json()
    assert py["total"] == 0
    summary = {p["id"]: p for p in client.get("/v1/code/problems", headers=h).json()["problems"]}
    assert summary["pair-sum"] == {**summary["pair-sum"], "attempts": 3, "solved": True}
    assert client.get("/v1/code/problems/pair-sum", headers=h).json()["attempts"][0]["id"] == fake["id"]
    other = _register(client)
    assert client.get("/v1/code/problems/pair-sum", headers=other).json()["attempts"] == []
    assert client.get("/v1/code/problems/nope", headers=h).status_code == 404
    assert client.post("/v1/code/problems/pair-sum/attempts", headers=h, json={
        "language": "javascript", "code": "x", "passed": 3, "total": 2}).status_code == 422


def test_a_garbled_review_doesnt_use_one_of_the_days_reviews(client: TestClient, monkeypatch: Any) -> None:
    """The day's free reviews were counted from the AI calls, so an answer that came back garbled (a 502, nothing
    saved) used one up. They're counted from the reviews delivered now (the calls stay capped at twice that)."""
    from orbit_api.job_portal import routes as portal
    from orbit_api.providers.llm.base import LLMResponse, Usage

    _register(client)  # the first account is the admin when this runs alone
    h = _register(client)
    _verify(client, h)

    class Garbled:
        name = "garbled"

        async def generate(self, req: Any) -> LLMResponse:
            return LLMResponse(text="not a review", model="garbled", usage=Usage())

    real = portal.get_llm_provider
    monkeypatch.setattr(portal, "get_llm_provider", lambda: Garbled())
    attempt = {"language": "python", "code": "def ways_up(n): ...", "passed": 0, "total": 0}
    assert client.post("/v1/code/problems/climb-stairs/attempts", headers=h, json=attempt).status_code == 502
    assert client.get("/v1/code/problems", headers=h).json()["reviews_left"] == 15
    monkeypatch.setattr(portal, "get_llm_provider", real)
    assert client.post("/v1/code/problems/climb-stairs/attempts", headers=h, json=attempt).status_code == 201
    assert client.get("/v1/code/problems?tz_offset=330", headers=h).json()["reviews_left"] == 14


def test_the_days_reviews_come_back_at_the_persons_own_midnight() -> None:
    from datetime import UTC, datetime

    from orbit_api.code.routes import day_start

    now = datetime(2026, 10, 20, 20, 0, tzinfo=UTC)  # 01:30 on the 21st in India
    assert day_start(now, 0) == datetime(2026, 10, 20, 0, 0, tzinfo=UTC)
    assert day_start(now, 330) == datetime(2026, 10, 20, 18, 30, tzinfo=UTC)  # midnight of the 21st there
    assert day_start(now, -420) == datetime(2026, 10, 20, 7, 0, tzinfo=UTC)  # 13:00 on the 20th in California
