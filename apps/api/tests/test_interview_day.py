"""Interview day (job_portal/interview.py, DECISIONS D64): a tracked job's prep view, the copilot started with that
job loaded (and the job's documents reaching the answer prompt), the wrap-up the user confirms, and that none of it
crosses accounts."""

import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from orbit_api.db import sessionmaker
from orbit_api.documents import routes as documents_routes
from orbit_api.job_portal import interview
from orbit_api.job_portal.interview import chosen_version, resume_document_text
from orbit_api.job_portal.rounds import round_label
from orbit_api.models import Document, LiveSessionRow
from orbit_api.providers.llm import get_llm_provider
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.resumes.schema import ResumeData
from tests.test_api import _collect, _register
from tests.test_credits import _new_ip, _signup, _wallet, enforce  # noqa: F401 - shared pytest fixture
from tests.test_jobs import _listing, backend_resume, insert, make_resume, run
from tests.test_stories import STORY

POST = ("Razorpay builds payment infrastructure for Indian businesses.\n\nRequirements\n"
        "- 3+ years building backend services in Go or Python\n"
        "- Designing idempotent payment retry flows that never charge twice\n"
        "- Operating Kafka consumers and Redis caches in production\n\n"
        "Responsibilities\n- Own the settlement ledger service end to end\n- Mentor two junior engineers\n"
        + "We value ownership, merchant focus and transparency in everything we ship. " * 8)


@pytest.fixture(autouse=True)
def offline_post(monkeypatch: pytest.MonkeyPatch) -> None:
    async def read(db: Any, listing: Any) -> tuple[str, None]:
        return listing.description or listing.snippet, None
    monkeypatch.setattr(interview, "_full_text", read)


def _job(client: TestClient, h: dict[str, str], company: str = "Razorpay") -> tuple[str, str]:
    """A post in the feed, saved to the tracker: (tracker id, listing id)."""
    listing = _listing(company=company, title="Backend Engineer, Payments", description=POST,
                       snippet="Payments backend in Go.", keywords=["Go", "Kafka", "Redis"])
    insert(client, listing)
    r = client.post("/v1/jobs/tracker", headers=h, json={"listing_id": listing.id, "status": "applied"})
    assert r.status_code == 201, r.text
    return str(r.json()["id"]), listing.id


def _sent(client: TestClient, h: dict[str, str], eid: str) -> tuple[str, str]:
    """A resume linked to the job and frozen as sent: (resume id, snapshot id)."""
    rid = make_resume(client, h)
    client.put(f"/v1/jobs/tracker/{eid}/mission/resume", headers=h, json={"resume_id": rid})
    m = client.post(f"/v1/jobs/tracker/{eid}/mission/snapshots", headers=h, json={"note": "careers page"}).json()
    return rid, m["snapshots"][0]["id"]


def _docs(client: TestClient, user_kind: str | None = None) -> int:
    async def go() -> int:
        async with sessionmaker()() as db:
            q = select(func.count()).select_from(Document)
            return int(await db.scalar(q.where(Document.kind == user_kind) if user_kind else q) or 0)
    return int(run(client, go))


def test_round_labels_and_the_version_rule() -> None:
    assert round_label("technical", 2) == "Round 2 · Technical round"
    assert round_label("hr", None) == "HR round" and round_label(None, 3) == "Round 3"
    assert round_label(None, None) == "" and round_label("nonsense", None) == ""
    assert chosen_version(None, [], None) is None


def test_the_resume_document_keeps_its_sections() -> None:
    text = resume_document_text(backend_resume())
    assert "EXPERIENCE" in text and "SKILLS" in text
    assert "Backend Engineer, PayNest — Bengaluru" in text
    assert "- Cut p95 latency from 900 ms to 250 ms with Redis caching and PostgreSQL tuning" in text
    hidden = backend_resume().model_copy(update={"hidden": ["skills"]})
    assert "SKILLS" not in resume_document_text(ResumeData.model_validate(hidden.model_dump()))


def test_the_prep_view_and_setting_it_up(client: TestClient) -> None:
    h = _register(client)
    eid, _ = _job(client, h)
    v = client.get(f"/v1/jobs/tracker/{eid}/interview", headers=h).json()
    assert v["company"] == "Razorpay" and v["guide"] == "Razorpay" and v["version"] is None
    assert v["job"]["has_text"] and v["job"]["live"] and not v["job"]["manual"] and v["job"]["document_id"] is None
    assert v["requirements"] == ["Go", "Kafka", "Redis"]  # no fit check yet: the post's skills
    assert v["round"] == {"type": None, "number": None, "label": "", "at": None}

    rid, sid = _sent(client, h, eid)
    v = client.get(f"/v1/jobs/tracker/{eid}/interview", headers=h).json()
    # The version sent is the one used; the linked resume is there to pick instead.
    assert v["version"]["kind"] == "snapshot" and v["version"]["id"] == sid and v["version"]["note"] == "careers page"
    assert [x["kind"] for x in v["versions"]] == ["snapshot", "resume"]

    at = (datetime.now(UTC) + timedelta(days=1)).replace(microsecond=0)
    r = client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={
        "at": at.isoformat(), "round_type": "technical", "round_number": 2, "status": "interviewing",
        "version": "resume"})
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["round"]["label"] == "Round 2 · Technical round" and v["status"] == "interviewing"
    assert datetime.fromisoformat(v["round"]["at"]) == at
    assert v["version"] == {**v["versions"][1], "kind": "resume", "id": rid}
    # Only what's sent changes: clearing the round type keeps the number and the date.
    v = client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"round_type": None}).json()
    assert v["round"]["label"] == "Round 2" and v["round"]["at"] is not None
    v = client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"version": None}).json()
    assert v["version"]["id"] == sid
    # Freezing another version as sent makes it the one used.
    client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"version": "resume"})
    newer = client.post(f"/v1/jobs/tracker/{eid}/mission/snapshots", headers=h, json={}).json()["snapshots"][0]["id"]
    v = client.get(f"/v1/jobs/tracker/{eid}/interview", headers=h).json()
    assert v["version"]["id"] == newer and [x["kind"] for x in v["versions"]] == ["snapshot", "snapshot", "resume"]
    # Picking another resume once versions were sent uses that one as it is now.
    other = make_resume(client, h)
    v = client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"resume_id": other}).json()
    assert v["version"]["kind"] == "resume" and v["version"]["id"] == other
    client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"resume_id": rid, "version": sid})
    entry = next(e for e in client.get("/v1/jobs/tracker", headers=h).json() if e["id"] == eid)
    assert entry["round_number"] == 2 and entry["round_type"] is None and entry["last_round"] is None
    assert client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"round_type": "lunch"}).status_code == 422


def test_stories_are_matched_to_the_jobs_requirements(client: TestClient) -> None:
    h = _register(client)
    eid, _ = _job(client, h)
    client.post("/v1/stories", headers=h, json=STORY)
    retry = {**STORY, "title": "Made payment retries idempotent", "competencies": ["ownership"],
             "situation": "Customers were charged twice when the bank timed out and the client retried.",
             "action": "I added idempotency keys to every payment retry and a Kafka consumer that deduplicated them.",
             "result": "Double charges went to zero."}
    sid = client.post("/v1/stories", headers=h, json=retry).json()["id"]
    v = client.get(f"/v1/jobs/tracker/{eid}/interview", headers=h).json()
    assert v["stories_total"] == 2
    assert {"id": sid, "title": retry["title"], "requirement": "Kafka"} in v["stories"]


def test_a_job_added_by_hand_takes_a_pasted_post(client: TestClient) -> None:
    h, other = _register(client), _register(client)
    eid = client.post("/v1/jobs/tracker/manual", headers=h, json={"company": "Hooli", "title": "SRE"}).json()["id"]
    v = client.get(f"/v1/jobs/tracker/{eid}/interview", headers=h).json()
    assert v["job"]["manual"] and not v["job"]["has_text"] and v["guide"] is None
    v = client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"job_text": POST}).json()
    assert v["job"]["has_text"] and v["job"]["document_title"] == "SRE — Hooli"
    again = client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"job_text": POST + " Updated."}).json()
    assert again["job"]["document_id"] == v["job"]["document_id"]  # brought up to date, not copied
    assert any("idempotent payment retry" in r for r in again["requirements"])
    # Someone else's document can't be attached; nor a document that isn't a job post.
    theirs = client.post("/v1/documents/text", headers=other, json={"title": "JD", "kind": "job_description",
                                                                  "text": POST}).json()["id"]
    assert client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h,
                      json={"document_id": theirs}).status_code == 404
    notes = client.post("/v1/documents/text", headers=h, json={"title": "Notes", "kind": "notes",
                                                              "text": "Some notes for the round, at length."}).json()
    assert client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h,
                      json={"document_id": notes["id"]}).status_code == 422


def test_the_session_context_saves_the_post_and_the_version_once(client: TestClient) -> None:
    h = _register(client)
    eid, _ = _job(client, h)
    _, sid = _sent(client, h, eid)
    client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"round_type": "technical", "round_number": 2})
    r = client.post(f"/v1/jobs/tracker/{eid}/session-context", headers=h)
    assert r.status_code == 200, r.text
    ctx = r.json()
    assert ctx["application_id"] == eid and ctx["company"] == "Razorpay" and ctx["guide"] == "Razorpay"
    assert ctx["role"] == "Backend Engineer, Payments" and ctx["interview_stage"] == "Round 2 · Technical round"
    assert ctx["title"] == "Razorpay — Round 2 · Technical round" and ctx["tech_stack"] == ["Go", "Kafka", "Redis"]
    assert [d["kind"] for d in ctx["documents"]] == ["job_description", "resume"] and ctx["resume_included"]
    assert ctx["version"]["id"] == sid and ctx["notes"] == []
    assert ctx["documents"][1]["title"].startswith("My CV (sent ")
    # The post is linked to the job (Practice and the mission room see it), and a second start copies nothing.
    entry = next(e for e in client.get("/v1/jobs/tracker", headers=h).json() if e["id"] == eid)
    assert entry["document_id"] == ctx["document_ids"][0]
    count = _docs(client)
    assert client.post(f"/v1/jobs/tracker/{eid}/session-context", headers=h).json()["document_ids"] == \
        ctx["document_ids"]
    assert _docs(client) == count


def test_one_resume_sent_to_two_jobs_is_one_document(client: TestClient) -> None:
    h = _register(client)
    first, _ = _job(client, h)
    second, _ = _job(client, h, company="Initech")
    rid = make_resume(client, h)
    for eid in (first, second):
        client.put(f"/v1/jobs/tracker/{eid}/mission/resume", headers=h, json={"resume_id": rid})
    a = client.post(f"/v1/jobs/tracker/{first}/session-context", headers=h).json()
    b = client.post(f"/v1/jobs/tracker/{second}/session-context", headers=h).json()
    assert a["document_ids"][1] == b["document_ids"][1] and a["document_ids"][0] != b["document_ids"][0]


def _notes(client: TestClient, h: dict[str, str], n: int) -> None:
    for i in range(n):
        r = client.post("/v1/documents/text", headers=h, json={"title": f"Notes {i}", "kind": "notes",
                                                               "text": f"Notes for round {i}, kept for later."})
        assert r.status_code == 201, r.text


def test_interview_documents_are_outside_the_plans_documents(client: TestClient) -> None:
    _register(client)  # with no ORBIT_ADMIN_EMAIL the first account stands in as admin (no limits): not this one
    h = _register(client)
    eid, _ = _job(client, h)
    _sent(client, h, eid)
    _notes(client, h, 3)  # the Free plan keeps 3 documents: all used
    r = client.post(f"/v1/jobs/tracker/{eid}/session-context?tz_offset=330", headers=h)
    assert r.status_code == 200, r.text
    ctx = r.json()
    assert len(ctx["document_ids"]) == 2 and ctx["resume_included"] and ctx["notes"] == []
    assert ctx["documents"][1]["title"].startswith("My CV (sent ")
    # They don't count as the plan's: still 3 of 3, and the plan's own limit still holds for the user's documents.
    assert client.get("/v1/entitlements", headers=h).json()["usage"]["documents"] == 3
    r = client.post("/v1/documents/text", headers=h, json={"title": "More", "kind": "notes",
                                                          "text": "One more set of notes for the round."})
    assert r.status_code == 402
    # A post pasted for a job added by hand is one of them too.
    manual = client.post("/v1/jobs/tracker/manual", headers=h, json={"company": "Hooli", "title": "SRE"}).json()["id"]
    v = client.put(f"/v1/jobs/tracker/{manual}/interview", headers=h, json={"job_text": POST})
    assert v.status_code == 200 and v.json()["job"]["document_id"]


def test_interview_documents_are_capped_on_their_own(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(documents_routes, "MAX_ORBIT_DOCUMENTS", 2)
    h = _register(client)
    first, _ = _job(client, h)
    second, _ = _job(client, h, company="Initech")
    rid = make_resume(client, h)
    for eid in (first, second):
        client.put(f"/v1/jobs/tracker/{eid}/mission/resume", headers=h, json={"resume_id": rid})
    assert len(client.post(f"/v1/jobs/tracker/{first}/session-context", headers=h).json()["document_ids"]) == 2
    ctx = client.post(f"/v1/jobs/tracker/{second}/session-context", headers=h).json()
    # The second job's post would be a third: it says so, and the session can still start with the resume (shared).
    assert [d["kind"] for d in ctx["documents"]] == ["resume"] and ctx["resume_included"]
    note = next(n for n in ctx["notes"] if "job post" in n)
    assert "Orbit has saved 2 documents" in note and "Until then, the job post isn't loaded" in note


def test_without_a_resume_the_context_says_so(client: TestClient) -> None:
    h = _register(client)
    eid, _ = _job(client, h, company="Initech")
    ctx = client.post(f"/v1/jobs/tracker/{eid}/session-context", headers=h).json()
    assert [d["kind"] for d in ctx["documents"]] == ["job_description"] and not ctx["resume_included"]
    assert ctx["version"] is None and ctx["guide"] is None and "No resume" in ctx["notes"][0]
    assert ctx["interview_stage"] == "Interview" and ctx["title"] == "Initech — Backend Engineer, Payments"


def test_the_copilot_answers_from_the_jobs_documents(client: TestClient) -> None:
    """The context reaches the prompt: the job post and the version sent as grounding facts, the company (and its
    guide), the role and the round."""
    h = _register(client)
    eid, _ = _job(client, h)
    _sent(client, h, eid)
    client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"round_type": "technical", "round_number": 2})
    ctx = client.post(f"/v1/jobs/tracker/{eid}/session-context", headers=h).json()
    fields = {k: ctx[k] for k in ("title", "role", "company", "interview_stage", "key_requirements", "tech_stack",
                                  "document_ids")}
    r = client.post("/v1/sessions", headers=h, json={**fields, "application_id": eid})
    assert r.status_code == 201, r.text
    session = r.json()
    assert session["application_id"] == eid and set(session["document_ids"]) == set(ctx["document_ids"])

    llm = get_llm_provider()
    assert isinstance(llm, MockLLMProvider)
    before = len(llm.requests)
    ticket = client.post(f"/v1/sessions/{session['id']}/live-ticket", headers=h).json()["ticket"]
    with client.websocket_connect(f"/v1/sessions/{session['id']}/live?ticket={ticket}") as ws:
        _collect(ws, lambda ev: any(e["type"] == "session.started" for e in ev))
        ws.send_text(json.dumps({"type": "chat.message", "data": {
            "text": "How would you cut p95 latency on our payment retry flow with Redis caching?"}}))
        done = _collect(ws, lambda ev: any(e["type"] == "answer.completed" for e in ev))
    used = next(e for e in done if e["type"] == "answer.completed")["data"]["answer"]["context_used"]
    prompt = next(r.messages[1].content for r in reversed(llm.requests[before:])
                  if r.request_type in ("chat", "answer"))
    assert "Cut p95 latency from 900 ms to 250 ms with Redis caching" in prompt  # the resume as sent
    assert "idempotent payment retry flows" in prompt  # the job post
    assert "Company: Razorpay" in prompt and "Razorpay's interviewers listen for" in prompt  # its guide
    assert "Target role: Backend Engineer, Payments" in prompt and "Round 2 · Technical round" in prompt
    assert any(u.startswith("resume:") for u in used) and any(u.startswith("JD:") for u in used)


def test_a_session_takes_only_your_own_job(client: TestClient) -> None:
    a, b = _register(client), _register(client)
    eid, _ = _job(client, a)
    r = client.post("/v1/sessions", headers=b, json={"title": "Mine", "application_id": eid})
    assert r.status_code == 404
    base = f"/v1/jobs/tracker/{eid}"
    assert client.get(f"{base}/interview", headers=b).status_code == 404
    assert client.put(f"{base}/interview", headers=b, json={"round_number": 3}).status_code == 404
    assert client.post(f"{base}/session-context", headers=b).status_code == 404
    assert client.post(f"{base}/interview/questions", headers=b).status_code == 404
    mine = client.post("/v1/sessions", headers=a, json={"title": "Round", "application_id": eid}).json()["id"]
    assert client.post(f"{base}/wrap-up", headers=b, json={"session_id": mine, "outcome": "offer"}).status_code == 404
    # B's own job can't take A's resume, version or session either.
    theirs, _ = _job(client, b, company="Initech")
    rid, sid = _sent(client, a, eid)
    assert client.put(f"/v1/jobs/tracker/{theirs}/interview", headers=b, json={"resume_id": rid}).status_code == 404
    assert client.put(f"/v1/jobs/tracker/{theirs}/interview", headers=b, json={"version": sid}).status_code == 404
    assert client.post(f"/v1/jobs/tracker/{theirs}/wrap-up", headers=b,
                       json={"session_id": mine, "outcome": "offer"}).status_code == 404


def test_the_wrap_up_moves_the_job_only_as_told(client: TestClient) -> None:
    h = _register(client)
    eid, _ = _job(client, h)
    client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"round_type": "hr", "round_number": 1})
    sid = client.post("/v1/sessions", headers=h, json={"title": "Razorpay HR", "company": "Razorpay",
                                                       "application_id": eid}).json()["id"]
    client.post(f"/v1/sessions/{sid}/end", headers=h)
    entry = next(e for e in client.get("/v1/jobs/tracker", headers=h).json() if e["id"] == eid)
    assert entry["status"] == "applied"  # ending the round moves nothing
    assert entry["last_round"]["id"] == sid and entry["last_round"]["practice"] is False
    nxt = (datetime.now(UTC) + timedelta(days=6)).replace(microsecond=0)
    v = client.post(f"/v1/jobs/tracker/{eid}/wrap-up", headers=h, json={
        "session_id": sid, "outcome": "next_round", "round_type": "technical", "at": nxt.isoformat()}).json()
    assert v["status"] == "interviewing" and v["round"]["label"] == "Round 2 · Technical round"
    assert datetime.fromisoformat(v["round"]["at"]) == nxt
    assert [r["id"] for r in v["rounds"]] == [sid] and v["rounds"][0]["stage"] is None
    # Waiting to hear: no round coming up, and a date (if any) is a follow-up's.
    later = nxt + timedelta(days=3)
    v = client.post(f"/v1/jobs/tracker/{eid}/wrap-up", headers=h,
                    json={"session_id": sid, "outcome": "waiting", "at": later.isoformat()}).json()
    assert v["status"] == "interviewing" and v["round"]["label"] == "" and v["round"]["at"] is not None
    # Then invited after all: without a round number set, the next is counted from the live rounds held.
    v = client.post(f"/v1/jobs/tracker/{eid}/wrap-up", headers=h,
                    json={"session_id": sid, "outcome": "next_round"}).json()
    assert v["round"]["label"] == "Round 2" and v["round"]["at"] is None
    assert client.post(f"/v1/jobs/tracker/{eid}/wrap-up", headers=h,
                       json={"session_id": sid, "outcome": "offer"}).json()["status"] == "offer"
    assert client.post(f"/v1/jobs/tracker/{eid}/wrap-up", headers=h,
                       json={"session_id": sid, "outcome": "rejected"}).json()["status"] == "rejected"
    # A session that wasn't started from this job can't wrap it up.
    loose = client.post("/v1/sessions", headers=h, json={"title": "Other"}).json()["id"]
    assert client.post(f"/v1/jobs/tracker/{eid}/wrap-up", headers=h,
                       json={"session_id": loose, "outcome": "offer"}).status_code == 404


def test_rounds_count_by_the_job_before_the_company_name(client: TestClient) -> None:
    h = _register(client)
    first, _ = _job(client, h)
    second, _ = _job(client, h)  # another Razorpay job
    for title, app in (("For the first", first), ("Named Razorpay", None)):
        sid = client.post("/v1/sessions", headers=h, json={"title": title, "company": "Razorpay",
                                                           **({"application_id": app} if app else {})}).json()["id"]
        client.post(f"/v1/sessions/{sid}/end", headers=h)

    def titles(eid: str) -> list[str]:
        return sorted(e["detail"] for e in client.get(f"/v1/jobs/tracker/{eid}/timeline", headers=h).json()
                      if e["kind"] == "round")

    assert titles(first) == ["For the first", "Named Razorpay"]
    assert titles(second) == ["Named Razorpay"]  # the first's round isn't the second job's
    # Leaving the tracker unlinks the job's sessions; the sessions stay.
    assert client.delete(f"/v1/jobs/tracker/{first}", headers=h).status_code == 204

    async def linked() -> int:
        async with sessionmaker()() as db:
            return int(await db.scalar(select(func.count()).select_from(LiveSessionRow)
                                       .where(LiveSessionRow.application_id == first)) or 0)
    assert run(client, linked) == 0
    assert any(s["title"] == "For the first" for s in client.get("/v1/sessions", headers=h).json())


def test_the_questions_come_from_the_version_sent(client: TestClient) -> None:
    h = _register(client)
    eid, _ = _job(client, h)
    r = client.post(f"/v1/jobs/tracker/{eid}/interview/questions", headers=h)
    assert r.status_code == 409 and "resume" in r.json()["detail"]
    _sent(client, h, eid)
    r = client.post(f"/v1/jobs/tracker/{eid}/interview/questions", headers=h)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["questions"] and any(g["kind"] == "job" for g in out["groups"])
    # Kept on the job: the prep view has them again, without asking for them again.
    saved = client.get(f"/v1/jobs/tracker/{eid}/interview", headers=h).json()["questions"]
    assert saved["result"] == out and saved["stale"] is False and saved["generated_at"]
    # Prepared from another version than the one used now: said, still shown.
    rid = make_resume(client, h)
    v = client.put(f"/v1/jobs/tracker/{eid}/interview", headers=h, json={"resume_id": rid}).json()
    assert v["questions"]["result"] == out and v["questions"]["stale"] is True


@pytest.mark.usefixtures("enforce")
def test_the_questions_spend_one_resume_credit(client: TestClient) -> None:
    h = _signup(client, _new_ip())
    assert _wallet(client, h)["resume"] == 1
    eid, _ = _job(client, h)
    r = client.post(f"/v1/jobs/tracker/{eid}/interview/questions", headers=h)
    assert r.status_code == 409 and _wallet(client, h)["resume"] == 1  # nothing to prepare from: nothing spent
    _sent(client, h, eid)
    assert client.post(f"/v1/jobs/tracker/{eid}/interview/questions", headers=h).status_code == 200
    assert _wallet(client, h)["resume"] == 0
    # Seeing them again is free; asking again (Regenerate) is another credit.
    assert client.get(f"/v1/jobs/tracker/{eid}/interview", headers=h).json()["questions"]["result"]["questions"]
    assert _wallet(client, h)["resume"] == 0
    r = client.post(f"/v1/jobs/tracker/{eid}/interview/questions", headers=h)
    assert r.status_code == 402 and r.json()["detail"]["code"] == "upgrade_required"
    assert client.get(f"/v1/jobs/tracker/{eid}/interview", headers=h).json()["questions"] is not None


def test_the_migration_adds_and_removes_the_links() -> None:
    api = Path(__file__).resolve().parents[1]
    db = Path(tempfile.mkdtemp(prefix="orbit-interview-")) / "m.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    def cols(table: str) -> set[str]:
        with sqlite3.connect(db) as conn:
            return {r[1] for r in conn.execute(f"pragma table_info({table})")}

    alembic("upgrade", "head")
    assert "application_id" in cols("sessions") and "origin" in cols("documents")
    assert {"round_type", "round_number", "interview_version", "interview_questions"} <= cols("job_applications")
    alembic("downgrade", "467956f519dd")  # the revision before this one (later ones sit on top of it)
    assert "application_id" not in cols("sessions") and "origin" not in cols("documents")
    assert not {"round_type", "interview_questions"} & cols("job_applications")
    alembic("upgrade", "head")
