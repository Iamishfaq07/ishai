"""Talent consent boundaries, expiry, permissions, idempotency and reviewed role handoff."""

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from orbit_api.business.talent import NOTICE_VERSION, sweep
from orbit_api.models import BizApplication, BizCompany, BizJob, BizTalentMember, BizTalentSuggestion
from tests.business_helpers import auth, db_call, make_client, new_company, new_job
from tests.test_business_experience import people
from tests.test_business_requisitions import add_member


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def root(cid: str, pid: str = "") -> str:
    return f"/v1/business/companies/{cid}/talent" + (f"/{pid}" if pid else "")


def public(token: str, pid: str = "") -> str:
    return f"/v1/public/business/applications/{token}/talent" + (f"/{pid}" if pid else "")


def setup(client: TestClient) -> Any:
    owner, company, domain = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    assert client.post(f"/v1/business/companies/{cid}/jobs/{job['id']}/publish", headers=auth(owner)).status_code == 200
    pool = client.post(
        root(cid),
        headers=auth(owner),
        json={
            "name": "Future engineering",
            "purpose": "Discover future engineering opportunities at this company.",
            "enabled": True,
            "retention_days": 90,
        },
    )
    assert pool.status_code == 201, pool.text
    candidates = people(client, cid, job["id"], 2)
    return owner, cid, domain, job, pool.json(), candidates


def join(client: TestClient, token: str, pool: dict[str, Any], **over: Any) -> Any:
    return client.put(
        public(token, pool["id"]),
        json={
            "request_id": str(uuid.uuid4()),
            "terms_revision": pool["terms_revision"],
            "notice_version": NOTICE_VERSION,
            "acknowledge": True,
            "skills": ["Python", "Postgres"],
            "interests": "Backend engineering and reliable API development",
            **over,
        },
    )


def members(client: TestClient, owner: Any, cid: str, pid: str, query: str = "") -> Any:
    response = client.get(root(cid, pid) + "/members", headers=auth(owner), params={"q": query})
    assert response.status_code == 200, response.text
    return response.json()["items"]


def test_explicit_consent_search_and_no_application_or_resume_copy(client: TestClient) -> None:
    owner, cid, _, job, pool, candidates = setup(client)
    aid, token = candidates[0]
    assert members(client, owner, cid, pool["id"]) == []
    assert join(client, token, pool, acknowledge=False).status_code == 409
    assert join(client, token, pool, notice_version="old").status_code == 409
    result = join(client, token, pool)
    assert result.status_code == 200, result.text
    assert result.json()["items"][0]["active"]
    items = members(client, owner, cid, pool["id"], "pYtHon")
    assert len(items) == 1 and items[0]["application_id"] == aid
    assert "email" not in items[0] and "resume_text" not in items[0]
    assert members(client, owner, cid, pool["id"], "PRIVATE") == []
    assert members(client, owner, cid, pool["id"], "%") == []
    assert members(client, owner, cid, pool["id"], "_") == []

    async def unchanged(db: Any) -> None:
        app = await db.get(BizApplication, aid)
        assert app.status == "active" and app.job_id == job["id"] and app.resume_text == "PRIVATE RESUME"

    db_call(client, unchanged)


def test_retry_does_not_extend_consent_and_conflicting_request_rejected(client: TestClient) -> None:
    owner, cid, _, _, pool, candidates = setup(client)
    token = candidates[0][1]
    request_id = str(uuid.uuid4())
    first = join(client, token, pool, request_id=request_id).json()
    second = join(client, token, pool, request_id=request_id).json()
    assert second == first
    assert (
        join(
            client, token, pool, request_id=request_id, interests="Different interests in new engineering roles"
        ).status_code
        == 409
    )
    assert len(members(client, owner, cid, pool["id"])) == 1
    assert join(client, token, pool, skills=["Python", "python"]).status_code == 422
    assert join(client, token, pool, skills=["x"]).status_code == 422
    assert join(client, token, pool, terms_revision=True).status_code == 422
    assert join(client, token, pool, acknowledge="true").status_code == 422


def suggestion(client: TestClient, owner: Any, cid: str, pool: Any, mid: str, jid: str) -> Any:
    return client.post(root(cid, pool["id"]) + f"/members/{mid}/suggestions", headers=auth(owner), json={"job_id": jid})


def test_reviewed_portal_suggestion_is_idempotent_and_not_an_application(client: TestClient) -> None:
    owner, cid, _, job, pool, candidates = setup(client)
    aid, token = candidates[0]
    assert join(client, token, pool).status_code == 200
    mid = members(client, owner, cid, pool["id"])[0]["id"]
    first = suggestion(client, owner, cid, pool, mid, job["id"])
    assert first.status_code == 201, first.text
    assert suggestion(client, owner, cid, pool, mid, job["id"]).json() == first.json()
    own = client.get(public(token)).json()["items"][0]
    assert own["suggestions"][0]["href"].endswith(f"/jobs/{job['slug']}")
    assert client.get(own["suggestions"][0]["href"]).status_code != 500

    async def count(db: Any) -> None:
        apps = list(await db.scalars(select(BizApplication).where(BizApplication.id == aid)))
        assert len(apps) == 1 and apps[0].status == "active"
        assert len(list(await db.scalars(select(BizTalentSuggestion).where(BizTalentSuggestion.member_id == mid)))) == 1

    db_call(client, count)
    assert join(client, token, pool).status_code == 200  # Explicit fresh consent clears prior suggestions.
    assert client.get(public(token)).json()["items"][0]["suggestions"] == []


def test_expiry_hides_before_cleanup_and_sweep_deletes_suggestions(client: TestClient) -> None:
    owner, cid, _, job, pool, candidates = setup(client)
    aid, token = candidates[0]
    join(client, token, pool)
    mid = members(client, owner, cid, pool["id"])[0]["id"]
    suggestion(client, owner, cid, pool, mid, job["id"])

    async def expire(db: Any) -> None:
        row = await db.get(BizTalentMember, mid)
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)

    db_call(client, expire)
    assert members(client, owner, cid, pool["id"]) == []
    assert not client.get(public(token)).json()["items"][0]["active"]
    assert suggestion(client, owner, cid, pool, mid, job["id"]).status_code == 404
    assert client.portal.call(sweep) >= 1

    async def removed(db: Any) -> None:
        assert await db.get(BizTalentMember, mid) is None
        assert await db.scalar(select(BizTalentSuggestion).where(BizTalentSuggestion.member_id == mid)) is None
        assert await db.get(BizApplication, aid) is not None

    db_call(client, removed)


def test_leave_works_when_paused_suspended_or_deletion_requested(client: TestClient) -> None:
    owner, cid, _, _, pool, candidates = setup(client)
    aid, token = candidates[0]
    join(client, token, pool)
    mid = members(client, owner, cid, pool["id"])[0]["id"]

    async def restrict(db: Any) -> None:
        company = await db.get(BizCompany, cid)
        company.status = "suspended"
        app = await db.get(BizApplication, aid)
        app.deletion_requested_at = datetime.now(UTC)

    db_call(client, restrict)
    assert join(client, token, pool).status_code == 409
    assert client.delete(public(token, pool["id"])).status_code == 200
    assert client.delete(public(token, pool["id"])).status_code == 200

    async def check(db: Any) -> None:
        assert await db.get(BizTalentMember, mid) is None

    db_call(client, check)


def test_terms_change_wipes_profiles_while_pause_preserves_expiry(client: TestClient) -> None:
    owner, cid, _, _, pool, candidates = setup(client)
    token = candidates[0][1]
    original = join(client, token, pool).json()["items"][0]["membership"]
    paused = client.put(
        root(cid, pool["id"]),
        headers=auth(owner),
        json={
            **{k: pool[k] for k in ("name", "purpose", "retention_days")},
            "enabled": False,
            "base_revision": pool["revision"],
        },
    )
    assert paused.status_code == 200, paused.text
    assert members(client, owner, cid, pool["id"]) == []
    assert client.get(public(token)).json()["items"][0]["membership"] == original
    updated = client.put(
        root(cid, pool["id"]),
        headers=auth(owner),
        json={
            "name": pool["name"],
            "purpose": "A new and materially different community purpose.",
            "retention_days": 90,
            "enabled": True,
            "base_revision": paused.json()["revision"],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["terms_revision"] == 2
    assert client.get(public(token)).json()["items"][0]["membership"] is None
    assert join(client, token, pool).status_code == 409
    assert join(client, token, updated.json()).status_code == 200
    assert (
        client.put(
            root(cid, pool["id"]),
            headers=auth(owner),
            json={
                "name": "Another name",
                "purpose": "A valid but stale purpose for this community.",
                "base_revision": 1,
            },
        ).status_code
        == 409
    )


def test_role_scope_cross_company_and_recruiter_cannot_edit_terms(client: TestClient) -> None:
    owner, cid, _domain, _job, pool, candidates = setup(client)
    for role in ("hiring_manager", "interviewer", "recruiter"):
        member = add_member(client, cid, role)
        response = client.get(root(cid), headers=auth(member))
        assert response.status_code == (200 if role == "recruiter" else 403)
        assert (
            client.post(
                root(cid),
                headers=auth(member),
                json={"name": "Recruiter terms", "purpose": "A valid purpose controlled by administrators."},
            ).status_code
            == 403
        )
    other, ocid, _, otherjob, otherpool, _others = setup(client)
    assert client.get(root(cid), headers=auth(other)).status_code == 404
    assert join(client, candidates[0][1], otherpool).status_code == 404
    join(client, candidates[0][1], pool)
    mid = members(client, owner, cid, pool["id"])[0]["id"]
    assert suggestion(client, owner, cid, pool, mid, otherjob["id"]).status_code == 404
    assert (
        client.get(root(ocid, otherpool["id"]) + f"/members/{mid}/suggestions", headers=auth(other)).status_code == 404
    )


@pytest.mark.parametrize("restriction", ["unconfirmed", "deletion", "paused_job", "taken_down"])
def test_restricted_candidates_and_jobs_cannot_receive_suggestions(client: TestClient, restriction: str) -> None:
    owner, cid, _, job, pool, candidates = setup(client)
    aid, token = candidates[0]
    join(client, token, pool)
    mid = members(client, owner, cid, pool["id"])[0]["id"]

    async def restrict(db: Any) -> None:
        app = await db.get(BizApplication, aid)
        j = await db.get(BizJob, job["id"])
        if restriction == "unconfirmed":
            app.email_confirmed_at = None
        elif restriction == "deletion":
            app.deletion_requested_at = datetime.now(UTC)
        elif restriction == "paused_job":
            j.status = "paused"
        else:
            j.taken_down_reason = "Review"

    db_call(client, restrict)
    assert suggestion(client, owner, cid, pool, mid, job["id"]).status_code == (
        404 if restriction in ("unconfirmed", "deletion") else 409
    )
    if restriction == "unconfirmed":
        assert client.get(public(token)).status_code == 403
    if restriction == "deletion":
        assert members(client, owner, cid, pool["id"]) == []


def test_application_deletion_cascades_profile_and_suggestions(client: TestClient) -> None:
    owner, cid, _, job, pool, candidates = setup(client)
    aid, token = candidates[0]
    join(client, token, pool)
    mid = members(client, owner, cid, pool["id"])[0]["id"]
    suggestion(client, owner, cid, pool, mid, job["id"])

    async def remove(db: Any) -> None:
        await db.execute(delete(BizApplication).where(BizApplication.id == aid))

    db_call(client, remove)
    assert members(client, owner, cid, pool["id"]) == []
    assert client.get(public(token)).status_code == 404

    async def check(db: Any) -> None:
        assert await db.get(BizTalentMember, mid) is None
        assert await db.scalar(select(BizTalentSuggestion).where(BizTalentSuggestion.member_id == mid)) is None

    db_call(client, check)


def test_pagination_uses_current_members_and_paused_role_disappears(client: TestClient) -> None:
    owner, cid, _, job, pool, candidates = setup(client)
    _aid, token = candidates[0]
    join(client, token, pool)
    mid = members(client, owner, cid, pool["id"])[0]["id"]
    suggestion(client, owner, cid, pool, mid, job["id"])

    async def seed(db: Any) -> None:
        source = await db.get(BizTalentMember, mid)
        for candidate_id, _ in people_ids:
            db.add(
                BizTalentMember(
                    pool_id=pool["id"],
                    application_id=candidate_id,
                    terms_revision=1,
                    request_id=str(uuid.uuid4()),
                    notice_sha256=source.notice_sha256,
                    notice_version=source.notice_version,
                    skills=["Python"],
                    interests="Backend engineering",
                    search_text="python backend",
                    expires_at=source.expires_at,
                )
            )

    people_ids = people(client, cid, job["id"], 52)
    db_call(client, seed)
    page1 = client.get(root(cid, pool["id"]) + "/members", headers=auth(owner)).json()
    assert len(page1["items"]) == 50 and page1["next_cursor"]
    page2 = client.get(
        root(cid, pool["id"]) + "/members", headers=auth(owner), params={"after": page1["next_cursor"]}
    ).json()
    assert len(page2["items"]) == 3 and page2["next_cursor"] is None
    assert not ({m["id"] for m in page1["items"]} & {m["id"] for m in page2["items"]})
    assert client.post(f"/v1/business/companies/{cid}/jobs/{job['id']}/pause", headers=auth(owner)).status_code == 200
    assert client.get(public(token)).json()["items"][0]["suggestions"] == []


def test_pool_deletion_cascades_and_does_not_delete_original_application(client: TestClient) -> None:
    owner, cid, _, job, pool, candidates = setup(client)
    aid, token = candidates[0]
    join(client, token, pool)
    mid = members(client, owner, cid, pool["id"])[0]["id"]
    suggestion(client, owner, cid, pool, mid, job["id"])
    assert client.delete(root(cid, pool["id"]), headers=auth(owner)).status_code == 204
    assert client.get(public(token)).json()["items"] == []

    async def check(db: Any) -> None:
        assert await db.get(BizTalentMember, mid) is None
        assert await db.get(BizApplication, aid) is not None

    db_call(client, check)


def test_candidate_dismisses_only_own_suggestions(client: TestClient) -> None:
    owner, cid, _, job, pool, candidates = setup(client)
    for _, token in candidates:
        join(client, token, pool)
    for m in members(client, owner, cid, pool["id"]):
        suggestion(client, owner, cid, pool, m["id"], job["id"])
    endpoint = public(candidates[0][1], pool["id"]) + f"/suggestions/{job['id']}"
    assert client.delete(endpoint).status_code == 200
    assert client.delete(endpoint).status_code == 200
    assert client.get(public(candidates[0][1])).json()["items"][0]["suggestions"] == []
    assert len(client.get(public(candidates[1][1])).json()["items"][0]["suggestions"]) == 1
    assert len(members(client, owner, cid, pool["id"])) == 2


def test_notice_change_and_company_verification_gate_discovery(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner, cid, _, _, pool, candidates = setup(client)
    token = candidates[0][1]
    request_id = str(uuid.uuid4())
    join(client, token, pool, request_id=request_id)
    monkeypatch.setattr("orbit_api.business.talent.NOTICE_VERSION", "new-notice")
    assert members(client, owner, cid, pool["id"]) == []
    assert not client.get(public(token)).json()["items"][0]["active"]
    assert join(client, token, pool, request_id=request_id, notice_version="new-notice").status_code == 409
    assert join(client, token, pool, notice_version="new-notice").status_code == 200
    assert len(members(client, owner, cid, pool["id"])) == 1

    async def unverify(db: Any) -> None:
        company = await db.get(BizCompany, cid)
        company.verified_at = None

    db_call(client, unverify)
    assert members(client, owner, cid, pool["id"]) == []
    assert not client.get(public(token)).json()["items"][0]["active"]
    assert client.delete(public(token, pool["id"])).status_code == 200


def test_simultaneous_join_retries_create_one_membership(client: TestClient) -> None:
    owner, cid, _, _, pool, candidates = setup(client)
    token = candidates[0][1]
    request_id = str(uuid.uuid4())
    barrier = Barrier(2)

    def submit() -> Any:
        barrier.wait(timeout=10)
        return join(client, token, pool, request_id=request_id)

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(submit) for _ in range(2)]
        results = [f.result(timeout=20) for f in futures]
    assert [r.status_code for r in results] == [200, 200], [r.text for r in results]
    assert results[0].json() == results[1].json()
    assert len(members(client, owner, cid, pool["id"])) == 1
