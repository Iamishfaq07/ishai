"""Hiring operations through real HTTP, tenant boundaries, event persistence and concurrent writers."""
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.models import BizApplication, BizCompany, BizEvent, BizMember
from tests.business_helpers import auth, db_call, make_client, new_company, outbox, register, tag, uid
from tests.test_business_hiring_studio import feedback, save_plan, setup


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch, ORBIT_WEB_URL="https://orbitanswer.test")


def question(client: TestClient, token: str, message: str = "Could you clarify the next interview format?") -> str:
    r = client.post(f"/v1/public/business/applications/{token}/clarification",
                    json={"message": message, "request_id": str(uuid.uuid4())})
    assert r.status_code == 201, r.text
    return str(client.get(f"/v1/public/business/applications/{token}/conversation").json()["threads"][0]["id"])


def answer(message: str = "The next conversation is a 30 minute discussion of your practical task.") -> dict[str, Any]:
    return {"message": message, "request_id": str(uuid.uuid4()), "notify": True}


def test_question_reply_and_candidate_activity_are_explicit_safe_and_idempotent(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    base = f"/v1/business/companies/{cid}/applications/{aid}"
    qid = question(client, token)
    # A generic email is not a reply to the saved question.
    client.post(base + "/email", headers=auth(owner), json={"kind": "received"}).raise_for_status()
    desk = client.get(f"/v1/business/companies/{cid}/hiring-desk", headers=auth(owner)).json()
    assert "question" in desk["attention"][0]["reason"]
    body = answer()
    def notifications() -> int:
        # DevOutbox keeps only the latest 100 messages; count this application's replies, not its total size.
        return sum(token in m.text and m.subject.startswith("The hiring team replied:") for m in outbox().sent)
    before = notifications()
    r = client.post(base + f"/questions/{qid}/reply", headers=auth(owner), json=body)
    assert r.status_code == 200, r.text
    assert notifications() == before + 1
    retry = client.post(base + f"/questions/{qid}/reply", headers=auth(owner), json=body)
    assert retry.json() == r.json() and notifications() == before + 1
    assert client.post(base + f"/questions/{qid}/reply", headers=auth(owner), json=answer()).status_code == 409
    public = client.get(f"/v1/public/business/applications/{token}/conversation").json()
    assert public["threads"][0]["reply"]["message"] == body["message"]
    assert public["threads"][0]["reply"]["author"] == "Hiring team"
    assert public["threads"][0]["reply"]["created_at"].endswith("+00:00")
    assert any("replied" in e["label"] for e in public["activity"])
    assert client.get(f"/v1/business/companies/{cid}/hiring-desk", headers=auth(owner)).json()["attention"] == []


def test_replying_to_one_question_does_not_clear_another(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    first = question(client, token)
    second = question(client, token, "May I use documentation during the practical challenge?")
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    client.post(path + f"/questions/{first}/reply", headers=auth(owner), json=answer()).raise_for_status()
    assert client.get(f"/v1/business/companies/{cid}/hiring-desk", headers=auth(owner)).json()["attention"]
    threads = client.get(f"/v1/public/business/applications/{token}/conversation").json()["threads"]
    assert next(q for q in threads if q["id"] == first)["reply"]
    assert next(q for q in threads if q["id"] == second)["reply"] is None


def test_question_retries_save_one_record_and_refuse_key_reuse(client: TestClient) -> None:
    _owner, _cid, _job, _aid, token = setup(client)
    path = f"/v1/public/business/applications/{token}"
    body = {"message": "Could you clarify the next interview format?", "request_id": str(uuid.uuid4())}
    for _ in range(2):
        assert client.post(path + "/clarification", json=body).status_code == 201
    assert len(client.get(path + "/conversation").json()["threads"]) == 1
    assert client.post(path + "/clarification",
        json={**body, "message": "Different text must not reuse this request identifier."}).status_code == 409


def test_two_recruiters_cannot_overwrite_or_double_notify_a_reply(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    qid = question(client, token)
    path = f"/v1/business/companies/{cid}/applications/{aid}/questions/{qid}/reply"
    barrier = Barrier(2)
    def notifications() -> int:
        return sum(token in m.text and m.subject.startswith("The hiring team replied:") for m in outbox().sent)
    before = notifications()
    def publish(_: int) -> int:
        body = answer()
        barrier.wait()
        return client.post(path, headers=auth(owner), json=body).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(publish, range(2))) == [200, 409]
    assert notifications() == before + 1


def test_conversation_tenant_role_cursor_and_deletion_boundaries(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    qid = question(client, token)
    other, other_cid, _ = new_company(client)
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    assert client.get(path + "/conversation", headers=auth(other)).status_code == 404
    assert client.post(path.replace(cid, other_cid["id"]) + f"/questions/{qid}/reply",
        headers=auth(other), json=answer()).status_code == 404
    peer = register(client, f"reviewer-{tag()}@example.com")
    async def assign(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(peer), role="interviewer"))
        app = await db.get(BizApplication, aid)
        app.interviewers = [uid(peer)]
    db_call(client, assign)
    assert client.get(path + "/conversation", headers=auth(peer)).status_code == 200
    assert client.post(path + f"/questions/{qid}/reply", headers=auth(peer), json=answer()).status_code == 403
    assert client.get("/v1/public/business/applications/invalid/conversation").status_code == 404
    client.post(f"/v1/public/business/applications/{token}/delete-request").raise_for_status()
    assert client.post(path + f"/questions/{qid}/reply", headers=auth(owner), json=answer()).status_code == 409
    assert not client.get(path + "/conversation", headers=auth(owner)).json()["accepting"]
    assert not client.get(f"/v1/public/business/applications/{token}/conversation").json()["accepting"]
    client.delete(path, headers=auth(owner)).raise_for_status()
    assert client.get(f"/v1/public/business/applications/{token}/conversation").status_code == 404


def test_question_pagination_handles_equal_timestamps_and_never_crosses_applications(client: TestClient) -> None:
    _owner, cid, _job, aid, token = setup(client)
    stamp = datetime.now(UTC)
    async def seed(db: Any) -> str:
        for i in range(23):
            db.add(BizEvent(company_id=cid, application_id=aid, job_id=_job["id"], kind="candidate_question",
                created_at=stamp, data={"message": f"Question number {i}: clarify the interview please."}))
        secret = BizEvent(company_id=cid, application_id=aid, job_id=_job["id"], kind="note",
            data={"message": "PRIVATE PANEL INFORMATION"})
        db.add(secret)
        await db.flush()
        return str(secret.id)
    secret_id = db_call(client, seed)
    path = f"/v1/public/business/applications/{token}/conversation"
    first = client.get(path).json()
    assert len(first["threads"]) == 20 and first["next_before"]
    second = client.get(path, params={"before": first["next_before"]}).json()
    assert len(second["threads"]) == 3 and second["next_before"] is None
    assert not ({q["id"] for q in first["threads"]} & {q["id"] for q in second["threads"]})
    assert client.get(path, params={"before": secret_id}).status_code == 404
    assert "PRIVATE PANEL INFORMATION" not in str(first)


def test_public_activity_never_exposes_private_feedback_notes_or_stage_names(client: TestClient) -> None:
    _owner, cid, job, aid, token = setup(client)
    async def seed(db: Any) -> None:
        for kind in ("note", "feedback_submitted", "feedback_addendum", "hiring_decision", "ranked", "email"):
            db.add(BizEvent(company_id=cid, job_id=job["id"], application_id=aid, kind=kind,
                actor_name="PRIVATE STAFF", data={"message": "SECRET SCORE", "rationale": "SECRET SCORE",
                    "subject": "SECRET SCORE"}))
        db.add(BizEvent(company_id=cid, job_id=job["id"], application_id=aid, kind="stage",
            data={"to": "secret-round"}))
    db_call(client, seed)
    data = client.get(f"/v1/public/business/applications/{token}/conversation").json()
    assert not any(value in str(data) for value in ("PRIVATE STAFF", "SECRET SCORE", "secret-round", "actor_id"))
    assert data["activity"] and all(set(e) == {"id", "label", "created_at"} for e in data["activity"])


def test_addenda_preserve_original_feedback_and_invalidate_old_decisions(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    plan = save_plan(client, owner, cid, job["id"])
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    content = feedback(plan)
    r = client.put(path + "/interview-feedback", headers=auth(owner), json={**content, "submit": True})
    original = r.json()["feedback"][0]
    room = client.get(path + "/hiring-room", headers=auth(owner)).json()
    assert r.json()["evidence_version"] == room["evidence_version"]  # SQLite timezone roundtrip
    decision = {"outcome": "hold", "rationale": "Wait for another concrete example before deciding the final outcome.",
                "base_evidence_version": room["evidence_version"]}
    decided = client.post(path + "/hiring-decision", headers=auth(owner), json=decision)
    assert decided.status_code == 200 and not decided.json()["decision_outdated"], decided.text
    body = {"reason": "Clarifying the observation source",
            "message": "This example came from the practical task discussion, not from a production incident.",
            "request_id": str(uuid.uuid4()), "base_addendum_count": 0}
    endpoint = path + f"/feedback/{original['id']}/addenda"
    added = client.post(endpoint, headers=auth(owner), json=body)
    assert added.status_code == 200, added.text
    row = added.json()["feedback"][0]
    assert row["content"] == original["content"] and row["revision"] == original["revision"]
    assert len(row["addenda"]) == 1 and added.json()["decision_outdated"]
    retry = client.post(endpoint, headers=auth(owner), json=body)
    assert retry.json()["evidence_version"] == added.json()["evidence_version"]
    assert client.post(endpoint, headers=auth(owner), json={**body, "request_id": str(uuid.uuid4())}).status_code == 409
    assert client.post(path + "/hiring-decision", headers=auth(owner), json=decision).status_code == 409


def test_private_drafts_do_not_change_the_decision_evidence_version(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    plan = save_plan(client, owner, cid, job["id"])
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    before = client.get(path + "/hiring-room", headers=auth(owner)).json()
    draft = client.put(path + "/interview-feedback", headers=auth(owner), json=feedback(plan)).json()
    assert draft["evidence_version"] == before["evidence_version"]
    fid = draft["feedback"][0]["id"]
    body = {"reason": "Not ready to share yet",
            "message": "This text should remain in the private draft until it is submitted.",
            "request_id": str(uuid.uuid4()), "base_addendum_count": 0}
    assert client.post(path + f"/feedback/{fid}/addenda", headers=auth(owner), json=body).status_code == 409


def test_addenda_follow_author_ownership_independent_feedback_and_blind_review(client: TestClient) -> None:
    owner, cid, job, aid, token = setup(client)
    plan = save_plan(client, owner, cid, job["id"])
    peer = register(client, f"peer-{tag()}@example.com")
    async def assign(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(peer), role="interviewer"))
        app = await db.get(BizApplication, aid)
        app.interviewers = [uid(peer)]
        company = await db.get(BizCompany, cid)
        company.blind_review = True
    db_call(client, assign)
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    sealed = client.put(path + "/interview-feedback", headers=auth(owner),
                        json={**feedback(plan), "submit": True}).json()
    fid = sealed["feedback"][0]["id"]
    body = {"reason": "Priya Sharma gave new context",
            "message": "Priya Sharma clarified that the example was a test environment with fictional orders.",
            "request_id": str(uuid.uuid4()), "base_addendum_count": 0}
    endpoint = path + f"/feedback/{fid}/addenda"
    assert client.post(endpoint, headers=auth(peer), json=body).status_code == 403
    r = client.post(endpoint, headers=auth(owner), json=body)
    assert r.status_code == 200 and "Priya Sharma" not in str(r.json()["feedback"]), r.text
    assert client.get(path + "/hiring-room", headers=auth(peer)).json()["feedback"] == []
    timeline = client.get(path, headers=auth(peer)).json()["timeline"]
    assert not any(e["kind"] == "feedback_addendum" for e in timeline)
    own = client.put(path + "/interview-feedback", headers=auth(peer), json={**feedback(plan), "submit": True})
    assert any(f["addenda"] for f in own.json()["feedback"]), own.text
    public = client.get(f"/v1/public/business/applications/{token}/conversation").json()
    assert "test environment" not in str(public)


def test_desk_prioritises_pending_questions_before_old_idle_applications(client: TestClient) -> None:
    owner, cid, job, aid, token = setup(client)
    question(client, token)
    prefix = tag()[:4]
    async def seed(db: Any) -> None:
        old = datetime.now(UTC) - timedelta(days=10)
        for i in range(2000):
            db.add(BizApplication(company_id=cid, job_id=job["id"], reference=f"{prefix}{i:08}",
                name="Idle applicant", email=f"idle-{prefix}-{i}@example.com", resume_text="",
                status_token_hash=uuid.uuid4().hex * 2, stage_id="applied", status="active", stage_changed_at=old))
    db_call(client, seed)
    desk = client.get(f"/v1/business/companies/{cid}/hiring-desk", headers=auth(owner)).json()
    assert desk["limited"] and desk["attention"][0]["application_id"] == aid
    assert "question" in desk["attention"][0]["reason"]


def test_invisible_text_cannot_be_published_as_a_question_or_reply(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    path = f"/v1/public/business/applications/{token}"
    assert client.post(path + "/clarification", json={"message": "\u200b" * 30}).status_code == 422
    qid = question(client, token)
    assert client.post(f"/v1/business/companies/{cid}/applications/{aid}/questions/{qid}/reply",
        headers=auth(owner), json=answer("\u200b" * 40)).status_code == 422
