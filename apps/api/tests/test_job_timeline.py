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
    assert {"fit", "contact", "outreach", "applied", "round", "stage"} <= set(kinds)
    fit = next(e for e in events if e["kind"] == "fit")
    assert fit["detail"] == "Good fit"
    contact = next(e for e in events if e["kind"] == "contact")
    assert contact["detail"] == "Priya (recruiter)"
    rounds = [e for e in events if e["kind"] == "round"]
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
