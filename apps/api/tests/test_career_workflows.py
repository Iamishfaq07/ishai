"""Privacy and outcome regressions across connected career workflows."""
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.job_portal.resume_performance import _stats
from orbit_api.models import ApplicationStageEvent, CareerEvidenceShare, JobApplication
from tests.business_helpers import db_call
from tests.test_career_workspace import account


def tracked(client: TestClient, headers: dict[str, str]) -> str:
    result = client.post("/v1/jobs/tracker/manual", headers=headers,
        json={"company": "Example", "title": "Backend Engineer", "status": "applied", "notes": "Private prep notes"})
    assert result.status_code == 201, result.text
    return str(result.json()["id"])


def test_stage_events_keep_interviews_after_rejection_and_are_private(client: TestClient) -> None:
    h, other = account(client), account(client)
    entry = tracked(client, h)
    for stage in ("interviewing", "rejected"):
        assert client.patch(f"/v1/jobs/tracker/{entry}", headers=h, json={"status": stage}).status_code == 200

    async def check(db: AsyncSession) -> None:
        rows = list(await db.scalars(select(ApplicationStageEvent).where(
            ApplicationStageEvent.application_id == entry).order_by(ApplicationStageEvent.created_at)))
        assert [r.to_status for r in rows] == ["applied", "interviewing", "rejected"]
        job = await db.get(JobApplication, entry)
        assert job is not None
        stats = _stats([job], {entry: {r.to_status for r in rows}})
        assert stats["interviews"] == stats["heard_back"] == 1
        assert stats["interview_rate"] is None  # still enforce the minimum sample
    db_call(client, check)
    events = client.get(f"/v1/jobs/tracker/{entry}/timeline", headers=h).json()
    assert [e["title"] for e in events if e["kind"] == "stage"] == ["Interviewing", "Not this time"]
    assert client.get(f"/v1/jobs/tracker/{entry}/timeline", headers=other).status_code == 404
    exported = client.get("/v1/auth/me/export", headers=h).json()
    assert len(exported["application_stage_events"]) == 3
    assert client.delete(f"/v1/jobs/tracker/{entry}", headers=h).status_code == 204
    assert client.get("/v1/auth/me/export", headers=h).json()["application_stage_events"] == []


def test_prep_download_owned_and_explicit(client: TestClient) -> None:
    h, other = account(client), account(client)
    entry = tracked(client, h)
    path = f"/v1/career/prep-pack/{entry}"
    assert client.get(path).status_code == 401
    assert client.get(path, headers=other).status_code == 404
    pack = client.get(path, headers=h).json()
    assert "Private prep notes" in str(pack["sections"])
    assert "Backend Engineer" in pack["title"]


def test_share_is_explicit_escaped_owned_expiring_and_revocable(client: TestClient) -> None:
    h, other = account(client), account(client)
    payload = {"title": "SQL project",
               "content": '<script>alert("x")</script> Synthetic project evidence and actual test output.'}
    result = client.post("/v1/career/evidence-shares", headers=h, json=payload)
    assert result.status_code == 201, result.text
    share = result.json()
    public = client.get(share["path"])
    assert public.status_code == 200
    assert "<script>" not in public.text and "&lt;script&gt;" in public.text
    assert public.headers["cache-control"] == "no-store"
    assert "frame-ancestors 'none'" in public.headers["content-security-policy"]
    assert client.get("/v1/career/evidence-shares", headers=other).json() == []
    assert client.delete(f"/v1/career/evidence-shares/{share['id']}", headers=other).status_code == 404
    exported = client.get("/v1/auth/me/export", headers=h).json()["career_evidence_shares"][0]
    assert "token_hash" not in exported and exported["content"] == payload["content"]

    async def expire(db: AsyncSession) -> None:
        await db.execute(update(CareerEvidenceShare).where(CareerEvidenceShare.id == share["id"])
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
        await db.commit()
    db_call(client, expire)
    assert client.get(share["path"]).status_code == 404
    fresh = client.post("/v1/career/evidence-shares", headers=h, json=payload).json()
    assert client.delete(f"/v1/career/evidence-shares/{fresh['id']}", headers=h).status_code == 204
    assert client.get(fresh["path"]).status_code == 404
    assert client.get("/v1/career/evidence-shares/view/guess").status_code == 404


def test_account_deletion_removes_progress_and_revokes_shared_excerpts(client: TestClient) -> None:
    from orbit_api.models import CareerWorkspaceState

    h = account(client)
    entry = tracked(client, h)
    assert client.put("/v1/career/workspace/readiness", headers=h,
                      json={"revision": 0, "data": [{"skill": "SQL", "evidence": []}]}).status_code == 200
    share = client.post("/v1/career/evidence-shares", headers=h,
        json={"title": "My project", "content": "A synthetic practice project with a reviewed public excerpt."}).json()
    user_id = client.get("/v1/auth/me", headers=h).json()["id"]
    assert client.request("DELETE", "/v1/auth/me", headers=h,
                          json={"password": "a strong workspace password"}).status_code == 204
    assert client.get(share["path"]).status_code == 404

    async def check(db: AsyncSession) -> None:
        assert await db.get(CareerWorkspaceState, (user_id, "readiness")) is None
        assert await db.get(CareerEvidenceShare, share["id"]) is None
        assert await db.scalar(select(ApplicationStageEvent).where(
            ApplicationStageEvent.application_id == entry)) is None
    db_call(client, check)
