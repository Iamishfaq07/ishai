"""Business interview workflows through real routers, persistence, permissions and public token boundaries."""
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.models import BizApplication, BizMember, BizNote
from tests.business_helpers import (
    applications,
    apply_signed_out,
    auth,
    confirm_applicant,
    db_call,
    grant,
    make_client,
    new_company,
    new_job,
    outbox,
    register,
    tag,
    uid,
)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch, ORBIT_WEB_URL="https://orbitanswer.test")


def setup(client: TestClient) -> tuple[dict[str, str], str, dict[str, Any], str, str]:
    owner, company, _ = new_company(client)
    job = new_job(client, owner, company["id"])
    email = f"studio-{tag()}@example.com"
    assert apply_signed_out(client, job["id"], email).status_code == 200
    token = confirm_applicant(client, email)
    aid = applications(client, owner, company["id"], job["id"])["items"][0]["id"]
    return owner, company["id"], job, aid, token


def save_plan(client: TestClient, owner: dict[str, str], cid: str, jid: str,
              sample: bool = False) -> dict[str, Any]:
    path = f"/v1/business/companies/{cid}/jobs/{jid}/hiring-plan"
    draft = client.get(path, headers=auth(owner)).json()
    if sample:
        draft["plan"]["work_sample"] = {"title": "Handle duplicated orders",
            "brief": "A queue retries orders. Describe a safe way to prevent duplicate charges and a useful test.",
            "change_request": "The provider times out after charging. Explain how you would recover safely.",
            "time_box_min": 25, "required": True,
            "candidate_guidance": "You may use tools. Disclose assistance and explain your own decisions."}
    r = client.put(path, headers=auth(owner), json={"base_revision": draft["revision"], "plan": draft["plan"]})
    assert r.status_code == 200, r.text
    return dict(r.json())


def feedback(plan: dict[str, Any], score: int = 3) -> dict[str, Any]:
    c = plan["plan"]["criteria"][0]
    return {"base_revision": 0, "plan_revision": plan["revision"], "stage_id": c["stage_id"], "submit": False,
        "recommendation": "hire", "summary": "Clear example; validate the scaling assumptions in the next round.",
        "ratings": [{"criterion_id": c["id"], "score": score, "source": "interview", "quote": "",
                     "observation": "Explained an idempotency key and a concrete retry test without prompting."}]}


def test_interview_plan_revisions_permissions_and_protected_questions(client: TestClient) -> None:
    owner, cid, job, _aid, _token = setup(client)
    plan = save_plan(client, owner, cid, job["id"])
    path = f"/v1/business/companies/{cid}/jobs/{job['id']}/hiring-plan"
    assert plan["revision"] == 1 and plan["plan"]["criteria"]
    stale = client.put(path, headers=auth(owner), json={"base_revision": 0, "plan": plan["plan"]})
    assert stale.status_code == 409
    outsider = register(client, f"outsider-{tag()}@example.com")
    assert client.get(path, headers=auth(outsider)).status_code == 404
    plan["plan"]["criteria"][0]["question"] = "How old are you and are you married?"
    assert client.put(path, headers=auth(owner), json={"base_revision": 1, "plan": plan["plan"]}).status_code == 422


def test_private_drafts_evidence_validation_and_sealed_submission(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    plan = save_plan(client, owner, cid, job["id"])
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    body = feedback(plan)
    saved = client.put(path + "/interview-feedback", headers=auth(owner), json=body)
    assert saved.status_code == 200, saved.text
    mine = saved.json()["feedback"][0]
    assert mine["revision"] == 1 and mine["submitted_at"] is None
    assert client.put(path + "/interview-feedback", headers=auth(owner), json=body).status_code == 409
    bad = {**body, "base_revision": 1, "submit": True,
           "ratings": [{**body["ratings"][0], "source": "resume", "quote": "An invented quotation."}]}
    assert client.put(path + "/interview-feedback", headers=auth(owner), json=bad).status_code == 422
    submitted = client.put(path + "/interview-feedback", headers=auth(owner),
                           json={**body, "base_revision": 1, "submit": True})
    assert submitted.status_code == 200 and submitted.json()["feedback"][0]["submitted_at"], submitted.text
    assert submitted.json()["coverage"][0]["assessed"]
    body["summary"] = "Attempt to change feedback after reading the panel."
    assert client.put(path + "/interview-feedback", headers=auth(owner),
                      json={**body, "base_revision": 2}).status_code == 409
    assert client.post(path + "/scorecards", headers=auth(owner),
        json={"stage_id": body["stage_id"], "ratings": [{"criterion": "Anything", "score": 4}],
              "recommendation": "hire"}).status_code == 409


def test_independent_panel_feedback_is_hidden_until_own_submission(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    grant(client, cid, "starter")
    peer = register(client, f"peer-{tag()}@example.com", "Independent reviewer")
    async def member(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(peer), role="interviewer"))
        app = await db.get(BizApplication, aid)
        app.interviewers = [uid(peer)]
    db_call(client, member)
    plan = save_plan(client, owner, cid, job["id"])
    body = feedback(plan)
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    assert client.put(path + "/interview-feedback", headers=auth(owner),
                      json={**body, "submit": True}).status_code == 200
    hidden = client.get(path + "/hiring-room", headers=auth(peer)).json()
    assert hidden["feedback"] == [] and hidden["feedback_locked"]
    legacy = client.get(path, headers=auth(peer)).json()
    assert legacy["ranking"] is None and legacy["score"] is None and legacy["match_label"] is None
    listed = applications(client, peer, cid, job["id"])
    assert listed["items"][0]["score"] is None
    own = client.put(path + "/interview-feedback", headers=auth(peer), json={**body, "submit": True})
    assert own.status_code == 200, own.text
    assert len(own.json()["feedback"]) == 2 and not own.json()["feedback_locked"]


def test_practical_challenge_is_two_phase_immutable_and_private(client: TestClient) -> None:
    owner, cid, job, aid, token = setup(client)
    save_plan(client, owner, cid, job["id"], sample=True)
    base = f"/v1/business/companies/{cid}/applications/{aid}"
    assert client.post(base + "/work-sample", headers=auth(owner)).status_code == 200
    path = f"/v1/public/business/applications/{token}/work-sample"
    initial = client.get(path).json()
    assert initial["sample"]["change_request"] is None
    assert initial["interview_brief"]["areas"] == job["must_haves"]
    answer = {"base_revision": 1, "response": "I persist an order identifier before attempting a payment.",
              "explanation": "The identifier lets a retry recover the same order without repeating the charge.",
              "assistance": "documentation"}
    assert client.post(path + "?follow_up=true", json=answer).status_code == 409
    first = client.post(path, json=answer)
    assert first.status_code == 200 and first.json()["sample"]["change_request"], first.text
    assert client.post(path, json=answer).status_code == 200  # network retry, no overwrite
    assert client.post(path, json={**answer, "response": "A different answer must not overwrite the submission."}
                       ).status_code == 409
    final = client.post(path + "?follow_up=true", json={**answer, "base_revision": 2,
        "response": "I reconcile using the provider's idempotency key before retrying the charge."})
    assert final.status_code == 200 and final.json()["sample"]["completed_at"], final.text
    desk = client.get(f"/v1/business/companies/{cid}/hiring-desk", headers=auth(owner)).json()
    assert desk["attention"][0]["reason"] == "Practical challenge complete; review their adaptation"
    assert client.get(path.replace(token, "invalid-link")).status_code == 404
    # Candidate responses never expose the company's panel, scores, decisions or private questions.
    assert not any(key in str(initial) for key in ("author_id", "recommendation", "evidence_version"))
    assert client.delete(base, headers=auth(owner)).status_code == 204
    assert client.get(path).status_code == 404


def test_decisions_require_current_evidence_and_explicit_gap_acknowledgement(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    save_plan(client, owner, cid, job["id"])
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    room = client.get(path + "/hiring-room", headers=auth(owner)).json()
    body = {"outcome": "hire", "rationale": "We reviewed the recorded evidence and will validate remaining gaps.",
            "base_evidence_version": room["evidence_version"], "acknowledge_gaps": False}
    assert client.post(path + "/hiring-decision", headers=auth(owner), json=body).status_code == 422
    assert client.post(path + "/hiring-decision", headers=auth(owner),
                       json={**body, "base_evidence_version": "0" * 64}).status_code == 409
    decided = client.post(path + "/hiring-decision", headers=auth(owner),
                          json={**body, "acknowledge_gaps": True})
    assert decided.status_code == 200 and decided.json()["decisions"][0]["acknowledged_gaps"], decided.text
    # Recording a human decision does not silently move/reject/hire the candidate.
    assert decided.json()["status"] == "active"


def test_shared_panel_cannot_be_double_booked_and_retries_send_no_duplicate_mail(client: TestClient) -> None:
    owner, cid, job, aid, token = setup(client)
    email = f"second-{tag()}@example.com"
    apply_signed_out(client, job["id"], email).raise_for_status()
    token2 = confirm_applicant(client, email)
    ids = applications(client, owner, cid, job["id"])["items"]
    aid2 = next(a["id"] for a in ids if a["id"] != aid)
    start = (datetime.now(UTC) + timedelta(days=2)).replace(microsecond=0)
    slots = [(start + timedelta(hours=i)).isoformat().replace("+00:00", "Z") for i in range(3)]
    for app_id in (aid, aid2):
        r = client.post(f"/v1/business/companies/{cid}/applications/{app_id}/interview",
            headers=auth(owner), json={"slots": slots, "location": "Video call", "duration_min": 30})
        assert r.status_code == 201, r.text
    path = f"/v1/public/business/applications/{token}/book"
    r = client.post(path, json={"slot": slots[0]})
    assert r.status_code == 200, r.text
    total = len(outbox().sent)
    assert client.post(path, json={"slot": slots[0]}).status_code == 200
    assert len(outbox().sent) == total
    busy = client.post(f"/v1/public/business/applications/{token2}/book", json={"slot": slots[0]})
    assert busy.status_code == 409, busy.text
    assert client.post(f"/v1/public/business/applications/{token2}/book", json={"slot": slots[1]}).status_code == 200
    calendar = client.get(f"/v1/public/business/applications/{token}/calendar.ics")
    assert calendar.status_code == 200 and "BEGIN:VEVENT" in calendar.text and "Cache-Control" in calendar.headers


def test_candidate_question_reaches_room_without_an_email_relay(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    r = client.post(f"/v1/public/business/applications/{token}/clarification",
                    json={"message": "Could you clarify the format and expected discussion time?"})
    assert r.status_code == 201, r.text
    room = client.get(f"/v1/business/companies/{cid}/applications/{aid}/hiring-room", headers=auth(owner)).json()
    assert room["candidate_questions"][0]["message"].startswith("Could you clarify")
    desk = client.get(f"/v1/business/companies/{cid}/hiring-desk", headers=auth(owner)).json()
    assert desk["attention"][0]["application_id"] == aid
    assert "question" in desk["attention"][0]["reason"]


def test_cancel_revokes_booking_frees_panel_and_allows_a_new_offer(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    start = datetime.now(UTC) + timedelta(days=2)
    slots = [(start + timedelta(hours=i)).isoformat().replace("+00:00", "Z") for i in range(3)]
    body = {"slots": slots, "location": "Our office", "duration_min": 30}
    assert client.post(path + "/interview", headers=auth(owner), json=body).status_code == 201
    public = f"/v1/public/business/applications/{token}"
    assert client.post(public + "/book", json={"slot": slots[0]}).status_code == 200
    uid_line = next(s for s in client.get(public + "/calendar.ics").text.splitlines() if s.startswith("UID:"))
    assert client.post(path + "/interview", headers=auth(owner), json=body).status_code == 409
    cancelled = client.post(path + "/interview/cancel", headers=auth(owner))
    assert cancelled.status_code == 200, cancelled.text
    assert client.get(public).json()["interview"] is None
    assert client.get(public + "/calendar.ics").status_code == 404
    assert client.post(public + "/book", json={"slot": slots[0]}).status_code == 422
    attached = outbox().sent[-1].attachments[0][2].decode()
    assert uid_line in attached and "STATUS:CANCELLED" in attached and "SEQUENCE:2" in attached
    total = len(outbox().sent)
    assert client.post(path + "/interview/cancel", headers=auth(owner)).status_code == 200
    assert len(outbox().sent) == total
    desk = client.get(f"/v1/business/companies/{cid}/hiring-desk", headers=auth(owner)).json()
    assert desk["upcoming"] == []
    assert client.post(path + "/interview", headers=auth(owner), json=body).status_code == 201


def test_decision_and_assignment_retries_do_not_duplicate_records_or_mail(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    save_plan(client, owner, cid, job["id"], sample=True)
    base = f"/v1/business/companies/{cid}/applications/{aid}"
    assert client.post(base + "/work-sample", headers=auth(owner)).status_code == 200
    total = len(outbox().sent)
    assert client.post(base + "/work-sample", headers=auth(owner)).status_code == 200
    assert len(outbox().sent) == total
    room = client.get(base + "/hiring-room", headers=auth(owner)).json()
    body = {"outcome": "hold", "rationale": "Collect the practical challenge evidence before scheduling a final round.",
            "base_evidence_version": room["evidence_version"]}
    for _ in range(2):
        r = client.post(base + "/hiring-decision", headers=auth(owner), json=body)
        assert r.status_code == 200, r.text
    assert len(r.json()["decisions"]) == 1


def test_older_feedback_keeps_its_rubric_and_invalid_quotes_never_become_evidence(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    plan = save_plan(client, owner, cid, job["id"])
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    body = feedback(plan)
    assert client.put(path + "/interview-feedback", headers=auth(owner), json=body).status_code == 200
    newer = {**plan["plan"], "candidate_intro": "This role now has an updated introduction for candidates."}
    assert client.put(f"/v1/business/companies/{cid}/jobs/{job['id']}/hiring-plan", headers=auth(owner),
        json={"base_revision": 1, "plan": newer}).status_code == 200
    sealed = client.put(path + "/interview-feedback", headers=auth(owner),
                        json={**body, "base_revision": 1, "submit": True})
    assert sealed.status_code == 200, sealed.text
    data = sealed.json()
    assert data["feedback"][0]["plan_revision"] == 1 and data["plan"]["revision"] == 2
    assert any("earlier plan" in g for g in data["gaps"])


def test_compare_requires_same_job_and_company_and_distinct_people(client: TestClient) -> None:
    owner, cid, job, aid, _token = setup(client)
    grant(client, cid, "growth")
    second_job = new_job(client, owner, cid)
    email = f"other-job-{tag()}@example.com"
    apply_signed_out(client, second_job["id"], email).raise_for_status()
    other = applications(client, owner, cid, second_job["id"])["items"][0]["id"]
    path = f"/v1/business/companies/{cid}/jobs/{job['id']}/compare"
    assert client.get(path, params={"ids": [aid, aid]}, headers=auth(owner)).status_code == 422
    assert client.get(path, params={"ids": [aid, other]}, headers=auth(owner)).status_code == 404
    outsider, other_company, _ = new_company(client)
    assert client.get(path.replace(cid, other_company["id"]), params={"ids": [aid, other]},
                      headers=auth(outsider)).status_code == 404


def test_deletion_request_prevents_new_challenges_feedback_and_candidate_writes(client: TestClient) -> None:
    owner, cid, job, aid, token = setup(client)
    plan = save_plan(client, owner, cid, job["id"], sample=True)
    base = f"/v1/business/companies/{cid}/applications/{aid}"
    assert client.post(base + "/work-sample", headers=auth(owner)).status_code == 200
    public = f"/v1/public/business/applications/{token}"
    assert client.post(public + "/delete-request").status_code == 200
    assert client.post(base + "/work-sample", headers=auth(owner)).status_code == 409
    assert client.put(base + "/interview-feedback", headers=auth(owner), json=feedback(plan)).status_code == 409
    assert client.post(public + "/clarification",
                       json={"message": "Can you still accept a new answer?"}).status_code == 409
    assert not client.get(public + "/work-sample").json()["accepting"]


def test_blind_review_masks_notes_and_work_sample_identity(client: TestClient) -> None:
    owner, cid, job, aid, token = setup(client)
    plan = save_plan(client, owner, cid, job["id"], sample=True)
    base = f"/v1/business/companies/{cid}/applications/{aid}"
    client.post(base + "/work-sample", headers=auth(owner)).raise_for_status()
    answer = {"base_revision": 1, "response": "I am Priya Sharma and would use a stored idempotency key for retries.",
              "explanation": "Priya Sharma verifies the provider response before attempting a second charge.",
              "assistance": "none"}
    client.post(f"/v1/public/business/applications/{token}/work-sample", json=answer).raise_for_status()
    from orbit_api.models import BizCompany

    async def change(db: Any) -> None:
        company = await db.get(BizCompany, cid)
        company.blind_review = True
        db.add(BizNote(company_id=cid, application_id=aid, author_id=uid(owner), author_name="Owner",
                       body="Priya Sharma demonstrated a retry example.", mentions=[]))
    db_call(client, change)
    room = client.get(base + "/hiring-room", headers=auth(owner)).json()
    assert "Priya Sharma" not in str(room)
    detail = client.get(base, headers=auth(owner)).json()
    assert "Priya Sharma" not in detail["notes"][0]["body"]
    body = feedback(plan)
    body["ratings"][0].update({"source": "work_sample", "quote": room["work_sample"]["answer"]["response"]})
    r = client.put(base + "/interview-feedback", headers=auth(owner), json=body)
    assert r.status_code == 200, r.text


@pytest.mark.parametrize(("suffix", "method", "body"), [
    ("work-sample", "GET", None), ("calendar.ics", "GET", None),
    ("clarification", "POST", {"message": "Please clarify the assessment format."}),
    ("work-sample", "POST", {"base_revision": 1, "response": "A concrete solution to the task with enough detail.",
        "explanation": "These trade-offs explain how I reached my proposed solution.", "assistance": "none"}),
])
def test_public_studio_routes_require_a_real_application_token(
        client: TestClient, suffix: str, method: str, body: dict[str, Any] | None) -> None:
    r = client.request(method, f"/v1/public/business/applications/invalid-token/{suffix}", json=body)
    assert r.status_code == 404


def test_concurrent_plan_creation_has_one_winner(client: TestClient) -> None:
    owner, cid, job, _aid, _token = setup(client)
    path = f"/v1/business/companies/{cid}/jobs/{job['id']}/hiring-plan"
    plan = client.get(path, headers=auth(owner)).json()["plan"]
    barrier = Barrier(4)
    def save(_: int) -> int:
        barrier.wait()
        return client.put(path, headers=auth(owner), json={"base_revision": 0, "plan": plan}).status_code
    with ThreadPoolExecutor(max_workers=4) as pool:
        codes = list(pool.map(save, range(4)))
    assert sorted(codes) == [200, 409, 409, 409]
