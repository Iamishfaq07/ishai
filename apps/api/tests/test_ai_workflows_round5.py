"""What's working by resume, and the first-90-days plan once an offer or a hire is recorded."""
import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import update

from orbit_api.db import sessionmaker
from orbit_api.models import JobApplication, Resume
from tests.autoapply_helpers import make_resume
from tests.test_api import _register
from tests.test_job_alerts import _me, _verify
from tests.test_jobs import _listing, insert, jobs, run  # noqa: F401  (the fixture)


def _set(client: TestClient, model: Any, row_id: str, **values: Any) -> None:
    async def go() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(model).where(model.id == row_id).values(**values))
            await db.commit()
    run(client, go)


def _applied(client: TestClient, h: dict[str, str], resume_id: str, status: str = "applied") -> str:
    r = client.post("/v1/jobs/tracker/manual", headers=h, json={
        "title": "Platform engineer", "company": f"Co {uuid.uuid4().hex[:8]}", "status": "applied"})
    assert r.status_code == 201, r.text
    jid = str(r.json()["id"])
    _set(client, JobApplication, jid, resume_id=resume_id, status=status)
    return jid


def test_resume_performance_groups_copies_under_their_source_and_needs_a_sample(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    master = make_resume(jobs, h)
    copy = make_resume(jobs, h)
    _set(jobs, Resume, copy, title="Master CV · Northstar", job_text="Backend role at Northstar " * 5)
    other = make_resume(jobs, h)
    _set(jobs, Resume, other, title="Design CV")
    for status in ("interviewing", "rejected", "applied", "applied", "offer"):
        _applied(jobs, h, copy, status)
    _applied(jobs, h, other, "applied")
    out = jobs.get("/v1/jobs/resume-performance", headers=h).json()
    rows = {g["title"]: g for g in out["by_resume"]}
    assert rows["Master CV"]["applied"] == 5 and rows["Master CV"]["heard_back"] == 3
    assert rows["Master CV"]["interviews"] == 2 and rows["Master CV"]["response_rate"] == 60
    assert rows["Design CV"]["enough"] is False and rows["Design CV"]["response_rate"] is None
    assert out["tailored"]["applied"] == 5 and out["general"]["applied"] == 1
    assert master  # the copy's title names it, so the copy counts under it
    assert jobs.get("/v1/jobs/resume-performance", headers=_register(jobs)).json()["applied"] == 0


def test_first_ninety_needs_an_offer_and_a_job_post(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    _verify(jobs, _me(jobs, h)["id"])
    make_resume(jobs, h)
    (listing,) = insert(jobs, _listing(company="Northstar", description="Build and run payment services. " * 10))
    entry = jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": listing}).json()["id"]
    assert jobs.post(f"/v1/jobs/tracker/{entry}/first-90", headers=h).status_code == 409  # saved, not an offer
    _set(jobs, JobApplication, entry, status="offer")
    r = jobs.post(f"/v1/jobs/tracker/{entry}/first-90", headers=h)
    assert r.status_code == 200, r.text
    plan = r.json()
    assert [p["name"] for p in plan["phases"]] == ["First two weeks", "By day 30", "By day 60", "By day 90"]
    assert plan["people"] and plan["questions"] and plan["early_win"]
    other = _register(jobs)
    _verify(jobs, _me(jobs, other)["id"])
    assert jobs.post(f"/v1/jobs/tracker/{entry}/first-90", headers=other).status_code == 404
