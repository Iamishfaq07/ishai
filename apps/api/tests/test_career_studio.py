"""Career flows through real routers, persistence and schema validation, with the test-only LLM."""
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from orbit_api.career import routes
from orbit_api.db import sessionmaker
from orbit_api.models import (
    Answer,
    DebriefAttempt,
    LiveSessionRow,
    ProviderRequest,
    Question,
    SessionSummary,
    SessionTurn,
    UsageEvent,
)
from orbit_api.providers.llm.base import LLMError
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.test_api import _register
from tests.test_credits import _new_ip, _signup, _wallet, enforce  # noqa: F401 - shared pytest fixture
from tests.test_jobs import _listing, backend_resume, insert, make_resume, run


@pytest.fixture(autouse=True)
def offline_job_text(monkeypatch: pytest.MonkeyPatch) -> None:
    async def read(db: Any, listing: Any) -> tuple[str, str]:
        return listing.description or listing.snippet, ""
    monkeypatch.setattr(routes, "_full_text", read)


def _session(client: TestClient, h: dict[str, str], **kw: Any) -> str:
    r = client.post("/v1/sessions", headers=h, json={"title": "Career QA", **kw})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def test_full_job_prep_is_durable_idempotent_and_preserves_context(client: TestClient) -> None:
    h = _register(client)
    rid = make_resume(client, h)
    listing = _listing(description="Design and build Go APIs on Kubernetes with measured reliability.",
                       snippet="Design and build Go APIs on Kubernetes.")
    insert(client, listing)
    path = f"/v1/jobs/listings/{listing.id}/full-prep"
    first = client.post(path, headers=h, json={"resume_id": rid})
    assert first.status_code == 200, first.text
    prep = first.json()
    assert prep["resume_id"] != rid and not prep["cached"]
    assert prep["context"]["role"] == listing.title and prep["context"]["company"] == listing.company
    params = parse_qs(urlsplit(prep["practice_link"]).query)
    assert params["company"] == [listing.company]
    assert json.loads(params["tech_stack"][0]) == listing.keywords
    assert params["jd"] == [prep["document_id"]] and params["resume_document_id"]
    copy = client.get(f"/v1/resumes/{prep['resume_id']}", headers=h).json()
    assert copy["pending_suggestions"] and copy["prep_context"]["practice_link"] == prep["practice_link"]
    # Tailoring is a reviewable diff: personal claims aren't silently replaced.
    assert copy["data"] == client.get(f"/v1/resumes/{rid}", headers=h).json()["data"]
    again = client.post(path, headers=h, json={"resume_id": rid})
    assert again.status_code == 200 and again.json()["cached"]
    assert again.json()["resume_id"] == prep["resume_id"]
    other = _register(client)
    assert client.post(path, headers=other, json={"resume_id": rid}).status_code == 404


@pytest.mark.usefixtures("enforce")
def test_failed_full_prep_can_retry_without_a_stuck_reservation(client: TestClient,
                                                               monkeypatch: pytest.MonkeyPatch) -> None:
    h = _signup(client, _new_ip())
    assert _wallet(client, h)["resume"] == 1
    rid = make_resume(client, h)
    listing = _listing()
    insert(client, listing)
    path = f"/v1/jobs/listings/{listing.id}/full-prep"
    async def unavailable(*args: Any) -> Any:
        raise LLMError("unavailable", "offline")
    bad = MockLLMProvider()
    monkeypatch.setattr(bad, "generate", unavailable)
    with monkeypatch.context() as m:
        m.setattr("orbit_api.resumes.routes.get_llm_provider", lambda: bad)
        r = client.post(path, headers=h, json={"resume_id": rid})
        assert r.status_code == 503, r.text
    assert _wallet(client, h)["resume"] == 1
    assert client.post(path, headers=h, json={"resume_id": rid}).status_code == 200
    assert _wallet(client, h)["resume"] == 0


def test_resume_drill_uses_current_unsaved_claims_and_exact_job_context(client: TestClient) -> None:
    h = _register(client)
    rid = make_resume(client, h)
    data = backend_resume()
    data.experience[0].bullets[0] = "Built Go microservices handling 3M transactions a day"
    context = {"role": "Platform engineer", "company": "Acme", "interview_stage": "Staff panel",
               "tech_stack": ["Go", "Kafka"], "key_requirements": ["Design durable event pipelines"]}
    r = client.post(f"/v1/resumes/{rid}/grill", headers=h, json={"data": data.model_dump(), "context": context})
    assert r.status_code == 200, r.text
    assert all(r.json()[k] == v for k, v in context.items())
    async def check() -> None:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, r.json()["id"])
            assert row and row.mock_config
            assert row.mock_config["duration_minutes"] == 5 and row.mock_config["drill"]
            assert row.mock_config["tech_stack"] == ["Go", "Kafka"]
    run(client, check)
    other = _register(client)
    assert client.post(f"/v1/resumes/{rid}/grill", headers=other, json={}).status_code == 404


def _seed_debrief(client: TestClient, sid: str) -> tuple[str, str]:
    qid, aid = str(uuid.uuid4()), str(uuid.uuid4())
    async def seed() -> None:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, sid)
            assert row
            start = datetime.now(UTC) - timedelta(seconds=30)
            row.status, row.started_at, row.ended_at = "ended", start, datetime.now(UTC)
            tid = str(uuid.uuid4())
            db.add(SessionTurn(id=tid, session_id=sid, speaker="interviewer", text="Explain two sum.",
                               start_ms=5000, end_ms=6000, created_at=start + timedelta(seconds=5)))
            db.add(SessionTurn(id=str(uuid.uuid4()), session_id=sid, speaker="candidate",
                text="I scan the array with a hash map.", start_ms=6500, end_ms=10000,
                created_at=start + timedelta(seconds=6)))
            db.add(Question(id=qid, session_id=sid, turn_id=tid, text="Explain two sum.", type="coding",
                            confidence=1, created_at=start + timedelta(seconds=5)))
            db.add(Answer(id=aid, session_id=sid, question_id=qid, status="completed", provider="mock", model="mock",
                          content={"question": "Explain two sum.", "code": {"language": "python",
                                   "content": "def two_sum(nums, target):\n    seen = {}\n    return seen"}}))
            db.add(SessionSummary(session_id=sid, content={"review": {"items": [
                {"question_id": qid, "question": "Explain two sum.", "score": 2, "better": "Check complements first.",
                 "missing_points": ["Explain duplicates"], "clarity_score": 2, "delivery_score": 3,
                 "dimensions": {"technical_depth": 2, "communication_clarity": 2}}]}}))
            await db.commit()
    run(client, seed)
    return qid, aid


def test_debrief_is_time_aligned_and_retry_updates_real_radar(client: TestClient) -> None:
    h = _register(client)
    sid = _session(client, h)
    qid, _ = _seed_debrief(client, sid)
    path = f"/v1/sessions/{sid}/debrief"
    initial = client.get(path, headers=h).json()
    item = initial["items"][0]
    assert item["time_ms"] == 5000 and "hash map" in item["transcript"]
    assert item["ideal_code"] and item["missing_points"] == ["Explain duplicates"]
    assert initial["radar"]["technical_depth"] == 2 and initial["radar"]["scalability"] is None
    retry = client.post(f"{path}/{qid}/retry", headers=h, json={"answer": "Check each complement before insertion."})
    assert retry.status_code == 200, retry.text
    refreshed = client.get(path, headers=h).json()
    assert refreshed["items"][0]["attempts"][0]["id"] == retry.json()["id"]
    assert refreshed["radar"]["technical_depth"] == retry.json()["dimensions"]["technical_depth"]
    other = _register(client)
    assert client.get(path, headers=other).status_code == 404
    assert client.post(f"{path}/{qid}/retry", headers=other,
                       json={"answer": "A sufficiently long answer."}).status_code == 404
    # Transcript deletion cascades to newly stored retry text.
    deleted = client.delete(f"/v1/sessions/{sid}/transcript", headers=h)
    assert deleted.status_code == 204, deleted.text
    async def check() -> None:
        async with sessionmaker()() as db:
            assert await db.scalar(select(func.count()).select_from(DebriefAttempt).where(
                DebriefAttempt.question_id == qid)) == 0
    run(client, check)


def test_live_question_retry_is_rejected_until_session_ends(client: TestClient) -> None:
    h = _register(client)
    sid = _session(client, h)
    r = client.post(f"/v1/sessions/{sid}/debrief/missing/retry", headers=h,
                    json={"answer": "A sufficiently long answer."})
    assert r.status_code == 409


def test_architecture_notes_and_file_validate_schema_magic_and_ownership(client: TestClient) -> None:
    h = _register(client)
    sid = _session(client, h, type="coding")
    path = f"/v1/sessions/{sid}/defense"
    r = client.post(path, headers=h, json={"notes": "A Go API writes to a primary Postgres database behind a queue."})
    assert r.status_code == 200, r.text
    assert len(r.json()["follow_ups"]) == 3 and r.json()["spofs"] and r.json()["trade_offs"]
    uploaded = client.post(path + "-file", headers=h,
                           files={"file": ("system.py", b"queue = []\n# persist to Postgres", "text/plain")})
    assert uploaded.status_code == 200, uploaded.text
    spoof = client.post(path + "-file", headers=h,
                        files={"file": ("diagram.png", b"not an image", "image/png")})
    assert spoof.status_code == 422
    huge = client.post(path + "-file", headers=h,
                       files={"file": ("notes.txt", b"x" * (5 * 1024 * 1024 + 1), "text/plain")})
    assert huge.status_code == 413
    other = _register(client)
    assert client.post(path, headers=other,
                       json={"notes": "An API uses a durable queue and relational database."}).status_code == 404


def test_historical_walkthrough_is_generated_once_and_saved_on_owned_answer(client: TestClient) -> None:
    h = _register(client)
    sid = _session(client, h, type="coding")
    _, aid = _seed_debrief(client, sid)
    path = f"/v1/sessions/{sid}/answers/{aid}/walkthrough"
    r = client.post(path, headers=h)
    assert r.status_code == 200 and len(r.json()["commentary"]) == 3, r.text
    assert client.post(path, headers=h).json() == r.json()
    # Check the real persisted provider log, so the second request cannot silently pay for another generation.
    uid = client.get("/v1/auth/me", headers=h).json()["id"]
    async def records() -> int:
        async with sessionmaker()() as db:
            return int(await db.scalar(select(func.count()).select_from(ProviderRequest).where(
                ProviderRequest.user_id == uid, ProviderRequest.request_type == "spoken_walkthrough")) or 0)
    assert run(client, records) == 1
    other = _register(client)
    assert client.post(path, headers=other).status_code == 404


def test_a_burst_of_full_prep_requests_can_only_create_one_tailoring(client: TestClient) -> None:
    import asyncio

    h = _register(client)
    uid = client.get("/v1/auth/me", headers=h).json()["id"]
    rid = make_resume(client, h)
    listing = _listing()
    insert(client, listing)
    async def burst() -> list[httpx.Response]:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app), base_url="http://testserver") as c:
            return await asyncio.gather(*(c.post(f"/v1/jobs/listings/{listing.id}/full-prep",
                                                 headers=h, json={"resume_id": rid}) for _ in range(4)))
    replies = run(client, burst)
    assert all(r.status_code in (200, 409) for r in replies), [r.text for r in replies]
    assert any(r.status_code == 200 for r in replies)
    assert len({r.json()["resume_id"] for r in replies if r.status_code == 200}) == 1
    async def count() -> int:
        async with sessionmaker()() as db:
            return int(await db.scalar(select(func.count()).select_from(ProviderRequest).where(
                ProviderRequest.user_id == uid, ProviderRequest.request_type == "resume_suggest")) or 0)
    assert run(client, count) == 1


def test_failed_architecture_assessment_refunds_reserved_usage(client: TestClient,
                                                              monkeypatch: pytest.MonkeyPatch) -> None:
    h = _register(client)
    sid = _session(client, h, type="coding")
    bad = MockLLMProvider()
    async def unavailable(*args: Any) -> Any:
        raise LLMError("unavailable", "offline")
    monkeypatch.setattr(bad, "generate", unavailable)
    monkeypatch.setattr("orbit_api.career.service.get_llm_provider", lambda: bad)
    r = client.post(f"/v1/sessions/{sid}/defense", headers=h,
                    json={"notes": "An API stores durable work in Postgres behind a bounded queue."})
    assert r.status_code == 503, r.text
    async def count() -> int:
        async with sessionmaker()() as db:
            return int(await db.scalar(select(func.count()).select_from(UsageEvent).where(
                UsageEvent.session_id == sid, UsageEvent.metric == "screenshots")) or 0)
    assert run(client, count) == 0
