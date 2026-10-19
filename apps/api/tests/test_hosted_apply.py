"""Hosted personal applications: real planner/leases/receipts, with no external job submission."""
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import delete, select, update

from orbit_api.auto_apply import planner, resolve
from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.job_portal import ranking
from orbit_api.models import ApplicationPacket, ApplyWorkerHeartbeat, AutoApplySetup, JobApplication, Resume, User
from tests.autoapply_helpers import account, form_transport, setup_body, user_id, verify_email
from tests.test_api import _register
from tests.test_auto_apply import _clear_apply, packet_row, plan
from tests.test_jobs import _clear_jobs, _listing, insert, run

SECRET = "hosted-test-worker-" + "s" * 32
WORKER = {"X-Orbit-Worker-Secret": SECRET}
BASE = "/v1/internal/apply"
WORKER_ID = "test-hosted-worker-001"


@pytest.fixture
def hosted(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    run(client, _clear_jobs)
    run(client, _clear_apply)
    _register(client)
    monkeypatch.setattr(get_settings(), "hosted_apply", True)
    monkeypatch.setattr(get_settings(), "apply_worker_secret", SecretStr(SECRET))
    monkeypatch.setattr(planner, "FORM_TRANSPORT", form_transport())
    ranking.clear_cache()

    async def clear() -> None:
        async with sessionmaker()() as db:
            await db.execute(delete(ApplyWorkerHeartbeat))
            await db.commit()

    run(client, clear)
    yield client
    ranking.clear_cache()
    run(client, _clear_apply)


def candidate(c: TestClient, **setup: Any) -> tuple[dict[str, str], str, str]:
    h, rid = account(c)
    uid = user_id(c, h)
    verify_email(c, uid)
    r = c.put("/v1/apply/setup", headers=h, json=setup_body(rid, execution="hosted", hosted_consent=True, **setup))
    assert r.status_code == 200, r.text
    row = _listing(source="jsearch", company="Hosted Example", external_id="workday-001",
        url="https://example.wd5.myworkdayjobs.com/en-US/External/job/Bengaluru/Engineer_R001",
        apply_url="https://example.wd5.myworkdayjobs.com/en-US/External/job/Bengaluru/Engineer_R001",
        description="Build Python PostgreSQL AWS services and REST APIs. " * 8,
        keywords=["Python", "PostgreSQL", "AWS", "REST APIs"], salary=None)
    insert(c, row)
    assert plan(c, h)["created"] == 1
    return h, rid, uid


def lease(c: TestClient) -> dict[str, Any]:
    r = c.post(f"{BASE}/next", headers=WORKER, json={"worker_id": WORKER_ID})
    assert r.status_code == 200, r.text
    return dict(r.json())


def post(c: TestClient, item: dict[str, Any], action: str, **extra: Any) -> Any:
    return c.post(f"{BASE}/{item['packet']['id']}/{action}", headers=WORKER, json={"token": item["token"], **extra})


def submitted(item: dict[str, Any]) -> dict[str, Any]:
    return {"status": "submitted", "confirmation_text": "Your application has been submitted.",
        "final_url": item["packet"]["job"]["apply_url"], "submitted": {"fields": {"email": "asha@example.com"}}}


def edit(c: TestClient, model: Any, condition: Any, **values: Any) -> None:
    async def go() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(model).where(condition).values(**values))
            await db.commit()
    run(c, go)


def test_hosted_requires_explicit_consent_and_worker_auth(hosted: TestClient) -> None:
    c = hosted
    h, rid = account(c)
    verify_email(c, user_id(c, h))
    body = setup_body(rid, execution="hosted")
    assert c.put("/v1/apply/setup", headers=h, json=body).status_code == 422
    assert c.post(f"{BASE}/next", headers=h, json={"worker_id": WORKER_ID}).status_code == 401
    wrong = c.post(f"{BASE}/next", headers={"X-Orbit-Worker-Secret": "wrong"}, json={"worker_id": WORKER_ID})
    assert wrong.status_code == 403
    assert c.get("/v1/apply/setup", headers=h).json()["execution"] == "browser"


def test_hosted_closed_browser_cycle_receipt_and_idempotency(hosted: TestClient) -> None:
    c = hosted
    h, _, uid = candidate(c)
    assert not c.get("/v1/apply/setup", headers=h).json()["hosted_online"]
    item = lease(c)
    pid = item["packet"]["id"]
    assert item["packet"]["job"]["ats"] == "workday"
    assert item["packet"]["job"]["apply_url"].endswith("/apply")
    assert c.get("/v1/apply/setup", headers=h).json()["hosted_online"]
    assert c.get("/v1/apply/next", headers=h).status_code == 204  # The extension cannot take hosted work.
    assert c.post(f"{BASE}/next", headers=WORKER, json={"worker_id": "another-worker-002"}).status_code == 204
    pdf = c.get(f"{BASE}/{pid}/resume.pdf", headers={**WORKER, "X-Orbit-Attempt": item["token"]})
    assert pdf.content.startswith(b"%PDF-")
    assert post(c, item, "result", result=submitted(item)).status_code == 422  # No click checkpoint yet.
    assert post(c, item, "submit").status_code == 200
    assert post(c, item, "submit").status_code == 409  # Never arm this same click twice.
    receipt = post(c, item, "result", result=submitted(item))
    assert receipt.status_code == 200, receipt.text
    assert receipt.json()["status"] == "submitted" and receipt.json()["charged"]
    assert post(c, item, "result", result=submitted(item)).json() == receipt.json()
    detail = c.get(f"/v1/apply/packets/{pid}", headers=h).json()
    assert detail["has_proof"] and detail["tracker_id"] and not detail["submission_uncertain"]

    async def count() -> int:
        async with sessionmaker()() as db:
            return len((await db.scalars(select(JobApplication).where(JobApplication.user_id == uid))).all())
    assert run(c, count) == 1


@pytest.mark.parametrize("change", ["pause", "withdraw", "suspend", "unverify", "resume_changed", "kill_site"])
def test_revocation_before_submission_stops_worker(hosted: TestClient, change: str) -> None:
    c = hosted
    h, rid, uid = candidate(c)
    item = lease(c)
    if change == "pause":
        assert c.post("/v1/apply/pause", headers=h).status_code == 200
    elif change == "withdraw":
        body = setup_body(rid, consent=False)
        assert c.put("/v1/apply/setup", headers=h, json=body).status_code == 200
    elif change == "suspend":
        edit(c, User, User.id == uid, suspended_at=datetime.now(UTC))
    elif change == "unverify":
        edit(c, User, User.id == uid, email_verified=False)
    elif change == "resume_changed":
        data = c.get(f"/v1/resumes/{rid}", headers=h).json()["data"]
        data["basics"]["name"] = "Updated name"
        edit(c, Resume, Resume.id == rid, data=data)
    else:
        from orbit_api.models import ApplySiteState

        async def kill() -> None:
            async with sessionmaker()() as db:
                db.add(ApplySiteState(site="workday", admin_paused=True))
                await db.commit()
        run(c, kill)
    assert post(c, item, "check").json() == {"allowed": False}
    assert post(c, item, "submit").status_code == 409


def test_crash_after_submit_is_not_requeued_and_late_proof_is_taken(hosted: TestClient) -> None:
    c = hosted
    h, _, _ = candidate(c)
    item = lease(c)
    pid = item["packet"]["id"]
    assert post(c, item, "submit").status_code == 200
    edit(c, ApplicationPacket, ApplicationPacket.id == pid, lease_until=datetime.now(UTC) - timedelta(seconds=1))
    c.get("/v1/apply/packets", headers=h)  # Expire/recover the lease as the normal app and sweeper do.
    p = packet_row(c, pid)
    assert p.status == "needs_you" and p.charge is None
    assert c.post(f"{BASE}/next", headers=WORKER, json={"worker_id": WORKER_ID}).status_code == 204
    assert c.post(f"/v1/apply/packets/{pid}/retry", headers=h).status_code == 409
    assert post(c, item, "result", result=submitted(item)).status_code == 200
    assert packet_row(c, pid).status == "submitted"


def test_unknown_questions_use_confirmed_facts_without_invention(hosted: TestClient) -> None:
    c = hosted
    h, _, _ = candidate(c)
    item = lease(c)
    q = [{"label": "Are you legally authorized to work in India?", "kind": "select", "options": ["Yes", "No"]}]
    r = post(c, item, "questions", questions=q)
    assert r.status_code == 200, r.text
    assert r.json()["missing"] == []
    assert r.json()["answers"][0]["value"] == "Yes"
    unknown = [{"label": "Describe your quantum cryptography certification", "kind": "textarea"}]
    r = post(c, item, "questions", questions=unknown)
    assert len(r.json()["missing"]) == 1 and not r.json()["answers"]
    r = post(c, item, "result", result={"status": "needs_you", "reason": "unknown_question",
                                     "unknown_questions": unknown})
    assert r.status_code == 200 and not r.json()["charged"]
    detail = c.get(f"/v1/apply/packets/{item['packet']['id']}", headers=h).json()
    assert detail["missing_questions"][0]["label"] == unknown[0]["label"]


def test_attempt_fencing_and_resume_rebuild(hosted: TestClient) -> None:
    c = hosted
    h, rid, uid = candidate(c)
    item = lease(c)
    wrong = {**item, "token": "x" * 43}
    assert post(c, wrong, "submit").status_code == 409
    assert post(c, wrong, "result", result=submitted(item)).status_code == 409
    assert c.post(f"/v1/apply/{item['packet']['id']}/result", headers=h, json=submitted(item)).status_code == 409
    assert post(c, item, "result", result={"status": "needs_you", "reason": "login"}).status_code == 200
    data = c.get(f"/v1/resumes/{rid}", headers=h).json()["data"]
    data["basics"]["name"] = "Asha Updated"
    edit(c, Resume, Resume.id == rid, data=data)
    body = setup_body(rid, execution="hosted", hosted_consent=True)
    assert c.put("/v1/apply/setup", headers=h, json=body).status_code == 200
    r = c.post(f"/v1/apply/packets/{item['packet']['id']}/retry", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ready"
    p = packet_row(c, item["packet"]["id"])
    async def approved_hash() -> str | None:
        async with sessionmaker()() as db:
            setup = await db.get(AutoApplySetup, uid)
            return planner.approval_fingerprint(setup, await planner.load_bank(db, uid))
    assert p.approval_fingerprint == run(c, approved_hash)
    assert not p.hosted_token


def test_two_workers_cannot_lease_the_same_candidate_concurrently(hosted: TestClient) -> None:
    c = hosted
    candidate(c)
    def take(n: int) -> int:
        return c.post(f"{BASE}/next", headers=WORKER, json={"worker_id": f"racing-worker-000{n}"}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(take, [1, 2]))
    assert sorted(results) == [200, 204]


def test_export_includes_candidate_apply_data_but_never_worker_attempt_tokens(hosted: TestClient) -> None:
    c = hosted
    h, _, _ = candidate(c)
    item = lease(c)
    r = c.get("/v1/auth/me/export", headers=h)
    assert r.status_code == 200, r.text
    data = r.json()["job_search"]["auto_apply"]
    assert data["setup"]["execution"] == "hosted"
    assert data["applications"][0]["id"] == item["packet"]["id"]
    assert item["token"] not in r.text and SECRET not in r.text


@pytest.mark.parametrize("previous_campaign", [False, True])
def test_hired_outcome_pauses_this_search_but_not_a_later_campaign(hosted: TestClient, previous_campaign: bool) -> None:
    c = hosted
    h, _, uid = candidate(c)
    item = lease(c)
    async def hired() -> None:
        async with sessionmaker()() as db:
            db.add(JobApplication(user_id=uid, listing_id="ext:" + uuid.uuid4().hex, source="manual",
                company="New Employer", title="Engineer", url="https://employer.example/job", apply_url="",
                status="hired",
                status_at=datetime.now(UTC) - (timedelta(days=1) if previous_campaign else timedelta())))
            await db.commit()
    run(c, hired)
    assert post(c, item, "check").json()["allowed"] is previous_campaign
    assert c.get("/v1/apply/setup", headers=h).json()["paused"] is not previous_campaign
    if not previous_campaign:
        assert post(c, item, "submit").status_code == 409
        assert c.post("/v1/apply/resume", headers=h).status_code == 200
        assert post(c, item, "check").json()["allowed"]  # Explicit Resume starts a later search.


@pytest.mark.parametrize("change, expected", [("review", "review"), ("exclude", "skipped"), ("bank", "ready")])
def test_queued_applications_rebuild_after_approval_changes(hosted: TestClient, change: str, expected: str) -> None:
    c = hosted
    h, rid, _ = candidate(c)
    if change == "bank":
        r = c.put("/v1/apply/bank", headers=h, json=[{"norm": "approved custom note", "label": "Approved custom note",
                                                   "value": "I approved this new answer."}])
    else:
        body = setup_body(rid, execution="hosted", hosted_consent=True)
        if change == "review":
            body["mode"] = "review"
        else:
            body["filters"]["exclude_companies"] = ["Hosted Example"]
        r = c.put("/v1/apply/setup", headers=h, json=body)
    assert r.status_code == 200, r.text
    r = c.post(f"{BASE}/next", headers=WORKER, json={"worker_id": WORKER_ID})
    assert r.status_code == 204, r.text
    rows = c.get("/v1/apply/packets", headers=h).json()
    assert rows[0]["status"] == expected
    assert packet_row(c, rows[0]["id"]).charge is None


def test_changes_during_filling_cannot_submit_old_facts(hosted: TestClient) -> None:
    c = hosted
    h, rid, _ = candidate(c)
    item = lease(c)
    body = setup_body(rid, execution="hosted", hosted_consent=True)
    body["facts"]["phone"] = "+91 9000000000"
    assert c.put("/v1/apply/setup", headers=h, json=body).status_code == 200
    assert post(c, item, "check").json() == {"allowed": False}
    assert post(c, item, "submit").status_code == 409
    r = post(c, item, "result", result={"status": "needs_you", "reason": "error"})
    assert r.status_code == 200 and r.json()["status"] == "ready" and not r.json()["charged"]
    p = packet_row(c, item["packet"]["id"])
    assert p.fields["phone"] == "+91 9000000000" and not p.submission_started_at


@pytest.mark.parametrize(("url", "ats"), [
    ("https://jobs.smartrecruiters.com/Example/744000123456789-engineer?source=x", "smartrecruiters"),
    ("https://apply.workable.com/example/j/A123BC/", "workable"),
    ("https://example.recruitee.com/o/backend-engineer", "recruitee"),
    ("https://example.wd1.myworkdaysite.com/recruiting/example/Careers/job/Engineer_R1", "workday"),
])
def test_new_employer_sites_resolve(url: str, ats: str) -> None:
    t = resolve.from_url(url)
    assert t and t.automatic and t.ats == ats


@pytest.mark.parametrize("url", ["https://evilgreenhouse.io/acme/jobs/123", "https://apply.workable.com.evil.test/acme/j/A1/",
    "https://acme.wd5.myworkdayjobs.com.evil.test/en-US/Careers/job/1", "http://acme.recruitee.com/o/engineer"])
def test_lookalikes_never_become_automatic(url: str) -> None:
    t = resolve.from_url(url)
    assert t is None or not t.automatic
