"""Panel suggestions and candidate-led rescheduling through real routes, locks, calendars and task reconciliation."""
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.business.coordination import iso
from orbit_api.models import BizApplication, BizCompany, BizEvent, BizInterview, BizMember
from tests.business_helpers import auth, db_call, make_client, new_company, outbox, register, tag, uid
from tests.test_business_automations import config, queue, run
from tests.test_business_hiring_studio import setup


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch, ORBIT_WEB_URL="https://orbitanswer.test")


def interview(client: TestClient) -> tuple[Any, str, Any, str, str, dict[str, Any]]:
    owner, cid, job, aid, token = setup(client)
    async def seed(db: Any) -> None:
        start = datetime.now(UTC) + timedelta(days=2)
        db.add(BizInterview(company_id=cid, application_id=aid,
            slots=[iso(start + timedelta(days=i)) for i in range(3)],
            duration_min=30, created_by=uid(owner), panel_user_ids=[uid(owner)], location="https://meet.example.test/room"))
    db_call(client, seed)
    data = client.get(f"/v1/public/business/applications/{token}/scheduling-requests").json()
    return owner, cid, job, aid, token, data["interview"]


def change_body(iv: dict[str, Any]) -> dict[str, Any]:
    start = (datetime.now(UTC) + timedelta(days=5)).replace(hour=9, minute=0, second=0, microsecond=0)
    return {"request_id": str(uuid.uuid4()), "interview_id": iv["id"], "interview_revision": iv["revision"],
        "timezone": "Asia/Kolkata", "reason": "Please consider another time within this availability window.",
        "windows": [{"start": iso(start), "end": iso(start + timedelta(hours=3))}]}


def request_change(client: TestClient, token: str, iv: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    body = change_body(iv)
    r = client.post(f"/v1/public/business/applications/{token}/scheduling-requests", json=body)
    assert r.status_code == 200, r.text
    return r.json()["requests"][0], body


def reply_body(iv: dict[str, Any], item: dict[str, Any], *, offer: bool = True) -> dict[str, Any]:
    return {"request_id": str(uuid.uuid4()), "base_revision": item["revision"], "interview_revision": iv["revision"],
        "message": "Please review these alternative times and select one that works for you.",
        "slots": [item["windows"][0]["start"]] if offer else [], "notify": False}


def test_request_proposal_and_confirmed_replacement_preserve_calendar_and_booking(client: TestClient) -> None:
    owner, cid, _job, aid, token, iv = interview(client)
    public = f"/v1/public/business/applications/{token}"
    original_slot = client.get(public).json()["interview"]["slots"][0]
    client.post(public + "/book", json={"slot": original_slot}).raise_for_status()
    iv = client.get(public + "/scheduling-requests").json()["interview"]
    item, body = request_change(client, token, iv)
    assert client.post(public + "/scheduling-requests", json=body).json()["requests"][0]["id"] == item["id"]
    rbody = reply_body(iv, item)
    staff = f"/v1/business/companies/{cid}/applications/{aid}/scheduling-requests/{item['id']}/reply"
    r = client.post(staff, headers=auth(owner), json=rbody)
    assert r.status_code == 200, r.text
    assert r.json()["requests"][0]["status"] == "awaiting_candidate"
    assert client.post(staff, headers=auth(owner), json=rbody).json() == r.json()
    assert client.get(public).json()["interview"]["chosen"].replace("+00:00", "Z") == iv["chosen"]
    chosen = rbody["slots"][0]
    booked = client.post(public + "/book", json={"slot": chosen})
    assert booked.status_code == 200, booked.text
    result = client.get(public + "/scheduling-requests").json()
    assert result["requests"][0]["status"] == "resolved"
    assert result["interview"]["id"] == iv["id"] and result["interview"]["revision"] > iv["revision"]
    cal = client.get(public + "/calendar.ics").text
    assert f"UID:{iv['id']}" in cal and f"SEQUENCE:{result['interview']['revision']}" in cal
    client.post(public + "/book", json={"slot": chosen}).raise_for_status()
    assert client.get(public + "/scheduling-requests").json() == result
    # Returning to an earlier still-offered time must not resurrect a resolved time request.
    client.post(public + "/book", json={"slot": original_slot}).raise_for_status()
    assert client.get(public + "/scheduling-requests").json()["requests"][0]["status"] == "resolved"


def test_candidates_can_withdraw_request_without_cancelling_booking(client: TestClient) -> None:
    _owner, _cid, _job, _aid, token, iv = interview(client)
    path = f"/v1/public/business/applications/{token}"
    slot = client.get(path).json()["interview"]["slots"][0]
    client.post(path + "/book", json={"slot": slot}).raise_for_status()
    iv = client.get(path + "/scheduling-requests").json()["interview"]
    item, _body = request_change(client, token, iv)
    assert client.post(path + "/scheduling-requests", json=change_body(iv)).status_code == 409
    command = {"request_id": str(uuid.uuid4()), "base_revision": 0}
    r = client.post(path + f"/scheduling-requests/{item['id']}/withdraw", json=command)
    assert r.status_code == 200 and r.json()["requests"][0]["status"] == "withdrawn"
    assert client.post(path + f"/scheduling-requests/{item['id']}/withdraw", json=command).json() == r.json()
    assert client.get(path).json()["interview"]["chosen"].replace("+00:00", "Z") == iv["chosen"]


def test_message_only_reply_completes_request_and_notification_contains_no_identity(client: TestClient) -> None:
    owner, cid, _job, aid, token, iv = interview(client)
    item, _body = request_change(client, token, iv)
    r = client.post(f"/v1/business/companies/{cid}/applications/{aid}/scheduling-requests/{item['id']}/reply",
        headers=auth(owner), json=reply_body(iv, item, offer=False))
    assert r.status_code == 200 and r.json()["requests"][0]["status"] == "answered"
    alerts = client.get("/v1/business/notifications", headers=auth(owner)).json()
    scheduling = [a for a in alerts if a["kind"] == "scheduling"]
    assert len(scheduling) == 1 and scheduling[0]["link"].endswith(f"/applications/{aid}")
    assert "@" not in scheduling[0]["text"]


def test_slot_finder_uses_saved_panel_and_does_not_reserve_or_disclose_other_candidates(client: TestClient) -> None:
    owner, cid, _job, aid, token, iv = interview(client)
    start = datetime.now(UTC) + timedelta(days=5)
    body = {"windows": [{"start": iso(start), "end": iso(start + timedelta(hours=2))}],
        "duration_min": 30, "interview_id": iv["id"]}
    async def busy(db: Any) -> None:
        # A distinct application record is sufficient for a real booked panel conflict.
        app = await db.get(BizApplication, aid)
        other = BizApplication(company_id=cid, job_id=app.job_id, reference=f"A-{tag()}", name="PRIVATE CANDIDATE",
            email=f"{tag()}@example.com", stage_id=app.stage_id, status_token_hash=uuid.uuid4().hex * 2)
        db.add(other)
        await db.flush()
        db.add(BizInterview(company_id=cid, application_id=other.id, slots=[iso(start)], chosen=start,
            duration_min=60, panel_user_ids=[uid(owner)]))
    db_call(client, busy)
    path = f"/v1/business/companies/{cid}/applications/{aid}/interview-options"
    before = client.get(f"/v1/public/business/applications/{token}/scheduling-requests").json()
    r = client.post(path, headers=auth(owner), json=body)
    assert r.status_code == 200, r.text
    assert r.json()["slots"] and r.json()["slots"][0] == iso(start + timedelta(hours=1))
    assert "PRIVATE" not in r.text and "only" in r.json()["scope"]
    assert client.get(f"/v1/public/business/applications/{token}/scheduling-requests").json() == before


def test_conflict_after_proposal_does_not_drop_candidate_original_booking(client: TestClient) -> None:
    owner, cid, _job, aid, token, iv = interview(client)
    public = f"/v1/public/business/applications/{token}"
    client.post(public + "/book", json={"slot": client.get(public).json()["interview"]["slots"][0]}).raise_for_status()
    iv = client.get(public + "/scheduling-requests").json()["interview"]
    item, _body = request_change(client, token, iv)
    command = reply_body(iv, item)
    client.post(f"/v1/business/companies/{cid}/applications/{aid}/scheduling-requests/{item['id']}/reply",
        headers=auth(owner), json=command).raise_for_status()
    async def busy(db: Any) -> None:
        app = await db.get(BizApplication, aid)
        other = BizApplication(company_id=cid, job_id=app.job_id, reference=f"B-{tag()}", name="Another Candidate",
            email=f"{tag()}@example.com", stage_id=app.stage_id, status_token_hash=uuid.uuid4().hex * 2)
        db.add(other)
        await db.flush()
        db.add(BizInterview(company_id=cid, application_id=other.id, slots=command["slots"],
            chosen=datetime.fromisoformat(command["slots"][0].replace("Z", "+00:00")),
            duration_min=30, panel_user_ids=[uid(owner)]))
    db_call(client, busy)
    assert client.post(public + "/book", json={"slot": command["slots"][0]}).status_code == 409
    assert client.get(public).json()["interview"]["chosen"].replace("+00:00", "Z") == iv["chosen"]


@pytest.mark.parametrize("invalid", ["zone", "naive", "past", "long", "stale", "outside"])
def test_availability_and_reply_validation(client: TestClient, invalid: str) -> None:
    owner, cid, _job, aid, token, iv = interview(client)
    body = change_body(iv)
    if invalid == "zone":
        body["timezone"] = "Not/AZone"
    elif invalid == "naive":
        body["windows"][0]["start"] = "2026-12-01T09:00:00"
    elif invalid == "past":
        body["windows"] = [{"start": iso(datetime.now(UTC) - timedelta(hours=1)), "end": iso(datetime.now(UTC))}]
    elif invalid == "long":
        start = datetime.now(UTC) + timedelta(days=4)
        body["windows"] = [{"start": iso(start), "end": iso(start + timedelta(hours=13))}]
    elif invalid == "stale":
        body["interview_revision"] = 999
    if invalid == "outside":
        item, _body = request_change(client, token, iv)
        command = reply_body(iv, item)
        command["slots"] = [iso(datetime.now(UTC) + timedelta(days=10))]
        r = client.post(f"/v1/business/companies/{cid}/applications/{aid}/scheduling-requests/{item['id']}/reply",
            headers=auth(owner), json=command)
    else:
        r = client.post(f"/v1/public/business/applications/{token}/scheduling-requests", json=body)
    assert r.status_code == (409 if invalid == "stale" else 422), r.text


@pytest.mark.parametrize("state", ["withdrawn", "hired", "rejected", "deletion", "suspended", "unconfirmed"])
def test_terminal_applications_block_time_requests(client: TestClient, state: str) -> None:
    _owner, cid, _job, aid, token, iv = interview(client)
    async def stop(db: Any) -> None:
        app = await db.get(BizApplication, aid)
        if state == "deletion":
            app.deletion_requested_at = datetime.now(UTC)
        elif state == "suspended":
            (await db.get(BizCompany, cid)).status = "suspended"
        elif state == "unconfirmed":
            app.email_confirmed_at = None
        else:
            app.status = state
    db_call(client, stop)
    assert client.post(f"/v1/public/business/applications/{token}/scheduling-requests",
        json=change_body(iv)).status_code == 409


def test_tenant_scope_and_private_candidate_payload(client: TestClient) -> None:
    owner, cid, _job, aid, token, iv = interview(client)
    item, _body = request_change(client, token, iv)
    other, other_company, _ = new_company(client)
    peer = register(client, f"coordination-peer-{tag()}@example.com")
    async def member(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(peer), role="interviewer"))
        (await db.get(BizApplication, aid)).interviewers = [uid(peer)]
        db.add(BizEvent(company_id=cid, application_id=aid, job_id=_job["id"], kind="note",
            data={"message": "PRIVATE RECOMMENDATION"}))
    db_call(client, member)
    path = f"/v1/business/companies/{cid}/applications/{aid}/scheduling-requests"
    assert client.get(path, headers=auth(other)).status_code == 404
    assert client.get(path.replace(cid, other_company["id"]), headers=auth(other)).status_code == 404
    assert client.get(path, headers=auth(peer)).status_code == 403
    public = client.get(f"/v1/public/business/applications/{token}/scheduling-requests")
    assert "PRIVATE" not in public.text and "actor_id" not in public.text
    assert client.get("/v1/public/business/applications/invalid/scheduling-requests").status_code == 404
    assert client.post(path + f"/{item['id']}/reply", headers=auth(owner), json=reply_body(iv, item)).status_code == 200


def test_concurrent_replies_cannot_replace_each_other(client: TestClient) -> None:
    owner, cid, _job, aid, token, iv = interview(client)
    item, _body = request_change(client, token, iv)
    barrier = Barrier(2)
    def submit(_: int) -> int:
        body = reply_body(iv, item)
        barrier.wait()
        return client.post(f"/v1/business/companies/{cid}/applications/{aid}/scheduling-requests/{item['id']}/reply",
            headers=auth(owner), json=body).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(submit, range(2))) == [200, 409]


def test_scheduling_rule_is_opt_in_and_resolves_after_reply(client: TestClient) -> None:
    owner, cid, job, aid, token, iv = interview(client)
    item, _body = request_change(client, token, iv)
    async def earlier(db: Any) -> None:
        event = await db.get(BizEvent, item["id"])
        event.created_at = datetime.now(UTC) - timedelta(days=2)
    db_call(client, earlier)
    config(client, owner, cid, job["id"])
    assert not any(t["kind"] == "scheduling" for t in queue(client, owner, cid)["items"])
    config(client, owner, cid, job["id"], scheduling_hours=1)
    assert any(t["kind"] == "scheduling" for t in queue(client, owner, cid, "open")["items"])
    client.post(f"/v1/business/companies/{cid}/applications/{aid}/scheduling-requests/{item['id']}/reply",
        headers=auth(owner), json=reply_body(iv, item)).raise_for_status()
    run(client, owner, cid, job["id"])
    assert not any(t["kind"] == "scheduling" for t in queue(client, owner, cid, "open")["items"])


def test_request_deletion_removes_coordination_history(client: TestClient) -> None:
    owner, cid, _job, aid, token, iv = interview(client)
    request_change(client, token, iv)
    client.delete(f"/v1/business/companies/{cid}/applications/{aid}", headers=auth(owner)).raise_for_status()
    assert client.get(f"/v1/public/business/applications/{token}/scheduling-requests").status_code == 404
    async def remaining(db: Any) -> Any:
        return list(await db.scalars(select(BizEvent).where(BizEvent.application_id == aid)))
    assert db_call(client, remaining) == []


def test_explicit_email_notification_is_sent_once_on_retried_reply(client: TestClient) -> None:
    owner, cid, _job, aid, token, iv = interview(client)
    item, _body = request_change(client, token, iv)
    command = {**reply_body(iv, item), "notify": True}
    path = f"/v1/business/companies/{cid}/applications/{aid}/scheduling-requests/{item['id']}/reply"
    for _ in range(2):
        client.post(path, headers=auth(owner), json=command).raise_for_status()
    messages = [m for m in outbox().sent if m.subject.startswith("Interview scheduling update:") and token in m.text]
    assert len(messages) == 1 and command["message"] in messages[0].text


def test_idempotency_lookup_survives_bounded_recent_history(client: TestClient) -> None:
    _owner, cid, job, aid, token, iv = interview(client)
    _item, command = request_change(client, token, iv)
    async def older(db: Any) -> None:
        for i in range(21):
            event = BizEvent(company_id=cid, job_id=job["id"], application_id=aid,
                kind="interview_change_requested", created_at=datetime.now(UTC) + timedelta(seconds=i),
                data={"request_id": str(uuid.uuid4()), "interview_id": iv["id"], "timezone": "UTC",
                    "reason": "Historical fixture availability request.", "windows": command["windows"]})
            db.add(event)
            await db.flush()
            db.add(BizEvent(company_id=cid, job_id=job["id"], application_id=aid, kind="interview_change_closed",
                data={"change_id": event.id, "revision": 1}))
    db_call(client, older)
    r = client.post(f"/v1/public/business/applications/{token}/scheduling-requests", json=command)
    assert r.status_code == 200 and len(r.json()["requests"]) == 20
    async def count(db: Any) -> int:
        return len(list(await db.scalars(select(BizEvent).where(BizEvent.application_id == aid,
            BizEvent.kind == "interview_change_requested"))))
    assert db_call(client, count) == 22
