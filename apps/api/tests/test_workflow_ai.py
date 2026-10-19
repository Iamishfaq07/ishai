"""Real HTTP source isolation, grounded output, preview-only writes and durable AI budgets."""
import json
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.models import ApplicationPacket, BizHiringPlan, BizJob, BizMember, JobContact, ProviderRequest
from orbit_api.providers.llm.base import LLMError
from orbit_api.providers.llm.mock import MockLLMProvider
from tests.business_helpers import auth, db_call, make_client, new_company, new_job, register, tag, uid


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch)


def person(client: TestClient) -> dict[str, str]:
    return register(client, f"actions-{tag()}@example.com")


def contact(client: TestClient, user: dict[str, str], days: int = -1, **extra: Any) -> dict[str, Any]:
    response = client.post("/v1/jobs/contacts", headers=auth(user), json={
        "name": "Alex Recruiter", "company": "Rocket",
        "follow_up_at": (datetime.now(UTC) + timedelta(days=days)).isoformat(),
        **extra})
    assert response.status_code == 201, response.text
    return dict(response.json())


def brief(client: TestClient, user: dict[str, str]) -> Any:
    queue = client.get("/v1/jobs/actions", headers=auth(user)).json()
    return client.post("/v1/jobs/actions/brief", headers=auth(user), json={"version": queue["version"]})


def business(client: TestClient) -> tuple[dict[str, str], str, str]:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    return owner, company["id"], job["id"]


def plan_url(cid: str, jid: str) -> str:
    return f"/v1/business/companies/{cid}/jobs/{jid}/hiring-plan"


def test_automatic_queue_is_owned_due_sorted_and_resolves_from_source(client: TestClient) -> None:
    user, stranger = person(client), person(client)
    old = contact(client, user)
    contact(client, user, 2, name="Tomorrow")
    contact(client, user, 9, name="Later")
    contact(client, stranger, -10, name="Private")
    response = client.get("/v1/jobs/actions", headers=auth(user))
    assert response.status_code == 200
    queue = response.json()
    assert [a["title"] for a in queue["items"]] == ["Alex Recruiter", "Tomorrow"]
    assert queue["items"][0]["overdue"] and not queue["items"][1]["overdue"]
    assert all(a["path"].startswith("/jobs/") for a in queue["items"])
    assert client.delete(f"/v1/jobs/contacts/{old['id']}", headers=auth(user)).status_code == 204
    assert client.get("/v1/jobs/actions", headers=auth(user)).json()["version"] != queue["version"]
    stale = client.post("/v1/jobs/actions/brief", headers=auth(user), json={"version": queue["version"]})
    assert stale.status_code == 409


def test_interviews_and_application_blocks_link_to_existing_workspaces(client: TestClient) -> None:
    user = person(client)
    job = client.post("/v1/jobs/tracker/manual", headers=auth(user), json={"title": "Engineer", "company": "Orbit",
        "status": "interviewing", "next_at": (datetime.now(UTC) - timedelta(hours=2)).isoformat()})
    assert job.status_code == 201, job.text

    async def seed(db: Any) -> str:
        packet = ApplicationPacket(user_id=uid(user), listing_id="missing-listing", company="Acme", company_key="acme",
            title="Designer", status="needs_answer", ats="workday", url="https://example.com",
            apply_url="https://example.com", expires_at=datetime.now(UTC) + timedelta(days=3))
        db.add(packet)
        await db.flush()
        return str(packet.id)

    packet_id = db_call(client, seed)
    queue = client.get("/v1/jobs/actions", headers=auth(user)).json()
    assert [a["kind"] for a in queue["items"]] == ["interview", "application"]
    assert "outcome" in queue["items"][0]["detail"]
    assert queue["items"][1]["path"].endswith(packet_id)
    assert brief(client, user).status_code == 200


def test_brief_is_grounded_labelled_and_does_not_change_source(client: TestClient) -> None:
    user = person(client)
    c = contact(client, user)
    result = brief(client, user)
    assert result.status_code == 200, result.text
    assert result.json()["source"] == "mock"
    assert result.json()["steps"][0]["action_id"] == f"contact:{c['id']}"
    assert client.get("/v1/jobs/contacts", headers=auth(user)).json()[0]["last_contacted_at"] is None


@pytest.mark.parametrize("bad", ["unknown", "quote", "duplicate", "malformed"])
def test_brief_rejects_untrusted_model_output(client: TestClient, monkeypatch: pytest.MonkeyPatch, bad: str) -> None:
    user = person(client)
    c = contact(client, user)
    step = {"action_id": f"contact:{c['id']}", "source_quote": "Alex Recruiter",
            "suggestion": "Review the contact before following up."}
    if bad == "unknown":
        step["action_id"] = "contact:someone-else"
    if bad == "quote":
        step["source_quote"] = "A fabricated meeting"
    output = "not json" if bad == "malformed" else json.dumps({"steps": [step, step] if bad == "duplicate" else [step]})
    mock = MockLLMProvider(script=[output])
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: mock)
    assert brief(client, user).status_code == 502
    assert len(mock.requests) == 1  # No unbounded repair calls.


def test_failed_attempts_are_recorded_and_daily_budget_survives_new_requests(client: TestClient,
        monkeypatch: pytest.MonkeyPatch) -> None:
    user = person(client)
    contact(client, user)
    mock = MockLLMProvider(script=["invalid"] * 5)
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: mock)
    for _ in range(5):
        assert brief(client, user).status_code == 502
    assert brief(client, user).status_code == 429
    assert len(mock.requests) == 5

    async def records(db: Any) -> list[Any]:
        return list(await db.scalars(select(ProviderRequest).where(ProviderRequest.user_id == uid(user))))

    rows = db_call(client, records)
    assert len(rows) == 5 and all(not r.ok and r.provider == "mock" for r in rows)


def test_concurrent_briefs_cannot_overspend_last_slot(client: TestClient) -> None:
    user = person(client)
    contact(client, user)
    for _ in range(4):
        assert brief(client, user).status_code == 200
    version = client.get("/v1/jobs/actions", headers=auth(user)).json()["version"]
    def call(_: int) -> int:
        return client.post("/v1/jobs/actions/brief", headers=auth(user), json={"version": version}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(call, range(2))) == [200, 429]


def test_source_changed_during_ai_brief_is_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    user = person(client)
    c = contact(client, user)
    class Changing(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            from orbit_api.db import sessionmaker
            async with sessionmaker()() as db:
                row = await db.get(JobContact, c["id"])
                assert row
                row.name = "Updated contact"
                await db.commit()
            return await super().generate(request)
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", Changing)
    assert brief(client, user).status_code == 409


def test_provider_failure_leaves_manual_workflow_available(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    user = person(client)
    contact(client, user)
    class Broken(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            raise LLMError("unavailable", "private provider error")
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", Broken)
    result = brief(client, user)
    assert result.status_code == 503 and "private provider" not in result.text
    assert len(client.get("/v1/jobs/actions", headers=auth(user)).json()["items"]) == 1


def test_business_draft_is_sourced_and_save_is_explicit(client: TestClient) -> None:
    user, cid, jid = business(client)
    path = plan_url(cid, jid)
    before = client.get(path, headers=auth(user)).json()
    result = client.post(path + "/assist", headers=auth(user), json={"base_revision": 0})
    assert result.status_code == 200, result.text
    draft = result.json()
    assert draft["source"] == "mock" and len(draft["sources"]) == len(draft["plan"]["criteria"])
    assert client.get(path, headers=auth(user)).json() == before
    saved = client.put(path, headers=auth(user), json={"base_revision": 0, "plan": draft["plan"],
        "source_version": draft["source_version"]})
    assert saved.status_code == 200 and saved.json()["revision"] == 1
    assert client.post(path + "/assist", headers=auth(user), json={"base_revision": 0}).status_code == 409


@pytest.mark.parametrize("bad", ["stage", "quote", "protected", "protected_intro", "coverage", "independent"])
def test_business_rejects_unsupported_or_unfair_drafts(client: TestClient,
        monkeypatch: pytest.MonkeyPatch, bad: str) -> None:
    user, cid, jid = business(client)
    path = plan_url(cid, jid)
    plan = client.get(path, headers=auth(user)).json()["plan"]
    sources = [{"criterion_id": c["id"], "requirement_quote": "Python"} for c in plan["criteria"]]
    if bad == "stage":
        plan["criteria"][0]["stage_id"] = "invented-stage"
    elif bad == "quote":
        sources[0]["requirement_quote"] = "Invented requirement"
    elif bad == "protected":
        plan["criteria"][0]["question"] = "Are you pregnant or planning to have children?"
    elif bad == "protected_intro":
        plan["candidate_intro"] = "Are you pregnant or planning to have children?"
    elif bad == "coverage":
        sources = []
    else:
        plan["independent_feedback"] = False
    mock = MockLLMProvider(script=[json.dumps({"plan": plan, "sources": sources})])
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: mock)
    assert client.post(path + "/assist", headers=auth(user), json={"base_revision": 0}).status_code == 502


def test_business_source_change_during_model_call_is_rejected(client: TestClient,
        monkeypatch: pytest.MonkeyPatch) -> None:
    user, cid, jid = business(client)
    class Changing(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            from orbit_api.db import sessionmaker
            async with sessionmaker()() as db:
                job = await db.get(BizJob, jid)
                assert job
                job.must_haves = ["Rust"]
                await db.commit()
            return await super().generate(request)
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", Changing)
    assert client.post(plan_url(cid, jid) + "/assist", headers=auth(user), json={"base_revision": 0}).status_code == 409
    async def saved(db: Any) -> Any:
        return await db.get(BizHiringPlan, jid)
    assert db_call(client, saved) is None


def test_authentication_and_company_isolation_before_ai(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    user, cid, jid = business(client)
    outsider = person(client)
    mock = MockLLMProvider()
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: mock)
    client.cookies.clear()
    assert client.get("/v1/jobs/actions").status_code == 401
    assert client.post(plan_url(cid, jid) + "/assist", json={"base_revision": 0}).status_code == 401
    denied = client.post(plan_url(cid, jid) + "/assist", headers=auth(outsider), json={"base_revision": 0})
    assert denied.status_code == 404
    assert mock.requests == []
    assert client.get("/v1/jobs/actions", headers=auth(user)).json()["items"] == []
    assert brief(client, user).status_code == 409


def test_business_ai_preview_cannot_save_after_job_changes(client: TestClient) -> None:
    user, cid, jid = business(client)
    path = plan_url(cid, jid)
    draft = client.post(path + "/assist", headers=auth(user), json={"base_revision": 0}).json()
    async def edit(db: Any) -> None:
        job = await db.get(BizJob, jid)
        job.must_haves = ["A new requirement"]
    db_call(client, edit)
    result = client.put(path, headers=auth(user), json={"plan": draft["plan"],
        "base_revision": 0, "source_version": draft["source_version"]})
    assert result.status_code == 409
    assert client.get(path, headers=auth(user)).json()["revision"] == 0


def test_business_allowance_is_shared_across_company_members(client: TestClient) -> None:
    owner, cid, jid = business(client)
    recruiter = person(client)
    async def invite(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(recruiter), role="recruiter"))
    db_call(client, invite)
    path = plan_url(cid, jid) + "/assist"
    for _ in range(9):
        assert client.post(path, headers=auth(owner), json={"base_revision": 0}).status_code == 200
    assert client.post(path, headers=auth(recruiter), json={"base_revision": 0}).status_code == 200
    assert client.post(path, headers=auth(owner), json={"base_revision": 0}).status_code == 429
    assert client.post(path, headers=auth(recruiter), json={"base_revision": 0}).status_code == 429


def test_revoked_company_access_during_model_call_does_not_disclose_draft(client: TestClient,
        monkeypatch: pytest.MonkeyPatch) -> None:
    user, cid, jid = business(client)
    class Revoking(MockLLMProvider):
        async def generate(self, request: Any) -> Any:
            from sqlalchemy import delete

            from orbit_api.db import sessionmaker
            async with sessionmaker()() as db:
                await db.execute(delete(BizMember).where(BizMember.user_id == uid(user), BizMember.company_id == cid))
                await db.commit()
            return await super().generate(request)
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", Revoking)
    result = client.post(plan_url(cid, jid) + "/assist", headers=auth(user), json={"base_revision": 0})
    assert result.status_code == 404 and "criteria" not in result.text


def test_unverified_accounts_cannot_call_personal_ai(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import get_settings

    user = register(client, f"unverified-{tag()}@example.com", verified=False)
    contact(client, user)
    monkeypatch.setenv("ORBIT_EMAIL_VERIFICATION", "required")
    get_settings.cache_clear()
    mock = MockLLMProvider()
    monkeypatch.setattr("orbit_api.workflow_ai.get_llm_provider", lambda: mock)
    assert brief(client, user).status_code == 403
    assert not mock.requests
