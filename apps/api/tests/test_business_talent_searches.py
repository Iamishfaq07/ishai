"""Shared search criteria never become saved candidate snapshots or a consent bypass."""

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from orbit_api.models import BizApplication, BizCompany, BizMember, BizTalentMember, BizTalentSearch
from tests.business_helpers import auth, db_call, make_client, new_company, uid
from tests.test_business_requisitions import add_member
from tests.test_business_talent import join, public, root, setup


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def body(pool: dict[str, Any], **over: Any) -> dict[str, Any]:
    return {"request_id": str(uuid.uuid4()), "name": "Backend talent", "query": "Python",
            "terms_revision": pool["terms_revision"], "base_revision": 0, **over}


def save(client: TestClient, owner: Any, cid: str, pool: dict[str, Any], **over: Any) -> Any:
    response = client.post(root(cid, pool["id"]) + "/searches", headers=auth(owner), json=body(pool, **over))
    assert response.status_code == 201, response.text
    return response.json()


def endpoint(cid: str, pool: dict[str, Any], row: dict[str, Any]) -> str:
    return root(cid, pool["id"]) + f"/searches/{row['id']}"


def run(client: TestClient, owner: Any, cid: str, pool: dict[str, Any], row: dict[str, Any]) -> Any:
    return client.get(endpoint(cid, pool, row) + "/members", headers=auth(owner),
                      params={"base_revision": row["revision"]})


def test_shared_criteria_idempotency_and_current_results(client: TestClient) -> None:
    owner, cid, _, _, pool, candidates = setup(client)
    url = root(cid, pool["id"]) + "/searches"
    payload = body(pool)
    first = client.post(url, headers=auth(owner), json=payload)
    assert first.status_code == 201, first.text
    row = first.json()
    assert row["revision"] == 1 and row["can_manage"] and not row["stale"]
    assert client.post(url, headers=auth(owner), json=payload).json() == row
    assert client.post(url, headers=auth(owner), json={**payload, "query": "Go"}).status_code == 409
    assert run(client, owner, cid, pool, row).json()["items"] == []
    assert join(client, candidates[0][1], pool).status_code == 200
    result = run(client, owner, cid, pool, row).json()
    assert len(result["items"]) == 1
    assert "email" not in result["items"][0] and "resume_text" not in result["items"][0]
    assert set(row) == {"id", "name", "query", "revision", "terms_revision", "stale", "can_manage"}
    recruiter = add_member(client, cid, "recruiter")
    listed = client.get(url, headers=auth(recruiter)).json()["items"]
    assert len(listed) == 1 and not listed[0]["can_manage"]
    assert len(run(client, recruiter, cid, pool, row).json()["items"]) == 1
    assert client.delete(public(candidates[0][1], pool["id"])).status_code == 200
    assert run(client, recruiter, cid, pool, row).json()["items"] == []


def test_creator_admin_edits_revision_and_delete_conflicts(client: TestClient) -> None:
    owner, cid, _, _, pool, _ = setup(client)
    creator = add_member(client, cid, "recruiter")
    other = add_member(client, cid, "recruiter")
    row = save(client, creator, cid, pool)
    url = endpoint(cid, pool, row)
    update = {"name": "Reviewed backend", "query": "Postgres", "terms_revision": 1, "base_revision": 1}
    assert client.put(url, headers=auth(other), json=update).status_code == 403
    assert client.delete(url, headers=auth(other), params={"base_revision": 1}).status_code == 403
    changed = client.put(url, headers=auth(owner), json=update)
    assert changed.status_code == 200, changed.text
    assert changed.json()["revision"] == 2
    assert client.put(url, headers=auth(creator), json=update).status_code == 409
    assert run(client, creator, cid, pool, row).status_code == 409
    assert client.delete(url, headers=auth(creator), params={"base_revision": 1}).status_code == 409
    assert client.delete(url, headers=auth(creator), params={"base_revision": 2}).status_code == 204
    assert run(client, creator, cid, pool, changed.json()).status_code == 404


def test_consent_terms_change_requires_explicit_criteria_review(client: TestClient) -> None:
    owner, cid, _, _, pool, candidates = setup(client)
    row = save(client, owner, cid, pool)
    assert join(client, candidates[0][1], pool).status_code == 200
    changed = client.put(root(cid, pool["id"]), headers=auth(owner), json={
        "name": pool["name"], "purpose": "A newly reviewed purpose for future API engineering roles.",
        "retention_days": 90, "enabled": True, "base_revision": pool["revision"],
    })
    assert changed.status_code == 200, changed.text
    newer = changed.json()
    listed = client.get(root(cid, pool["id"]) + "/searches", headers=auth(owner)).json()["items"]
    assert listed[0]["stale"]
    assert run(client, owner, cid, pool, row).status_code == 409
    update = {"name": row["name"], "query": row["query"], "base_revision": row["revision"], "terms_revision": 1}
    assert client.put(endpoint(cid, pool, row), headers=auth(owner), json=update).status_code == 409
    approved = client.put(endpoint(cid, pool, row), headers=auth(owner),
                          json={**update, "terms_revision": newer["terms_revision"]})
    assert approved.status_code == 200 and not approved.json()["stale"]
    assert run(client, owner, cid, newer, approved.json()).json()["items"] == []
    assert join(client, candidates[0][1], newer).status_code == 200
    assert len(run(client, owner, cid, newer, approved.json()).json()["items"]) == 1


@pytest.mark.parametrize("role", ["hiring_manager", "interviewer"])
def test_non_directory_roles_cannot_read_write_or_run(client: TestClient, role: str) -> None:
    owner, cid, _, _, pool, _ = setup(client)
    row = save(client, owner, cid, pool)
    actor = add_member(client, cid, role)
    url = root(cid, pool["id"]) + "/searches"
    assert client.get(url, headers=auth(actor)).status_code == 403
    assert client.post(url, headers=auth(actor), json=body(pool)).status_code == 403
    assert run(client, actor, cid, pool, row).status_code == 403
    assert client.delete(endpoint(cid, pool, row), headers=auth(actor), params={"base_revision": 1}).status_code == 403


def test_cross_company_and_cross_pool_ids_are_not_usable(client: TestClient) -> None:
    owner, cid, _, _, pool, _ = setup(client)
    row = save(client, owner, cid, pool)
    outsider, other_company, _ = new_company(client)
    assert client.get(root(other_company["id"], pool["id"]) + "/searches", headers=auth(outsider)).status_code == 404
    assert run(client, outsider, other_company["id"], pool, row).status_code == 404
    second = client.post(root(cid), headers=auth(owner), json={
        "name": "Other pool", "purpose": "Other consent purpose for future roles.",
    }).json()
    assert run(client, owner, cid, second, row).status_code == 404
    response = client.post(root(cid, second["id"]) + "/searches", headers=auth(owner),
                           json=body(second, request_id=row["id"]))
    assert response.status_code == 404


@pytest.mark.parametrize("change", ["expired", "unconfirmed", "deletion", "unverified", "paused"])
def test_replay_rechecks_live_discovery_eligibility(client: TestClient, change: str) -> None:
    owner, cid, _, _, pool, candidates = setup(client)
    row = save(client, owner, cid, pool)
    assert join(client, candidates[0][1], pool).status_code == 200
    assert len(run(client, owner, cid, pool, row).json()["items"]) == 1

    async def alter(db: Any) -> None:
        from orbit_api.models import BizTalentPool
        if change == "expired":
            member = await db.scalar(select(BizTalentMember).where(BizTalentMember.application_id == candidates[0][0]))
            member.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        elif change == "paused":
            (await db.get(BizTalentPool, pool["id"])).enabled = False
        elif change == "unverified":
            (await db.get(BizCompany, cid)).verified_at = None
        else:
            app = await db.get(BizApplication, candidates[0][0])
            if change == "unconfirmed":
                app.email_confirmed_at = None
            else:
                app.deletion_requested_at = datetime.now(UTC)

    db_call(client, alter)
    assert run(client, owner, cid, pool, row).json()["items"] == []


def test_role_revocation_blocks_replay_and_no_candidate_snapshot_is_stored(client: TestClient) -> None:
    owner, cid, _, _, pool, _ = setup(client)
    creator = add_member(client, cid, "recruiter")
    row = save(client, creator, cid, pool)

    async def revoke(db: Any) -> None:
        await db.execute(delete(BizMember).where(BizMember.company_id == cid, BizMember.user_id == uid(creator)))
        saved = await db.get(BizTalentSearch, row["id"])
        assert saved.query == "Python" and saved.created_by == uid(creator)
        assert not hasattr(saved, "members") and not hasattr(saved, "results")

    db_call(client, revoke)
    assert run(client, creator, cid, pool, row).status_code in (403, 404)
    assert client.delete(endpoint(cid, pool, row), headers=auth(owner), params={"base_revision": 1}).status_code == 204


def test_validation_literal_search_and_twenty_search_cap(client: TestClient) -> None:
    owner, cid, _, _, pool, candidates = setup(client)
    url = root(cid, pool["id"]) + "/searches"
    for fields in [{"query": " "}, {"name": "x"}, {"query": "x" * 81},
                   {"base_revision": True}, {"terms_revision": "1"}, {"extra": "no"}]:
        assert client.post(url, headers=auth(owner), json=body(pool, **fields)).status_code == 422
    assert join(client, candidates[0][1], pool).status_code == 200
    for value in ["%", "_", "Python OR Postgres"]:
        row = save(client, owner, cid, pool, query=value)
        assert run(client, owner, cid, pool, row).json()["items"] == []
    for index in range(17):
        save(client, owner, cid, pool, name=f"Saved search {index}")
    assert client.post(url, headers=auth(owner), json=body(pool)).status_code == 409


def test_concurrent_creates_keep_one_request_and_updates_require_current_revision(client: TestClient) -> None:
    owner, cid, _, _, pool, _ = setup(client)
    url = root(cid, pool["id"]) + "/searches"
    payload = body(pool)
    barrier = Barrier(2)

    def create(_: int) -> Any:
        barrier.wait(timeout=10)
        return client.post(url, headers=auth(owner), json=payload)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(create, range(2)))
    assert [result.status_code for result in results] == [201, 201]
    assert results[0].json()["id"] == results[1].json()["id"]
    barrier = Barrier(2)
    row = results[0].json()

    def update(index: int) -> Any:
        barrier.wait(timeout=10)
        return client.put(endpoint(cid, pool, row), headers=auth(owner), json={
            "name": f"Updated search {index}", "query": "Python", "base_revision": 1, "terms_revision": 1,
        })

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(update, range(2)))
    assert sorted(result.status_code for result in results) == [200, 409]

    async def near_cap(db: Any) -> None:
        for index in range(18):
            db.add(BizTalentSearch(id=str(uuid.uuid4()), company_id=cid, pool_id=pool["id"],
                                  created_by=uid(owner), name=f"Seeded search {index}", query="Python",
                                  terms_revision=1, revision=1, request_sha256="seed"))

    db_call(client, near_cap)
    barrier = Barrier(2)

    def last_slot(index: int) -> Any:
        barrier.wait(timeout=10)
        return client.post(url, headers=auth(owner), json=body(pool, name=f"Final search {index}"))

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(last_slot, range(2)))
    assert sorted(result.status_code for result in results) == [201, 409]
    assert len(client.get(url, headers=auth(owner)).json()["items"]) == 20


def test_pool_deletion_cascades_searches_but_preserves_applications(client: TestClient) -> None:
    owner, cid, _, _, pool, candidates = setup(client)
    row = save(client, owner, cid, pool)
    assert client.delete(root(cid, pool["id"]), headers=auth(owner)).status_code == 204

    async def check(db: Any) -> None:
        assert await db.get(BizTalentSearch, row["id"]) is None
        assert await db.get(BizApplication, candidates[0][0]) is not None

    db_call(client, check)
