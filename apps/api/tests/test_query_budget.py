"""SQL statements per request on the hot endpoints (docs/PERFORMANCE.md): a fixed number however much an account
has, under a budget. An N+1 (a query per session, per resume, per account) fails here instead of in production,
where every query is a network round trip. The admin cost report used to run two per account (4,000 for 2,000).

Runs the app in-process (no lifespan, so no background worker's polling is counted) and counts what each request
executes through an engine listener scoped to the request's task."""

import contextvars
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import event

from orbit_api import db as dbmod
from orbit_api.auth.security import create_access_token
from orbit_api.config import get_settings
from orbit_api.job_portal.postings import listing_id
from orbit_api.models import (
    Answer,
    Document,
    DocumentChunk,
    JobApplication,
    JobContact,
    JobListing,
    LiveSessionRow,
    ProviderRequest,
    Question,
    Resume,
    SavedAnswer,
    SessionDocument,
    SessionSummary,
    SessionTurn,
    Story,
    UsageEvent,
    User,
    Workspace,
)

_counting: contextvars.ContextVar[list[str] | None] = contextvars.ContextVar("query_budget", default=None)

# The most statements each may run: measured (this suite: SQLite, a token without a device id), plus one. What matters
# as much: the count is the same for an account with a little and one with a lot.
BUDGET = {
    "/v1/auth/me": 2,
    "/v1/entitlements": 10,
    "/v1/usage": 5,
    "/v1/documents": 4,
    "/v1/sessions": 7,
    "/v1/sessions/{sid}": 12,
    "/v1/practice/queue": 3,
    "/v1/resumes": 3,
    "/v1/jobs/tracker": 5,
    "/v1/jobs/contacts": 3,
    "/v1/stories": 3,
    "/v1/answers": 3,
    "/v1/workspaces": 5,
}
ADMIN_BUDGET = {"/v1/admin/costs": 8, "/v1/admin/users": 19, "/v1/admin/stats": 16}


def _listen(conn: Any, cursor: Any, statement: str, *a: Any) -> None:
    bucket = _counting.get()
    if bucket is not None:
        bucket.append(statement)


@pytest.fixture
async def client(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[httpx.AsyncClient]:
    admin = f"budget-admin-{uuid.uuid4().hex[:8]}@example.com"
    monkeypatch.setenv("ORBIT_ADMIN_EMAIL", admin)
    get_settings.cache_clear()
    from orbit_api.main import create_app

    await dbmod.create_all()
    engine = dbmod.get_engine()
    event.listen(engine.sync_engine, "before_cursor_execute", _listen)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app()),
                                     base_url="http://budget.test") as c:
            c.headers["x-admin-email"] = admin  # read by the admin test below (not by the API)
            yield c
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", _listen)
        get_settings.cache_clear()


async def _queries(c: httpx.AsyncClient, path: str, token: str) -> int:
    bucket: list[str] = []
    reset = _counting.set(bucket)
    try:
        r = await c.get(path, headers={"Authorization": f"Bearer {token}"})
    finally:
        _counting.reset(reset)
    assert r.status_code == 200, (path, r.status_code, r.text[:300])
    return len(bucket)


def _rows(n: int, user_id: str, now: datetime) -> Iterator[Any]:
    """An account with n of everything the hot endpoints list."""
    docs = [Document(id=str(uuid.uuid4()), user_id=user_id, title=f"Doc {k}", kind="resume", status="ready",
                     source_text="Python Go Kafka", created_at=now - timedelta(days=k)) for k in range(n)]
    yield from docs
    for d in docs:
        yield DocumentChunk(document_id=d.id, user_id=user_id, ordinal=0, category="skill", label="Python",
                            text="Python and Go on Kafka")
    for k in range(n):
        sid = str(uuid.uuid4())
        at = now - timedelta(days=k, hours=1)
        yield LiveSessionRow(id=sid, user_id=user_id, type="interview", title=f"Round {k}", company="Acme",
                             status="ended", started_at=at, ended_at=at + timedelta(minutes=30), created_at=at)
        yield SessionDocument(session_id=sid, document_id=docs[k].id)
        for t in range(3):
            yield SessionTurn(id=str(uuid.uuid4()), session_id=sid, speaker="interviewer", text="Why Kafka?",
                              start_ms=t * 1000, end_ms=t * 1000 + 900, created_at=at + timedelta(seconds=t))
        qid = str(uuid.uuid4())
        yield Question(id=qid, session_id=sid, text=f"Why Kafka {k}?", type="technical", confidence=0.9,
                       created_at=at)
        yield Answer(id=str(uuid.uuid4()), session_id=sid, question_id=qid, status="completed",
                     content={"text": "Because", "sources": []}, provider="mock", model="mock", created_at=at)
        yield SessionSummary(session_id=sid, content={"review": {"items": [
            {"question": f"Why Kafka {k}?", "score": 2, "feedback": "Say why.", "you_said": "x"}]}})
        yield UsageEvent(user_id=user_id, session_id=sid, metric="live_seconds", quantity=60.0,
                         idempotency_key=f"live:{sid}", created_at=at)
        yield Resume(user_id=user_id, title=f"Resume {k}", data={"basics": {"name": "Ana"}}, design={},
                     job_text="Python")
        ext = f"budget-{user_id[:8]}-{k}"
        lid = listing_id("greenhouse", ext)
        yield JobListing(id=lid, source="greenhouse", external_id=ext, board="acme", company="Acme",
                         title="Engineer", locations=["Pune"], cities=["Pune"], posted_at=now, url="https://x/1",
                         apply_url="https://x/1", dedupe_key=ext)
        yield JobApplication(user_id=user_id, listing_id=lid, source="greenhouse", company="Acme", title="Engineer",
                             url="https://x/1", apply_url="https://x/1",
                             interview_questions={"result": {"questions": [{"question": "Why?"}] * 5}})
        yield JobContact(user_id=user_id, name=f"Contact {k}")
        yield Story(user_id=user_id, title=f"Story {k}", situation="s", task="t", action="a", result="r")
        yield SavedAnswer(user_id=user_id, question=f"Q {k}?", answer="A.")
        yield Workspace(user_id=user_id, name=f"Setup {k}")
        yield ProviderRequest(user_id=user_id, session_id=sid, provider="mock", model="mock", request_type="answer",
                              input_tokens=100, output_tokens=10, estimated_cost_usd=0.001, created_at=now)


async def _account(n: int, **user: Any) -> tuple[str, str]:
    now = datetime.now(UTC)
    uid = str(uuid.uuid4())
    async with dbmod.sessionmaker()() as db:
        db.add(User(id=uid, email=user.pop("email", f"budget-{uid[:8]}@example.com"), password_hash="x",
                    email_verified=True, **user))
        await db.flush()
        rows = list(_rows(n, uid, now))
        # Parents first: these models have foreign keys but no relationships for the flush to order them by.
        for kinds in ((Document, LiveSessionRow, JobListing), (DocumentChunk, SessionDocument, SessionTurn, Question,
                                                               JobApplication), ()):
            db.add_all([r for r in rows if isinstance(r, kinds)] if kinds else
                       [r for r in rows if not isinstance(r, (Document, LiveSessionRow, JobListing, DocumentChunk,
                                                              SessionDocument, SessionTurn, Question,
                                                              JobApplication))])
            await db.flush()
        await db.commit()
    return uid, create_access_token(uid, 0)


async def test_hot_endpoints_run_the_same_few_queries_for_a_small_and_a_big_account(
        client: httpx.AsyncClient) -> None:
    small = await _account(2)
    big = await _account(9)
    async with dbmod.sessionmaker()() as db:
        from sqlalchemy import select

        sids = {uid: await db.scalar(select(LiveSessionRow.id).where(LiveSessionRow.user_id == uid).limit(1))
                for uid in (small[0], big[0])}
    for path, budget in BUDGET.items():
        counts = []
        for uid, token in (small, big):
            counts.append(await _queries(client, path.format(sid=sids[uid]), token))
        assert counts[0] == counts[1], f"{path}: {counts[0]} queries for 2 of everything, {counts[1]} for 9 (N+1)"
        assert counts[1] <= budget, f"{path}: {counts[1]} queries, budget {budget}"


async def test_admin_reports_do_not_query_once_per_account(client: httpx.AsyncClient) -> None:
    _, token = await _account(1, email=client.headers["x-admin-email"])
    for path, budget in ADMIN_BUDGET.items():
        before = await _queries(client, path, token)
        for _ in range(6):  # six more accounts with costs, sessions and usage
            await _account(1)
        after = await _queries(client, path, token)
        # +1 at most: an IN list crossing a 500-account batch.
        assert after - before <= 1, f"{path}: {before} queries, then {after} with six more accounts (N+1)"
        assert after <= budget, f"{path}: {after} queries, budget {budget}"
