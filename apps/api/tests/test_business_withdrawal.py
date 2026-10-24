"""Candidate withdrawal through HTTP: terminal state, cancellation, races, ownership and retention."""

import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier, Event
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.models import (
    ApplicationPacket,
    BizApplication,
    BizCompany,
    BizEvent,
    BizInterview,
    BizMember,
    BizNotification,
    JobApplication,
    User,
)
from tests.business_helpers import auth, db_call, make_client, new_company, new_job, outbox, register, uid, wait_ranked
from tests.test_business_hiring_studio import save_plan, setup


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    yield from make_client(monkeypatch, ORBIT_WEB_URL="https://orbitanswer.test")


def key() -> str:
    return str(uuid.uuid4())


def body(client: TestClient, token: str, **over: Any) -> dict[str, Any]:
    current = client.get(f"/v1/public/business/applications/{token}").json()
    return {
        "application_reference": current["reference"],
        "notice_version": current["withdrawal_notice_version"],
        "acknowledge": True,
        "request_id": key(),
        **over,
    }


def book(client: TestClient, owner: dict[str, str], cid: str, aid: str, token: str) -> tuple[str, str]:
    future = (datetime.now(UTC) + timedelta(days=3)).replace(microsecond=0)
    slots = [(future + timedelta(hours=n)).isoformat() for n in range(3)]
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    r = client.post(
        path + "/interview",
        headers=auth(owner),
        json={"slots": slots, "duration_min": 30, "location": "Interview room"},
    )
    assert r.status_code == 201, r.text
    r = client.post(f"/v1/public/business/applications/{token}/book", json={"slot": slots[0].replace("+00:00", "Z")})
    assert r.status_code == 200, r.text

    async def current(db: Any) -> tuple[str, str]:
        iv = await db.scalar(
            select(BizInterview).where(BizInterview.application_id == aid).order_by(BizInterview.created_at.desc())
        )
        return iv.id, str(iv.revision)

    return db_call(client, current)


def test_withdrawal_cancels_bookings_keeps_history_and_prevents_new_hiring_actions(client: TestClient) -> None:
    owner, cid, job, aid, token = setup(client)
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    public = f"/v1/public/business/applications/{token}"
    save_plan(client, owner, cid, job["id"], sample=True)
    client.post(path + "/work-sample", headers=auth(owner)).raise_for_status()
    client.post(
        public + "/clarification", json={"message": "Could you clarify the interview format?", "request_id": key()}
    ).raise_for_status()
    question_id = client.get(public + "/conversation").json()["threads"][0]["id"]
    iv_id, revision = book(client, owner, cid, aid, token)
    request = body(client, token, reason="timing", note="My timing changed. Thank you for considering my application.")
    result = client.post(public + "/withdraw", json=request)
    assert result.status_code == 200, result.text
    assert result.json()["application_state"] == "withdrawn" and result.json()["stage_label"] == "Withdrawn"
    assert not result.json()["can_withdraw"] and result.json()["interview"] is None

    async def record(db: Any) -> tuple[BizApplication, list[BizEvent], list[BizInterview]]:
        return (
            await db.get(BizApplication, aid),
            list(await db.scalars(select(BizEvent).where(BizEvent.application_id == aid))),
            list(
                await db.scalars(
                    select(BizInterview).where(BizInterview.application_id == aid).order_by(BizInterview.created_at)
                )
            ),
        )

    app, events, interviews = db_call(client, record)
    assert app.status == "withdrawn" and app.rejected_at is None and app.deletion_requested_at is None
    assert app.resume_text and len(interviews) == 2 and interviews[-1].slots == []
    assert sum(e.kind == "withdrawn" for e in events) == sum(e.kind == "interview_cancelled" for e in events) == 1
    mail = [m for m in outbox().sent if m.subject.startswith("Application withdrawn:") and m.to == app.email]
    assert len(mail) == 1 and mail[0].attachments
    cal = mail[0].attachments[0][2].decode()
    assert (
        f"UID:{iv_id}@orbitanswer.com" in cal and f"SEQUENCE:{int(revision) + 1}" in cal and "STATUS:CANCELLED" in cal
    )
    assert client.post(public + "/withdraw", json=request).json() == result.json()
    assert len([m for m in outbox().sent if m.subject.startswith("Application withdrawn:") and m.to == app.email]) == 1
    assert client.get(public + "/calendar.ics").status_code == 404
    assert not client.get(public + "/work-sample").json()["accepting"]
    assert (
        client.post(
            public + "/clarification",
            json={"message": "May I ask another question after withdrawing?", "request_id": key()},
        ).status_code
        == 409
    )
    for action, data in (("move", {"ids": [aid], "stage_id": "hired"}), ("reject", {"ids": [aid]})):
        assert (
            client.post(
                f"/v1/business/companies/{cid}/applications/{action}", headers=auth(owner), json=data
            ).status_code
            == 409
        )
    for action, data in (("unreject", {}), ("rerank", {}), ("email", {"kind": "stage"})):
        assert client.post(path + "/" + action, headers=auth(owner), json=data).status_code == 409
    assert client.get(path + "/withdrawal", headers=auth(owner)).json()["withdrawal"]["note"] == request["note"]
    assert not client.get(path + "/conversation", headers=auth(owner)).json()["accepting"]
    assert (
        client.post(
            path + f"/questions/{question_id}/reply",
            headers=auth(owner),
            json={
                "message": "This is a late reply after the application was withdrawn.",
                "request_id": key(),
                "notify": True,
            },
        ).status_code
        == 409
    )
    counts = client.get(f"/v1/business/companies/{cid}/jobs/{job['id']}", headers=auth(owner)).json()["counts"]
    assert counts["applicants"] == 1 and counts["new"] == 0 and sum(counts["by_stage"].values()) == 0
    assert client.get(f"/v1/business/companies/{cid}/analytics", headers=auth(owner)).json()["withdrawn"] == 1
    assert any(
        e["label"] == "You withdrew your application" for e in client.get(public + "/conversation").json()["activity"]
    )


@pytest.mark.parametrize("state", ["unconfirmed", "hired", "rejected"])
def test_only_confirmed_active_applications_can_be_withdrawn(client: TestClient, state: str) -> None:
    _owner, _cid, _job, aid, token = setup(client)
    request = body(client, token)

    async def stop(db: Any) -> None:
        app = await db.get(BizApplication, aid)
        if state == "unconfirmed":
            app.email_confirmed_at = None
        else:
            app.status = state

    db_call(client, stop)
    r = client.post(f"/v1/public/business/applications/{token}/withdraw", json=request)
    assert r.status_code == 409, r.text


def test_withdrawal_can_stop_consideration_during_suspension_and_pending_deletion(client: TestClient) -> None:
    _owner, cid, _job, aid, token = setup(client)
    request = body(client, token)
    public = f"/v1/public/business/applications/{token}"
    assert client.post(public + "/withdraw", json={**request, "acknowledge": False}).status_code == 422
    assert client.post(public + "/withdraw", json={**request, "notice_version": "old"}).status_code == 422
    assert client.post(public + "/withdraw", json={**request, "application_reference": "wrong"}).status_code == 422

    async def pause(db: Any) -> None:
        (await db.get(BizCompany, cid)).status = "suspended"
        (await db.get(BizApplication, aid)).deletion_requested_at = datetime.now(UTC)

    db_call(client, pause)
    saved = client.post(public + "/withdraw", json=request)
    assert saved.status_code == 200 and saved.json()["deletion_requested"], saved.text
    assert (
        client.post(
            public + "/withdraw", json={**request, "note": "Changed content cannot overwrite history."}
        ).status_code
        == 409
    )


def test_withdrawal_retry_race_is_one_event_and_notifications_are_tenant_scoped(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    outsider, _, _ = new_company(client)
    peer = register(client, f"peer-{key()}@example.com")

    async def assign(db: Any) -> None:
        db.add(BizMember(company_id=cid, user_id=uid(peer), role="interviewer"))
        (await db.get(BizApplication, aid)).interviewers = [uid(peer)]
        (await db.get(BizCompany, cid)).blind_review = True

    db_call(client, assign)
    path = f"/v1/business/companies/{cid}/applications/{aid}/withdrawal"
    public = f"/v1/public/business/applications/{token}/withdraw"
    request = body(client, token)
    barrier = Barrier(2)

    def send(_: int) -> int:
        barrier.wait()
        return client.post(public, json=request).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert list(pool.map(send, (0, 1))) == [200, 200]

    async def counts(db: Any) -> tuple[list[BizEvent], list[BizNotification]]:
        return list(
            await db.scalars(select(BizEvent).where(BizEvent.application_id == aid, BizEvent.kind == "withdrawn"))
        ), list(await db.scalars(select(BizNotification).where(BizNotification.application_id == aid)))

    events, notifications = db_call(client, counts)
    assert len(events) == 1 and {n.user_id for n in notifications} == {uid(owner), uid(peer)}
    assert client.get(path, headers=auth(outsider)).status_code == 404
    assert client.get(path, headers=auth(peer)).status_code == 403
    assert client.get(path, headers=auth(owner)).json()["withdrawal"]["reason"] == "No reason shared"


def test_hiring_and_withdrawal_race_has_one_terminal_outcome(client: TestClient) -> None:
    owner, cid, _job, aid, token = setup(client)
    request = body(client, token)
    barrier = Barrier(2)

    def send(action: str) -> int:
        barrier.wait()
        if action == "withdraw":
            return client.post(f"/v1/public/business/applications/{token}/withdraw", json=request).status_code
        return client.post(
            f"/v1/business/companies/{cid}/applications/move",
            headers=auth(owner),
            json={"ids": [aid], "stage_id": "hired"},
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(send, ("withdraw", "hire"))) == [200, 409]
    assert client.get(f"/v1/public/business/applications/{token}").json()["application_state"] in ("withdrawn", "hired")


def test_automatic_submission_links_to_owned_status_and_syncs_withdrawal_without_refunding_submission(
    client: TestClient,
) -> None:
    from orbit_api.auto_apply import planner
    from tests.autoapply_helpers import account, user_id, verify_email

    owner, company, _ = new_company(client)
    new_job(
        client,
        owner,
        company["id"],
        questions=[],
        workplace="remote",
        allowed_countries=["IN"],
        title=f"Backend Engineer {company['id'][:8]}",
        must_haves=["Python", "PostgreSQL", "AWS"],
    )
    candidate, _ = account(client, filters={"keywords": [company["id"][:8]], "days": 30})
    candidate_id = user_id(client, candidate)
    verify_email(client, candidate_id)

    async def prepare(db: Any) -> tuple[str, str]:
        await planner.plan_for_user(db, await db.get(User, candidate_id), use_ai=False)
        packet = await db.scalar(select(ApplicationPacket).where(ApplicationPacket.user_id == candidate_id))
        app = await db.scalar(select(BizApplication).where(BizApplication.user_id == candidate_id))
        tracker = await db.get(JobApplication, app.tracker_id)
        tracker.next_at = datetime.now(UTC) + timedelta(days=1)
        return packet.id, app.id

    pid, aid = db_call(client, prepare)
    packet_path = f"/v1/apply/packets/{pid}"
    private = client.get(packet_path, headers=candidate).json()["employer_status_path"]
    assert private.startswith("/application/")
    token = private.rsplit("/", 1)[-1]
    outsider = register(client, f"other-{key()}@example.com")
    assert client.get(packet_path, headers=auth(outsider)).status_code == 404

    async def change_owner(db: Any) -> None:
        (await db.get(BizApplication, aid)).user_id = uid(outsider)

    db_call(client, change_owner)
    assert client.get(packet_path, headers=candidate).json()["employer_status_path"] is None

    async def restore_owner(db: Any) -> None:
        (await db.get(BizApplication, aid)).user_id = candidate_id

    db_call(client, restore_owner)
    result = client.post(f"/v1/public/business/applications/{token}/withdraw", json=body(client, token))
    assert result.status_code == 200, result.text
    tracker = client.get("/v1/jobs/tracker", headers=candidate).json()
    assert len(tracker) == 1 and tracker[0]["status"] == "withdrawn" and tracker[0]["next_at"] is None
    assert client.get(packet_path, headers=candidate).json()["status"] == "submitted"
    setup = client.get("/v1/apply/setup", headers=candidate).json()
    assert setup["quota"]["used"] == 1 and not setup["paused"]
    deleted = client.delete(f"/v1/business/companies/{company['id']}/applications/{aid}", headers=auth(owner))
    assert deleted.status_code == 204
    assert client.get(packet_path, headers=candidate).json()["employer_status_path"] is None


def test_withdrawn_applications_stop_queued_ranking_and_expire_under_retention(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from orbit_api.business import ranking, retention

    owner, cid, _job, aid, token = setup(client)
    client.post(f"/v1/public/business/applications/{token}/withdraw", json=body(client, token)).raise_for_status()

    class NoAI:
        async def parse_applicant_resume(self, text: str) -> None:
            raise AssertionError("Withdrawn applicants must not be parsed again")

    monkeypatch.setattr(ranking, "get_business_ai", lambda: NoAI())

    async def rank(db: Any) -> None:
        await ranking.rank_application(aid)
        app = await db.get(BizApplication, aid)
        app.retention_months = 1
        app.stage_changed_at = datetime.now(UTC) - timedelta(days=31)

    db_call(client, rank)

    async def sweep(db: Any) -> None:
        await retention.sweep()

    db_call(client, sweep)
    assert client.get(f"/v1/business/companies/{cid}/applications/{aid}", headers=auth(owner)).status_code == 404


def test_withdrawal_stops_saba_offer_and_joining_writes_without_overwriting_their_records(client: TestClient) -> None:
    from tests.test_business_handoff import plan

    owner, cid, job, aid, token = setup(client)
    save_plan(client, owner, cid, job["id"])
    path = f"/v1/business/companies/{cid}/applications/{aid}"
    public = f"/v1/public/business/applications/{token}"
    invited = client.post(path + "/saba/invite", headers=auth(owner), json={"request_id": key()})
    assert invited.status_code == 200, invited.text
    notice_version = invited.json()["notice_version"]
    offer = client.post(
        path + "/offer",
        headers=auth(owner),
        json={
            "role": "Engineer",
            "compensation": "INR 2,400,000 per year",
            "start_date": "To be agreed",
            "terms": "The team will arrange a formal agreement and joining details separately.",
            "base_offer_id": None,
            "request_id": key(),
        },
    ).json()["offer"]
    response = {"offer_id": offer["id"], "response": "accepted", "acknowledge": True, "request_id": key()}
    client.post(public + "/offer/respond", json=response).raise_for_status()
    shared = client.post(path + "/handoff", headers=auth(owner), json=plan()).json()["plan"]
    client.post(public + "/withdraw", json=body(client, token)).raise_for_status()
    assert (
        client.post(
            public + "/saba/start", json={"consent": True, "notice_version": notice_version, "request_id": key()}
        ).status_code
        == 409
    )
    assert client.post(public + "/offer/respond", json={**response, "request_id": key()}).status_code == 409
    assert (
        client.post(
            f"{public}/handoff/tasks/{shared['tasks'][1]['id']}/progress",
            json={"status": "done", "base_revision": 0, "request_id": key()},
        ).status_code
        == 409
    )
    assert client.get(public + "/offer").json()["offer"]["status"] == "accepted"
    assert not client.get(public + "/handoff").json()["accepting"]
    assert client.get(public + "/saba").json()["invited"]


def test_ranking_already_in_flight_does_not_publish_after_withdrawal(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import asyncio

    from orbit_api.business import ranking

    owner, cid, _job, aid, token = setup(client)
    # Confirming the email queues a ranking of its own; let it finish first, so the only ranking in flight is ours.
    wait_ranked(client, owner, cid, aid)
    original = ranking.get_business_ai()
    started, release = Event(), Event()

    class DelayedAI:
        async def parse_applicant_resume(self, text: str) -> Any:
            started.set()
            assert await asyncio.to_thread(release.wait, 10), "Test did not release its recorded provider"
            return await original.parse_applicant_resume(text)

        async def rank_applicant(self, *args: Any) -> Any:
            return await original.rank_applicant(*args)

    monkeypatch.setattr(ranking, "get_business_ai", lambda: DelayedAI())

    async def run(db: Any) -> None:
        await ranking.rank_application(aid)

    async def rank_events(db: Any) -> list[str]:
        return list(
            await db.scalars(select(BizEvent.id).where(BizEvent.application_id == aid, BizEvent.kind == "ranked"))
        )

    before = db_call(client, rank_events)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(db_call, client, run)
        try:
            assert started.wait(5), "Ranking never reached its recorded provider"
            client.post(
                f"/v1/public/business/applications/{token}/withdraw", json=body(client, token)
            ).raise_for_status()
        finally:
            release.set()
        pending.result(timeout=10)
    assert db_call(client, rank_events) == before
    assert (
        client.get(f"/v1/business/companies/{cid}/applications/{aid}", headers=auth(owner)).json()["status"]
        == "withdrawn"
    )
