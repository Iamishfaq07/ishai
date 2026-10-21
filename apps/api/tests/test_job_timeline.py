"""A tracked job's journey: saved, fit checks, contacts and outreach, applied, rounds with the company (practice and
live sessions since it was saved), the current stage and what's next; oldest first, and only the owner's."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.db import sessionmaker
from orbit_api.models import JobContact, JobFitCheck, LiveSessionRow
from tests.test_api import _register
from tests.test_jobs import _listing, insert, jobs, run  # noqa: F401  (the fixture)


def test_a_tracked_jobs_journey_in_order_and_private(jobs: TestClient) -> None:  # noqa: F811
    h, other = _register(jobs), _register(jobs)
    me = jobs.get("/v1/auth/me", headers=h).json()["id"]
    lid = insert(jobs, _listing(title="Backend Engineer", company="Groww"))[0]
    entry = jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": lid}).json()["id"]
    jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": lid, "status": "applied"})
    soon = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    jobs.patch(f"/v1/jobs/tracker/{entry}", headers=h, json={"status": "interviewing", "next_at": soon})
    ended = str(uuid.uuid4())

    async def add() -> None:
        async with sessionmaker()() as db:
            db.add(JobFitCheck(user_id=me, listing_id=lid, resume_hash="x", result={"verdict": "Good"}))
            db.add(JobContact(user_id=me, name="Priya", company="Groww", relation="recruiter", application_id=entry,
                              last_contacted_at=datetime.now(UTC)))
            db.add_all([
                LiveSessionRow(id=ended, user_id=me, title="Groww round 1", type="interview", status="ended",
                               company="groww", started_at=datetime.now(UTC)),
                LiveSessionRow(user_id=me, title="Never started", type="interview", status="created", company="Groww"),
                LiveSessionRow(user_id=me, title="Other company", type="mock", status="ended", company="Zerodha"),
            ])
            await db.commit()

    run(jobs, add)
    r = jobs.get(f"/v1/jobs/tracker/{entry}/timeline", headers=h)
    assert r.status_code == 200, r.text
    events = r.json()
    kinds = [e["kind"] for e in events]
    assert kinds[0] == "saved" and kinds[-1] == "next" and events[-1]["upcoming"] is True
    assert {"fit", "contact", "outreach", "applied", "related_round", "stage"} <= set(kinds)
    fit = next(e for e in events if e["kind"] == "fit")
    assert fit["detail"] == "Good fit"
    contact = next(e for e in events if e["kind"] == "contact")
    assert contact["detail"] == "Priya (recruiter)"
    rounds = [e for e in events if e["kind"] == "related_round"]
    assert [x["detail"] for x in rounds] == ["Groww round 1"] and rounds[0]["link"] == f"/sessions/{ended}"
    assert next(e for e in events if e["kind"] == "stage")["title"] == "Interviewing"
    times = [e["at"] for e in events]
    assert times == sorted(times)
    # Someone else can't read it.
    assert jobs.get(f"/v1/jobs/tracker/{entry}/timeline", headers=other).status_code == 404
    assert jobs.get("/v1/jobs/tracker/nope/timeline", headers=h).status_code == 404


def test_a_just_saved_job_has_one_event(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    lid = insert(jobs, _listing(company="Acme"))[0]
    entry = jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": lid}).json()["id"]
    events: list[dict[str, Any]] = jobs.get(f"/v1/jobs/tracker/{entry}/timeline", headers=h).json()
    assert [e["kind"] for e in events] == ["saved"] and events[0]["detail"] == "Backend Engineer at Acme"


def test_company_match_needs_owned_review_and_cannot_move_between_jobs(jobs: TestClient) -> None:  # noqa: F811
    h, other = _register(jobs), _register(jobs)
    me = jobs.get("/v1/auth/me", headers=h).json()["id"]
    lid = insert(jobs, _listing(company="Groww"))[0]
    entry = jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": lid}).json()["id"]
    second = jobs.post("/v1/jobs/tracker/manual", headers=h,
                       json={"title": "Different role", "company": "Groww"}).json()["id"]
    ended, unfinished, running = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())

    async def add() -> None:
        async with sessionmaker()() as db:
            db.add_all([
                LiveSessionRow(id=ended, user_id=me, title="General Groww practice", type="mock",
                               company="Groww", status="ended"),
                LiveSessionRow(id=unfinished, user_id=me, title="Not finished", type="mock", status="created"),
                LiveSessionRow(id=running, user_id=me, title="In progress", type="mock", status="live",
                               application_id=entry),
            ])
            await db.commit()

    run(jobs, add)
    mission = f"/v1/jobs/tracker/{entry}/mission"
    assert jobs.get(mission, headers=h).json()["practice_rounds"] == 0
    path = f"/v1/jobs/tracker/{entry}/sessions/link"
    body = {"session_id": ended, "confirmed": True}
    assert jobs.post(path, headers=h, json={**body, "confirmed": False}).status_code == 422
    assert jobs.post(path, headers=other, json=body).status_code == 404
    assert jobs.post(f"/v1/jobs/tracker/{second}/sessions/link", headers=other, json=body).status_code == 404
    assert jobs.post(path, headers=h, json={**body, "session_id": unfinished}).status_code == 409
    assert jobs.post(path, headers=h, json=body).status_code == 200
    assert jobs.post(path, headers=h, json=body).status_code == 200  # retry is idempotent
    assert jobs.get(mission, headers=h).json()["practice_rounds"] == 1
    timeline = jobs.get(f"/v1/jobs/tracker/{entry}/timeline", headers=h).json()
    assert len([event for event in timeline if event["kind"] == "round" and event["completed"]]) == 1
    assert not next(event for event in timeline if event["session_id"] == running)["completed"]
    assert jobs.post(f"/v1/jobs/tracker/{second}/sessions/link", headers=h, json=body).status_code == 409
    assert jobs.get(f"/v1/jobs/tracker/{second}/mission", headers=h).json()["practice_rounds"] == 0


def test_a_job_says_where_else_it_is_posted(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    main = _listing(company="Groww", title="Backend Engineer")
    dup = _listing(company="Groww", title="Backend Engineer", source="himalayas", url="https://himalayas.app/jobs/9")
    shady = _listing(company="Groww", title="Backend Engineer", source="remoteok", url="javascript:alert(1)")
    other = _listing(company="Groww", title="Data Analyst")
    a, b, c, _ = insert(jobs, main, dup, shady, other)
    detail = jobs.get(f"/v1/jobs/listings/{a}", headers=h).json()
    also = {x["id"]: x for x in detail["also_listed"]}
    assert set(also) == {b, c}  # the same job elsewhere, not the company's other jobs
    assert also[b]["source_label"] == "Himalayas" and also[b]["direct"] is False
    assert also[b]["url"] == "https://himalayas.app/jobs/9" and also[c]["url"] == ""  # only http(s) links
    assert detail["job"]["direct"] is True and detail["job"]["first_seen_at"]


def test_a_job_carries_its_posting_check_and_visa_line(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    now = datetime.now(UTC)
    redated = _listing(company="Globex", title="Platform Engineer", posted_at=now - timedelta(days=1),
                       created_at=now - timedelta(days=24), visa="not_offered",
                       description="We're always looking for engineers to join our talent pool. " * 10)
    earlier = _listing(company="Globex", title="Platform Engineer", source="himalayas",
                       url="https://himalayas.app/jobs/3", created_at=now - timedelta(days=40))
    a, _ = insert(jobs, redated, earlier)
    detail = jobs.get(f"/v1/jobs/listings/{a}", headers=h).json()
    kinds = [c["kind"] for c in detail["checks"]]
    assert kinds[:4] == ["old", "redated", "earlier", "evergreen"]
    assert detail["checks"][0]["tone"] == "caution"
    assert detail["job"]["visa"] == "not_offered" and detail["job"]["relocation"] is False
