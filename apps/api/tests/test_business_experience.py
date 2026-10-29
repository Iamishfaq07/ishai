"""Candidate control, fixed privacy groups, opt-in delivery and aggregate-only improvement workflows."""

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from orbit_api.business import rules
from orbit_api.business.experience import VERSION, sweep
from orbit_api.models import (
    BizApplication,
    BizCompany,
    BizExperienceInvite,
    BizExperienceResponse,
    BizJob,
    ProviderRequest,
)
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, new_company, new_job, tag, uid
from tests.test_business_requisitions import add_member


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def root(cid: str, jid: str = "") -> str:
    return f"/v1/business/companies/{cid}/experience" + (f"/{jid}" if jid else "")


def public(token: str) -> str:
    return f"/v1/public/business/applications/{token}/experience"


def setup(client: TestClient, count: int = 6) -> tuple[dict[str, str], str, dict[str, Any], list[tuple[str, str]]]:
    owner, company, _ = new_company(client)
    cid = company["id"]
    job = new_job(client, owner, cid)
    return owner, cid, job, people(client, cid, job["id"], count)


def people(client: TestClient, cid: str, jid: str, count: int) -> list[tuple[str, str]]:
    async def seed(db: Any) -> list[tuple[str, str]]:
        result = []
        for _ in range(count):
            token = uuid.uuid4().hex + uuid.uuid4().hex
            row = BizApplication(
                company_id=cid,
                job_id=jid,
                reference=uuid.uuid4().hex[:12],
                name="PRIVATE RESPONDENT NAME",
                email=f"{tag()}@example.com",
                status="active",
                stage_id="interview",
                email_confirmed_at=datetime.now(UTC),
                status_token_hash=rules.digest(token),
                resume_text="PRIVATE RESUME",
                ranking_status="done",
            )
            db.add(row)
            await db.flush()
            result.append((row.id, token))
        return result

    return db_call(client, seed)  # type: ignore[no-any-return]


def configure(
    client: TestClient,
    owner: dict[str, str],
    cid: str,
    jid: str,
    revision: int = 0,
    enabled: bool = True,
    stages: list[str] | None = None,
) -> dict[str, Any]:
    response = client.put(
        root(cid, jid) + "/settings",
        headers=auth(owner),
        json={"base_revision": revision, "enabled": enabled, "stage_kinds": stages or ["interview"], "expiry_days": 14},
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


def invitations(client: TestClient, owner: dict[str, str], cid: str, jid: str) -> Any:
    return client.post(root(cid, jid) + "/invitations/run", headers=auth(owner))


def report(client: TestClient, owner: dict[str, str], cid: str, jid: str) -> dict[str, Any]:
    response = client.get(root(cid, jid), headers=auth(owner))
    assert response.status_code == 200, response.text
    return dict(response.json())


def answer(client: TestClient, token: str, rating: int = 4, **extra: Any) -> Any:
    return client.post(
        public(token),
        json={
            "request_id": str(uuid.uuid4()),
            "notice_version": VERSION,
            "acknowledge": True,
            "communication": rating,
            "clarity": rating,
            "respect": rating,
            "improvement": "communication",
            **extra,
        },
    )


def release(client: TestClient, owner: dict[str, str], cid: str, jid: str, tokens: list[tuple[str, str]]) -> None:
    configure(client, owner, cid, jid)
    assert invitations(client, owner, cid, jid).status_code == 200
    for _aid, token in tokens:
        result = answer(client, token)
        assert result.status_code == 200, result.text


def test_opt_in_stage_selection_once_per_application_and_status_portal_flag(client: TestClient) -> None:
    owner, cid, job, candidates = setup(client, 3)
    assert not report(client, owner, cid, job["id"])["enabled"]
    assert invitations(client, owner, cid, job["id"]).json()["created"] == 0
    assert client.get(public(candidates[0][1])).json()["state"] == "unavailable"
    configure(client, owner, cid, job["id"], stages=["hired"])
    assert invitations(client, owner, cid, job["id"]).json()["created"] == 0
    configure(client, owner, cid, job["id"], revision=1)
    assert invitations(client, owner, cid, job["id"]).json()["created"] == 3
    assert invitations(client, owner, cid, job["id"]).json()["created"] == 0
    status = client.get(f"/v1/public/business/applications/{candidates[0][1]}")
    assert status.status_code == 200 and status.json()["experience_invited"]
    assert client.get(public(candidates[0][1])).json()["state"] == "available"


def test_partial_groups_and_single_new_answers_do_not_change_public_report_or_version(client: TestClient) -> None:
    owner, cid, job, candidates = setup(client, 6)
    configure(client, owner, cid, job["id"])
    invitations(client, owner, cid, job["id"])
    initial = report(client, owner, cid, job["id"])
    for _aid, token in candidates[:4]:
        assert answer(client, token, rating=3).status_code == 200
    partial = report(client, owner, cid, job["id"])
    assert partial["report"]["participants"] is None and partial["report"]["scores"] == []
    assert partial["version"] == initial["version"]
    assert answer(client, candidates[4][1], rating=3).status_code == 200
    released = report(client, owner, cid, job["id"])
    assert released["report"]["participants"] == 5
    assert all(s["mean"] == 3 and s["distribution"]["3"] == 5 for s in released["report"]["scores"])
    assert answer(client, candidates[5][1], rating=1).status_code == 200
    assert report(client, owner, cid, job["id"])["version"] == released["version"]
    serialized = str(released)
    assert "PRIVATE" not in serialized and all(
        aid not in serialized and tok not in serialized for aid, tok in candidates
    )


def test_withdrawal_suppresses_whole_batch_and_never_recycles_remaining_members(client: TestClient) -> None:
    owner, cid, job, candidates = setup(client, 10)
    release(client, owner, cid, job["id"], candidates)
    assert report(client, owner, cid, job["id"])["report"]["participants"] == 10
    removed = client.delete(public(candidates[0][1]))
    assert removed.status_code == 200 and removed.json()["state"] == "removed"
    assert report(client, owner, cid, job["id"])["report"]["participants"] == 5
    assert answer(client, candidates[0][1]).status_code == 409
    extra = people(client, cid, job["id"], 5)
    invitations(client, owner, cid, job["id"])
    for _aid, token in extra[:4]:
        assert answer(client, token).status_code == 200
    assert report(client, owner, cid, job["id"])["report"]["participants"] == 5
    assert answer(client, extra[4][1]).status_code == 200
    assert report(client, owner, cid, job["id"])["report"]["participants"] == 10


def test_deletion_request_retention_and_hard_delete_remove_contributions(client: TestClient) -> None:
    owner, cid, job, candidates = setup(client, 5)
    release(client, owner, cid, job["id"], candidates)

    async def pending(db: Any) -> None:
        row = await db.get(BizApplication, candidates[0][0])
        row.deletion_requested_at = datetime.now(UTC)

    db_call(client, pending)
    assert report(client, owner, cid, job["id"])["report"]["participants"] is None

    async def expire(db: Any) -> None:
        row = await db.get(BizExperienceResponse, candidates[1][0])
        row.created_at = datetime.now(UTC) - timedelta(days=91)

    db_call(client, expire)
    client.portal.call(sweep)

    async def inspect(db: Any) -> bool:
        return await db.get(BizExperienceResponse, candidates[1][0]) is None

    assert db_call(client, inspect)

    async def remove(db: Any) -> None:
        await db.execute(delete(BizApplication).where(BizApplication.id == candidates[2][0]))

    db_call(client, remove)
    assert client.get(public(candidates[2][1])).status_code == 404

    async def missing(db: Any) -> bool:
        return await db.get(BizExperienceResponse, candidates[2][0]) is None

    assert db_call(client, missing)


def test_concurrent_submit_retries_create_one_response_and_one_group(client: TestClient) -> None:
    owner, cid, job, candidates = setup(client, 5)
    configure(client, owner, cid, job["id"])
    invitations(client, owner, cid, job["id"])
    for _aid, token in candidates[:4]:
        assert answer(client, token).status_code == 200
    request_id = str(uuid.uuid4())
    barrier = Barrier(2)

    def submit() -> Any:
        barrier.wait(timeout=10)
        return answer(client, candidates[4][1], request_id=request_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: submit(), range(2)))
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    assert report(client, owner, cid, job["id"])["report"]["participants"] == 5
    assert answer(client, candidates[4][1], rating=1, request_id=request_id).status_code == 409


def test_company_job_role_and_candidate_token_boundaries(client: TestClient) -> None:
    _owner, cid, job, _ = setup(client, 0)
    other, other_company, _ = new_company(client)
    manager = add_member(client, cid, "hiring_manager")
    interviewer = add_member(client, cid, "interviewer")
    assert client.get(root(cid), headers=auth(interviewer)).status_code == 403
    assert client.get(root(cid, job["id"]), headers=auth(manager)).status_code == 404
    assert client.get(root(other_company["id"], job["id"]), headers=auth(other)).status_code == 404

    async def assign(db: Any) -> None:
        j = await db.get(BizJob, job["id"])
        j.hiring_team = [uid(manager)]

    db_call(client, assign)
    assert report(client, manager, cid, job["id"])["job"]["id"] == job["id"]
    assert client.get(public("invalid-token")).status_code == 404


def test_expiry_disabled_campaign_suspension_and_candidate_withdrawal(client: TestClient) -> None:
    owner, cid, job, candidates = setup(client, 3)
    configure(client, owner, cid, job["id"])
    invitations(client, owner, cid, job["id"])
    assert answer(client, candidates[0][1]).status_code == 200

    async def expire(db: Any) -> None:
        row = await db.get(BizExperienceInvite, candidates[1][0])
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)

    db_call(client, expire)
    assert answer(client, candidates[1][1]).status_code == 409
    configure(client, owner, cid, job["id"], revision=1, enabled=False)
    assert answer(client, candidates[2][1]).status_code == 409

    async def suspend(db: Any) -> None:
        row = await db.get(BizCompany, cid)
        row.status = "suspended"

    db_call(client, suspend)
    assert client.delete(public(candidates[0][1])).json()["state"] == "removed"
    assert invitations(client, owner, cid, job["id"]).status_code == 403


@pytest.mark.parametrize(
    "extra",
    [
        {"respect": True},
        {"clarity": "5"},
        {"communication": 0},
        {"acknowledge": False},
        {"notice_version": "old"},
        {"comment": "private text"},
    ],
)
def test_answer_contract_and_explicit_notice(client: TestClient, extra: dict[str, Any]) -> None:
    owner, cid, job, candidates = setup(client, 1)
    configure(client, owner, cid, job["id"])
    invitations(client, owner, cid, job["id"])
    assert answer(client, candidates[0][1], **extra).status_code == 422
    assert client.get(public(candidates[0][1])).json()["state"] == "available"


def test_ai_uses_released_aggregates_and_rejects_withdrawal_during_generation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from orbit_api.db import sessionmaker

    owner, cid, job, candidates = setup(client, 5)
    configure(client, owner, cid, job["id"])
    before = report(client, owner, cid, job["id"])
    assert (
        client.post(
            root(cid, job["id"]) + "/brief", headers=auth(owner), json={"version": before["version"]}
        ).status_code
        == 422
    )
    invitations(client, owner, cid, job["id"])
    for _aid, token in candidates:
        answer(client, token)
    data = report(client, owner, cid, job["id"])
    response = client.post(root(cid, job["id"]) + "/brief", headers=auth(owner), json={"version": data["version"]})
    assert response.status_code == 200, response.text
    facts = {f["id"]: f["text"] for f in response.json()["facts"]}
    assert all(t["source_quote"] in facts[t["fact_id"]] for t in response.json()["tips"])
    original = MockLLMProvider.generate

    async def withdraw(self: Any, request: Any) -> Any:
        assert "PRIVATE" not in request.messages[-1].content
        async with sessionmaker()() as db:
            await db.execute(
                delete(BizExperienceResponse).where(BizExperienceResponse.application_id == candidates[0][0])
            )
            await db.commit()
        return await original(self, request)

    monkeypatch.setattr(MockLLMProvider, "generate", withdraw)
    assert (
        client.post(root(cid, job["id"]) + "/brief", headers=auth(owner), json={"version": data["version"]}).status_code
        == 409
    )


def test_plan_requires_reviewed_current_version_and_does_not_change_hiring(client: TestClient) -> None:
    owner, cid, job, candidates = setup(client, 5)
    release(client, owner, cid, job["id"], candidates)
    data = report(client, owner, cid, job["id"])
    body = {
        "base_revision": data["revision"],
        "source_version": data["version"],
        "data": {
            "goal": "Improve communication clarity for the next hiring cycle.",
            "actions": ["Review candidate updates weekly with the recruiting coordinator."],
            "status": "active",
            "target_date": "2026-12-01",
        },
    }
    response = client.put(root(cid, job["id"]) + "/plan", headers=auth(owner), json=body)
    assert response.status_code == 200, response.text
    assert response.json()["plan"]["status"] == "active"
    assert client.put(root(cid, job["id"]) + "/plan", headers=auth(owner), json=body).status_code == 409

    async def inspect(db: Any) -> list[str]:
        return list(await db.scalars(select(BizApplication.status).where(BizApplication.job_id == job["id"])))

    assert db_call(client, inspect) == ["active"] * 5


def test_company_ai_allowance_includes_failed_attempts(client: TestClient) -> None:
    owner, cid, job, candidates = setup(client, 5)
    release(client, owner, cid, job["id"], candidates)

    async def fill(db: Any) -> None:
        for _ in range(10):
            db.add(
                ProviderRequest(
                    user_id=uid(owner),
                    company_id=cid,
                    provider="mock",
                    model="mock",
                    request_type="business_experience_brief",
                    ok=False,
                )
            )

    db_call(client, fill)
    data = report(client, owner, cid, job["id"])
    assert (
        client.post(root(cid, job["id"]) + "/brief", headers=auth(owner), json={"version": data["version"]}).status_code
        == 429
    )


def test_candidate_can_decline_without_sharing_ratings(client: TestClient) -> None:
    owner, cid, job, candidates = setup(client, 1)
    configure(client, owner, cid, job["id"])
    invitations(client, owner, cid, job["id"])
    declined = client.delete(public(candidates[0][1]))
    assert declined.status_code == 200 and declined.json()["state"] == "declined"
    assert declined.json()["response"] is None
    assert answer(client, candidates[0][1]).status_code == 409
    assert invitations(client, owner, cid, job["id"]).json()["created"] == 0
