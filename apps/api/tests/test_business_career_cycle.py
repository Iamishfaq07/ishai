"""Business screening/offer lifecycle and consented unattended Orbit Direct submissions."""
import json
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.auto_apply import direct, planner
from orbit_api.models import ApplicationPacket, AutoApplySetup, BizApplication, BizEvent, Resume, User
from tests.autoapply_helpers import account, user_id, verify_email
from tests.business_helpers import auth, db_call, make_client, new_company, new_job
from tests.test_business_hiring_studio import save_plan, setup


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch, ORBIT_WEB_URL="https://orbitanswer.test")


def key() -> str:
    return str(uuid.uuid4())


def screening(client: TestClient) -> tuple[dict[str, str], str, str, str, str]:
    owner, cid, job, aid, token = setup(client)
    save_plan(client, owner, cid, job["id"])
    path = f"/v1/business/companies/{cid}/applications/{aid}/saba"
    r = client.post(path + "/invite", headers=auth(owner), json={"request_id": key()})
    assert r.status_code == 200, r.text
    return owner, cid, aid, token, path


def start(client: TestClient, token: str, share: bool = False, **headers: str) -> dict[str, Any]:
    path = f"/v1/public/business/applications/{token}/saba"
    state = client.get(path).json()
    r = client.post(path + "/start", headers=headers, json={"consent": True,
        "notice_version": state["notice_version"], "share_network_country": share, "request_id": key()})
    assert r.status_code == 200, r.text
    return dict(r.json())


def test_business_saba_consent_frozen_questions_sealed_answers_and_retry(client: TestClient) -> None:
    owner, _cid, _aid, token, path = screening(client)
    public = f"/v1/public/business/applications/{token}/saba"
    before = client.get(public).json()
    assert before["prompt"] is None and before["transcript"] == []
    assert client.post(public + "/start", json={"consent": False,
        "notice_version": before["notice_version"], "request_id": key()}).status_code == 422
    state = start(client, token)
    assert state["prompt"] and "strong" not in state and "plan_snapshot" not in state
    body = {"message": "I implemented a persisted idempotency key and tested retries before calling the provider.",
        "base_revision": 0, "request_id": key()}
    first = client.post(public + "/answers", json=body)
    assert first.status_code == 200 and first.json()["revision"] == 1, first.text
    assert client.post(public + "/answers", json=body).json() == first.json()
    assert client.post(public + "/answers", json={**body, "request_id": key()}).status_code == 409
    state = first.json()
    while state["status"] == "in_progress":
        r = client.post(public + "/answers", json={**body, "base_revision": state["revision"], "request_id": key()})
        assert r.status_code == 200, r.text
        state = r.json()
    assert state["status"] == "completed" and len(state["transcript"]) == state["total"]
    assert client.get(path, headers=auth(owner)).json()["status"] == "completed"
    assert "review" not in client.get(public).json()


def test_saba_country_requires_consent_and_signed_edge_and_allows_explanations(client: TestClient) -> None:
    from orbit_api.config import get_settings
    owner, _cid, _aid, token, path = screening(client)
    state = start(client, token, share=True, **{"x-orbit-client-country": "US"})
    assert state["network_countries"] == []
    proxy = get_settings().proxy_secret
    assert proxy is not None
    signed = {"x-orbit-proxy-secret": proxy.get_secret_value(), "x-orbit-client-country": "IN"}
    public = f"/v1/public/business/applications/{token}/saba"
    for loc in ("IN", "DE"):
        r = client.post(public + "/answers", headers={**signed, "x-orbit-client-country": loc},
            json={"message": "I used a unique database key to keep each operation safe across retries.",
                "base_revision": state["revision"], "request_id": key()})
        assert r.status_code == 200, r.text
        state = r.json()
    assert state["network_countries"] == ["DE", "IN"]
    opted_out = client.post(public + "/stop-country-sharing", json={"request_id": key()})
    assert opted_out.status_code == 200 and not opted_out.json()["network_shared"]
    later = client.post(public + "/answers", headers={**signed, "x-orbit-client-country": "US"},
        json={"message": "I would use the same persisted key to check the provider's last result safely.",
            "base_revision": state["revision"], "request_id": key()})
    assert later.status_code == 200 and later.json()["network_countries"] == ["DE", "IN"], later.text
    state = later.json()
    assert all(v in ("not_measured", "not_verified") for v in state["detectors"].values())
    body = {"message": "My employer's corporate gateway routes traffic through another country.", "request_id": key()}
    assert client.post(public + "/explanation", json=body).status_code == 200
    reviewed = client.post(path + "/integrity-review", headers=auth(owner), json={**body,
        "disposition": "explained", "base_revision": state["revision"]})
    assert reviewed.status_code == 200, reviewed.text
    assert client.get(public).json()["integrity_review"]["disposition"] == "explained"


def test_saba_alternative_never_rejects_and_deletion_stops_writes(client: TestClient) -> None:
    owner, cid, aid, token, _path = screening(client)
    public = f"/v1/public/business/applications/{token}"
    r = client.post(public + "/saba/alternative", json={"message": "Please arrange a human-led conversation.",
        "request_id": key()})
    assert r.status_code == 200 and r.json()["status"] == "alternative_requested"
    detail = client.get(f"/v1/business/companies/{cid}/applications/{aid}", headers=auth(owner)).json()
    assert detail["status"] == "active"
    client.post(public + "/delete-request").raise_for_status()
    assert client.post(public + "/saba/explanation", json={"message": "Context after deletion request.",
        "request_id": key()}).status_code == 409


def test_offer_versions_and_exact_candidate_response_are_immutable(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    path = f"/v1/business/companies/{cid}/applications/{aid}/offer"
    body = {"role": "Backend Engineer", "compensation": "INR 2,400,000 per year", "start_date": "To be agreed",
        "terms": "Full-time role. We will arrange the formal agreement and onboarding with you.",
        "request_id": key(), "base_offer_id": None}
    first = client.post(path, headers=auth(owner), json=body)
    assert first.status_code == 200, first.text
    assert client.post(path, headers=auth(owner), json=body).json() == first.json()
    initial = first.json()["offer"]
    second = client.post(path, headers=auth(owner), json={**body, "request_id": key(),
        "base_offer_id": initial["id"], "compensation": "INR 2,600,000 per year"}).json()["offer"]
    public = f"/v1/public/business/applications/{token}/offer"
    response = {"offer_id": initial["id"], "response": "accepted", "acknowledge": True, "request_id": key()}
    assert client.post(public + "/respond", json=response).status_code == 409
    response["offer_id"] = second["id"]
    accepted = client.post(public + "/respond", json=response)
    assert accepted.status_code == 200 and accepted.json()["offer"]["status"] == "accepted", accepted.text
    assert client.post(public + "/respond", json=response).json() == accepted.json()
    assert client.post(public + "/respond", json={**response, "response": "declined"}).status_code == 409
    assert client.post(path, headers=auth(owner), json={**body, "request_id": key(),
        "base_offer_id": second["id"]}).status_code == 409


def test_direct_applies_without_browser_and_syncs_business_tracker_and_quota(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"], questions=[], workplace="remote", allowed_countries=["IN"],
        title=f"Backend Engineer {company['id'][:8]}", must_haves=["Python", "PostgreSQL", "AWS"])
    candidate, _rid = account(client, filters={"keywords": [company["id"][:8]], "days": 30})
    candidate_id = user_id(client, candidate)
    verify_email(client, candidate_id)
    async def plan(db: Any) -> Any:
        user = await db.get(User, candidate_id)
        report = await planner.plan_for_user(db, user, use_ai=False)
        packets = list(await db.scalars(select(ApplicationPacket).where(ApplicationPacket.user_id == candidate_id)))
        apps = list(await db.scalars(select(BizApplication).where(BizApplication.user_id == candidate_id)))
        return report, packets, apps
    report, packets, apps = db_call(client, plan)
    assert report.created == 1, report
    assert len(packets) == len(apps) == 1
    assert packets[0].status == "submitted" and packets[0].charge == "plan"
    assert apps[0].job_id == job["id"] and apps[0].tracker_id == packets[0].application_id
    assert apps[0].consent["delegated_by"] == "orbit_apply"
    assert client.get("/v1/apply/setup", headers=candidate).json()["executor_seen_at"] is None
    assert client.get("/v1/apply/setup", headers=candidate).json()["quota"]["used"] == 1
    assert client.get("/v1/jobs/tracker", headers=candidate).status_code == 200
    moved = client.post(f"/v1/business/companies/{company['id']}/applications/move", headers=auth(owner),
        json={"ids": [apps[0].id], "stage_id": "hired"})
    assert moved.status_code == 200, moved.text
    progress = client.get("/v1/apply/journey", headers=candidate).json()
    assert progress["tracker"]["hired"] == 1 and progress["next_step"] == "hired", progress
    report, packets, apps = db_call(client, plan)
    assert report.created == 0 and len(apps) == 1


def test_direct_review_first_and_two_workers_never_double_submit(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    new_job(client, owner, company["id"], questions=[], workplace="remote", allowed_countries=["IN"],
        title=f"Backend Engineer {company['id'][:8]}", must_haves=["Python", "PostgreSQL", "AWS"])
    candidate, _ = account(client, mode="review", filters={"keywords": [company["id"][:8]], "days": 30})
    candidate_id = user_id(client, candidate)
    verify_email(client, candidate_id)
    async def plan(db: Any) -> str:
        user = await db.get(User, candidate_id)
        await planner.plan_for_user(db, user, use_ai=False)
        packet = await db.scalar(select(ApplicationPacket).where(ApplicationPacket.user_id == candidate_id))
        assert packet.status == "review"
        return str(packet.id)
    packet_id = db_call(client, plan)
    client.post(f"/v1/apply/packets/{packet_id}/approve", headers=candidate).raise_for_status()
    barrier = Barrier(2)
    def send(_: int) -> bool:
        async def go(db: Any) -> bool:
            user = await db.get(User, candidate_id)
            return await direct.run_ready(db, user)
        barrier.wait()
        return bool(db_call(client, go))
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(send, range(2))) == [False, True]
    async def count(db: Any) -> int:
        return len(list(await db.scalars(select(BizEvent).where(
            BizEvent.kind == "applied", BizEvent.company_id == company["id"]))))
    assert db_call(client, count) == 1


def test_direct_questions_change_is_recoverable_without_sending_stale_answers(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"], questions=[], workplace="remote", allowed_countries=["IN"],
        title=f"Backend Engineer {company['id'][:8]}", must_haves=["Python", "PostgreSQL", "AWS"])
    candidate, _ = account(client, mode="review", filters={"keywords": [company["id"][:8]], "days": 30})
    candidate_id = user_id(client, candidate)
    verify_email(client, candidate_id)
    async def plan(db: Any) -> str:
        await planner.plan_for_user(db, await db.get(User, candidate_id), use_ai=False)
        return str((await db.scalar(select(ApplicationPacket).where(
            ApplicationPacket.user_id == candidate_id))).id)
    packet_id = db_call(client, plan)
    updated = client.patch(f"/v1/business/companies/{company['id']}/jobs/{job['id']}", headers=auth(owner), json={
        "questions": [{"id": "custom", "text": "Which observability stack did you use on your most recent project?",
            "kind": "short_text", "required": True}]})
    assert updated.status_code == 200, updated.text
    client.post(f"/v1/apply/packets/{packet_id}/approve", headers=candidate).raise_for_status()
    async def dispatch(db: Any) -> bool:
        return await direct.run_ready(db, await db.get(User, candidate_id))
    assert not db_call(client, dispatch)
    detail = client.get(f"/v1/apply/packets/{packet_id}", headers=candidate).json()
    assert detail["status"] == "needs_answer" and len(detail["missing_questions"]) == 1, detail
    assert client.get("/v1/apply/setup", headers=candidate).json()["quota"]["used"] == 0


def test_direct_pause_old_consent_and_unapproved_resume_all_stop_dispatch(client: TestClient) -> None:
    owner, company, _ = new_company(client)
    new_job(client, owner, company["id"], questions=[], workplace="remote", allowed_countries=["IN"],
        title=f"Backend Engineer {company['id'][:8]}", must_haves=["Python", "PostgreSQL", "AWS"])
    candidate, rid = account(client, mode="review", filters={"keywords": [company["id"][:8]], "days": 30})
    candidate_id = user_id(client, candidate)
    verify_email(client, candidate_id)
    async def prepare(db: Any) -> str:
        await planner.plan_for_user(db, await db.get(User, candidate_id), use_ai=False)
        return str((await db.scalar(select(ApplicationPacket).where(
            ApplicationPacket.user_id == candidate_id))).id)
    packet_id = db_call(client, prepare)
    client.post(f"/v1/apply/packets/{packet_id}/approve", headers=candidate).raise_for_status()
    async def stops(db: Any) -> None:
        user = await db.get(User, candidate_id)
        setup = await db.get(AutoApplySetup, candidate_id)
        setup.paused = True
        await db.commit()
        assert not await direct.run_ready(db, user)
        setup.paused, setup.consent_version = False, "2026-10-19"
        await db.commit()
        assert not await direct.run_ready(db, user)
        from orbit_api.auto_apply import rules
        setup.consent_version = rules.CONSENT_VERSION
        resume = await db.get(Resume, rid)
        resume.data = {**resume.data, "basics": {**resume.data["basics"], "name": "Edited Name"}}
        await db.commit()
        assert not await direct.run_ready(db, user)
    db_call(client, stops)
    assert client.get("/v1/apply/setup", headers=candidate).json()["quota"]["used"] == 0


def test_optional_ipinfo_snapshot_requires_separate_consent_and_never_retains_ip(
        client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from pydantic import SecretStr

    from orbit_api.business import network_check
    from orbit_api.config import get_settings

    _owner, _cid, aid, token, _path = screening(client)
    start(client, token)
    calls: list[str] = []
    def respond(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.host)
        assert request.headers["authorization"] == "Bearer test-ipinfo-token"
        return httpx.Response(200, json={"anonymous": {
            "is_vpn": True, "is_proxy": False, "is_tor": False, "is_relay": False}})
    monkeypatch.setattr(network_check, "TRANSPORT", httpx.MockTransport(respond))
    settings = get_settings()
    monkeypatch.setattr(settings, "business_ipinfo_token", SecretStr("test-ipinfo-token"))
    assert settings.proxy_secret is not None
    headers = {"x-orbit-proxy-secret": settings.proxy_secret.get_secret_value(), "x-orbit-client-ip": "8.8.8.8"}
    path = f"/v1/public/business/applications/{token}/saba"
    notice = client.get(path).json()["notice_version"]
    body = {"consent": False, "notice_version": notice, "request_id": key()}
    assert client.post(path + "/network-check", headers=headers, json=body).status_code == 422
    assert calls == []
    body["consent"] = True
    r = client.post(path + "/network-check", headers=headers, json=body)
    assert r.status_code == 200 and r.json()["network_check"]["is_vpn"] is True, r.text
    assert client.post(path + "/network-check", headers=headers, json=body).status_code == 200
    assert calls == ["api.ipinfo.io"]
    async def stored(db: Any) -> str:
        return str([e.data for e in await db.scalars(select(BizEvent).where(BizEvent.application_id == aid))])
    assert "8.8.8.8" not in db_call(client, stored)
    assert "test-ipinfo-token" not in r.text


def test_saba_voice_uses_only_the_current_server_question(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.business import screening as service
    _owner, _cid, _aid, token, _path = screening(client)
    state = start(client, token)
    spoken: list[tuple[str, str]] = []
    class Voice:
        name = "fixture"
        async def stream(self, text: str, model: str, speed: float = 1.0) -> Any:
            spoken.append((text, model))
            yield b"ID3-fixture-audio"
    monkeypatch.setattr(service, "get_tts_provider", lambda: Voice())
    path = f"/v1/public/business/applications/{token}/saba/speech"
    assert client.post(path, json={"revision": 0, "text": "Arbitrary speech must be refused"}).status_code == 422
    result = client.post(path, json={"revision": 0})
    assert result.status_code == 200 and result.json()["media_type"] == "audio/mpeg", result.text
    assert spoken == [(state["prompt"], "aura-2-aurora-en")]
    assert client.post(path, json={"revision": 1}).status_code == 409


def test_saba_ai_cites_exact_evidence_and_interviewers_get_transcript_without_identity_signals(
        client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.business_ai import llm
    from orbit_api.models import BizMember
    from orbit_api.providers.llm.base import LLMResponse, Usage
    from tests.business_helpers import register, uid
    from tests.test_business_hiring_studio import feedback

    owner, cid, aid, token, path = screening(client)
    public = f"/v1/public/business/applications/{token}/saba"
    state = start(client, token)
    while state["status"] == "in_progress":
        state = client.post(public + "/answers", json={"message":
            f"For project {state['revision']}, I introduced a persistent request key and checked the provider result.",
            "base_revision": state["revision"], "request_id": key()}).json()
    a, b = state["transcript"][:2]
    class Model:
        def supports_structured_output(self) -> bool:
            return True
        async def generate(self, req: Any) -> LLMResponse:
            return LLMResponse(text=json.dumps({"items": [{"turn_a": a["id"], "quote_a": a["answer"],
                "turn_b": b["id"], "quote_b": b["answer"],
                "question": "Which project should the team use as the reference for this example?"}]}),
                model="fixture-model", usage=Usage(input_tokens=20, output_tokens=20))
    monkeypatch.setattr(llm, "provider", Model)
    reviewed = client.post(path + "/review", headers=auth(owner))
    assert reviewed.status_code == 200 and len(reviewed.json()["review"]["items"]) == 1, reviewed.text
    assert "review" not in client.get(public).json()
    peer = register(client, f"saba-reviewer-{key()}@example.com")
    async def assign(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(peer), role="interviewer"))
        app = await db.get(BizApplication, aid)
        app.interviewers = [uid(peer)]
    db_call(client, assign)
    visible = client.get(path, headers=auth(peer))
    assert visible.status_code == 200 and visible.json()["transcript"], visible.text
    assert visible.json()["review"] is None and visible.json()["network_countries"] == []
    assert client.post(path + "/review", headers=auth(peer)).status_code == 403
    detail = f"/v1/business/companies/{cid}/applications/{aid}"
    jid = client.get(detail, headers=auth(owner)).json()["job_id"]
    plan = client.get(f"/v1/business/companies/{cid}/jobs/{jid}/hiring-plan", headers=auth(owner)).json()
    body = {**feedback(plan), "submit": True}
    body["ratings"][0].update(source="saba", quote="Fabricated evidence absent from every answer")
    assert client.put(detail + "/interview-feedback", headers=auth(peer), json=body).status_code == 422
    body["ratings"][0]["quote"] = a["answer"]
    assert client.put(detail + "/interview-feedback", headers=auth(peer), json=body).status_code == 200


def test_direct_and_external_executor_share_one_atomic_pacing_and_quota_gate(client: TestClient) -> None:
    from tests.test_auto_apply import _ready_packets

    owner, company, _ = new_company(client)
    new_job(client, owner, company["id"], questions=[], workplace="remote", allowed_countries=["IN"],
        title=f"Backend Engineer {company['id'][:8]}", must_haves=["Python", "PostgreSQL", "AWS"])
    candidate, _ = account(client, mode="review", filters={"keywords": [company["id"][:8]], "days": 30})
    candidate_id = user_id(client, candidate)
    verify_email(client, candidate_id)
    async def plan(db: Any) -> str:
        await planner.plan_for_user(db, await db.get(User, candidate_id), use_ai=False)
        return str((await db.scalar(select(ApplicationPacket).where(
            ApplicationPacket.user_id == candidate_id))).id)
    pid = db_call(client, plan)
    client.post(f"/v1/apply/packets/{pid}/approve", headers=candidate).raise_for_status()
    _ready_packets(client, candidate_id, 1, ["external"])
    barrier = Barrier(2)
    def worker(kind: str) -> bool:
        barrier.wait()
        if kind == "browser":
            result = client.get("/v1/apply/next", headers=candidate)
            assert result.status_code in (200, 204), result.text
            if result.status_code == 200:
                assert result.json()["job"]["ats"] == "lever"
            return result.status_code == 200
        async def send(db: Any) -> bool:
            return await direct.run_ready(db, await db.get(User, candidate_id))
        return bool(db_call(client, send))
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(worker, ("direct", "browser"))) == [False, True]
    assert client.get("/v1/apply/setup", headers=candidate).json()["quota"]["used"] == 1


def test_direct_sweep_rotates_past_blocked_accounts(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import UTC, datetime, timedelta

    from orbit_api.auto_apply import rules
    from orbit_api.models import AutoApplySetup

    ids = ["zz" + key()[2:] for _ in range(21)]
    async def seed(db: Any) -> None:
        for uid in ids:
            db.add(User(id=uid, email=f"{uid}@example.com", password_hash="unused", email_verified=True))
        await db.flush()
        for uid in ids:
            db.add(AutoApplySetup(user_id=uid, consent_at=datetime.now(UTC), consent_version=rules.CONSENT_VERSION))
            db.add(ApplicationPacket(user_id=uid, listing_id=key(), ats="orbit", status="ready",
                company="Example", company_key="example", title="Engineer", url="https://example.com/job",
                apply_url="https://example.com/apply", expires_at=datetime.now(UTC) + timedelta(days=1)))
    db_call(client, seed)
    seen: list[str] = []
    async def blocked(db: Any, user: User) -> bool:
        seen.append(user.id)
        return False
    monkeypatch.setattr(direct, "run_ready", blocked)
    monkeypatch.setattr(direct, "_dispatch_after", "zz")
    async def sweep(db: Any) -> None:
        assert await direct.dispatch_due() == 0
        assert await direct.dispatch_due() == 0
    db_call(client, sweep)
    assert seen == sorted(ids)
