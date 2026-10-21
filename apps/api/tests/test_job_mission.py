"""Job Mission Room: stages from records only, the next step, linking a resume and an offer, freezing the resume
that was sent, and that none of it reaches another account."""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.job_portal.mission import Facts, next_step, stages_for
from orbit_api.models import ApplicationPacket, JobApplication
from tests.business_helpers import db_call
from tests.test_api import _register
from tests.test_offers import OFFER
from tests.test_resumes import strong_resume


def _facts(**over: object) -> Facts:
    base: dict[str, object] = {"status": "saved", "fit": False, "resume": False, "snapshot": False, "applied": False,
                               "practice_rounds": 0, "live_rounds": 0, "offer": False, "upcoming_days": None,
                               "prep_doc": False}
    return Facts.model_validate({**base, **over})


def test_stages_are_records_not_estimates() -> None:
    assert stages_for(_facts()) == {"discover": True, "prove": False, "prepare": False, "apply": False,
                                    "interview": False, "negotiate": False}
    s = stages_for(_facts(status="interviewing", fit=True, practice_rounds=1, applied=True))
    assert s == {"discover": True, "prove": True, "prepare": True, "apply": True, "interview": True,
                 "negotiate": False}
    assert stages_for(_facts(status="offer"))["negotiate"] is True


def test_the_next_step_is_the_first_gap_with_a_reason() -> None:
    path = "/jobs/listing/x"
    assert next_step(_facts(), path).key == "fit"  # type: ignore[union-attr]
    assert next_step(_facts(fit=True), path).key == "resume"  # type: ignore[union-attr]
    assert next_step(_facts(fit=True, resume=True), path).key == "apply"  # type: ignore[union-attr]
    sent = next_step(_facts(fit=True, resume=True, applied=True, status="applied"), path)
    assert sent is not None and sent.key == "snapshot"
    soon = next_step(_facts(fit=True, status="interviewing", upcoming_days=1), path)
    assert soon is not None and soon.key == "practise" and "tomorrow" in soon.why
    assert next_step(_facts(status="offer"), path).to == "link_offer"  # type: ignore[union-attr]
    done = _facts(fit=True, resume=True, applied=True, snapshot=True, status="applied", practice_rounds=1)
    assert next_step(done, path) is None
    assert next_step(_facts(status="hired"), path) is None


def _entry(client: TestClient, h: dict[str, str], company: str = "Hooli") -> str:
    r = client.post("/v1/jobs/tracker/manual", headers=h, json={"company": company, "title": "Backend Engineer"})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def _resume(client: TestClient, h: dict[str, str]) -> str:
    r = client.post("/v1/resumes", headers=h, json={"title": "Backend CV", "data": strong_resume().model_dump()})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def test_a_mission_from_saved_to_sent(client: TestClient) -> None:
    h = _register(client)
    eid = _entry(client, h)
    m = client.get(f"/v1/jobs/tracker/{eid}/mission", headers=h).json()
    assert m["stages"]["discover"] and not m["stages"]["prove"]
    assert m["next"]["key"] == "fit" and m["resume"] is None and m["snapshots"] == []
    # Nothing to freeze until a resume is linked.
    assert client.post(f"/v1/jobs/tracker/{eid}/mission/snapshots", headers=h, json={}).status_code == 409

    rid = _resume(client, h)
    m = client.put(f"/v1/jobs/tracker/{eid}/mission/resume", headers=h, json={"resume_id": rid}).json()
    assert m["resume"]["id"] == rid and m["stages"]["prepare"]
    assert 0 <= m["resume"]["score"] <= 100

    r = client.post(f"/v1/jobs/tracker/{eid}/mission/snapshots", headers=h, json={"note": "Sent via careers page"})
    assert r.status_code == 201, r.text
    snap = r.json()["snapshots"][0]
    assert snap["title"] == "Backend CV" and snap["note"] == "Sent via careers page" and snap["resume_id"] == rid

    # Editing or deleting the resume later doesn't touch what was sent.
    copy = client.post(f"/v1/jobs/tracker/{eid}/mission/snapshots/{snap['id']}/copy", headers=h)
    assert copy.status_code == 201
    copied = client.get(f"/v1/resumes/{copy.json()['resume_id']}", headers=h).json()
    assert copied["title"].startswith("Backend CV (saved ")
    assert client.delete(f"/v1/resumes/{rid}", headers=h).status_code == 204
    m = client.get(f"/v1/jobs/tracker/{eid}/mission", headers=h).json()
    kept = m["snapshots"][0]
    assert m["resume"] is None and kept["resume_id"] is None and kept["score"] == snap["score"]

    gone = client.delete(f"/v1/jobs/tracker/{eid}/mission/snapshots/{snap['id']}", headers=h)
    assert gone.status_code == 200 and gone.json()["snapshots"] == []


def test_an_offer_is_linked_by_the_user_to_one_job(client: TestClient) -> None:
    h = _register(client)
    first, second = _entry(client, h), _entry(client, h, "Initech")
    oid = client.post("/v1/offers", headers=h, json=OFFER).json()["id"]
    m = client.get(f"/v1/jobs/tracker/{first}/mission", headers=h).json()
    assert m["offer"] is None and [o["id"] for o in m["offers"]] == [oid]  # offered to pick, never auto-linked
    m = client.put(f"/v1/jobs/tracker/{first}/mission/offer", headers=h, json={"offer_id": oid}).json()
    assert m["offer"]["id"] == oid and m["stages"]["negotiate"]
    # Linked elsewhere: not offered to the second job, and linking it there moves it.
    assert client.get(f"/v1/jobs/tracker/{second}/mission", headers=h).json()["offers"] == []
    client.put(f"/v1/jobs/tracker/{second}/mission/offer", headers=h, json={"offer_id": oid})
    assert client.get(f"/v1/jobs/tracker/{first}/mission", headers=h).json()["offer"] is None
    m = client.put(f"/v1/jobs/tracker/{second}/mission/offer", headers=h, json={"offer_id": None}).json()
    assert m["offer"] is None


def test_nothing_crosses_accounts(client: TestClient) -> None:
    a, b = _register(client), _register(client)
    eid = _entry(client, a)
    rid = _resume(client, a)
    client.put(f"/v1/jobs/tracker/{eid}/mission/resume", headers=a, json={"resume_id": rid})
    sid = client.post(f"/v1/jobs/tracker/{eid}/mission/snapshots", headers=a, json={}).json()["snapshots"][0]["id"]
    oid = client.post("/v1/offers", headers=a, json=OFFER).json()["id"]
    base = f"/v1/jobs/tracker/{eid}/mission"
    assert client.get(base, headers=b).status_code == 404
    assert client.put(f"{base}/resume", headers=b, json={"resume_id": None}).status_code == 404
    assert client.post(f"{base}/snapshots", headers=b, json={}).status_code == 404
    assert client.post(f"{base}/snapshots/{sid}/copy", headers=b).status_code == 404
    assert client.delete(f"{base}/snapshots/{sid}", headers=b).status_code == 404
    assert client.put(f"{base}/offer", headers=b, json={"offer_id": None}).status_code == 404
    # B's own job can't take A's resume, snapshot or offer.
    mine = _entry(client, b)
    assert client.put(f"/v1/jobs/tracker/{mine}/mission/resume", headers=b, json={"resume_id": rid}).status_code == 404
    assert client.put(f"/v1/jobs/tracker/{mine}/mission/offer", headers=b, json={"offer_id": oid}).status_code == 404
    assert client.post(f"/v1/jobs/tracker/{mine}/mission/snapshots/{sid}/copy", headers=b).status_code == 404
    # And B's offer list never shows A's offers.
    assert client.get(f"/v1/jobs/tracker/{mine}/mission", headers=b).json()["offers"] == []


def test_export_has_the_sent_versions_and_deleting_the_job_removes_them(client: TestClient) -> None:
    h = _register(client)
    eid = _entry(client, h)
    rid = _resume(client, h)
    client.put(f"/v1/jobs/tracker/{eid}/mission/resume", headers=h, json={"resume_id": rid})
    client.post(f"/v1/jobs/tracker/{eid}/mission/snapshots", headers=h, json={})
    export = client.get("/v1/auth/me/export", headers=h).json()
    assert len(export["job_search"]["sent_resume_versions"]) == 1
    assert client.delete(f"/v1/jobs/tracker/{eid}", headers=h).status_code == 204
    assert client.get("/v1/auth/me/export", headers=h).json()["job_search"]["sent_resume_versions"] == []


def test_opening_a_sent_version_again_keeps_to_the_resume_limit(client: TestClient) -> None:
    """Every other way of making a resume stops at MAX_RESUMES; copying a snapshot didn't, so a loop could make
    thousands (each listed, scored and loaded by the Jobs AI profile on every request)."""
    from orbit_api.resumes.routes import MAX_RESUMES

    h = _register(client)
    eid = _entry(client, h)
    rid = _resume(client, h)
    client.put(f"/v1/jobs/tracker/{eid}/mission/resume", headers=h, json={"resume_id": rid})
    snap = client.post(f"/v1/jobs/tracker/{eid}/mission/snapshots", headers=h, json={}).json()["snapshots"][0]
    copy = f"/v1/jobs/tracker/{eid}/mission/snapshots/{snap['id']}/copy"
    for _ in range(MAX_RESUMES - 1):
        assert client.post(copy, headers=h).status_code == 201
    full = client.post(copy, headers=h)
    assert full.status_code == 409 and "Delete one first" in full.json()["detail"]
    assert len(client.get("/v1/resumes", headers=h).json()) == MAX_RESUMES


def test_today_and_tomorrow_are_the_persons_own_days(client: TestClient) -> None:
    """An interview on the 21st is saved as noon there (06:30 UTC in India). At 01:30 on the 21st in India it's still
    the 20th in UTC, so the next step said "It's tomorrow" on the interview's own day."""
    from datetime import UTC, datetime

    from orbit_api.db import sessionmaker
    from orbit_api.job_portal.mission import mission
    from orbit_api.models import JobApplication, User

    h = _register(client)
    eid = _entry(client, h)

    async def why(tz_offset: int) -> str:
        async with sessionmaker()() as db:
            entry = await db.get(JobApplication, eid)
            assert entry is not None
            entry.status, entry.next_at = "interviewing", datetime(2026, 10, 21, 6, 30, tzinfo=UTC)
            await db.commit()
            user = await db.get(User, entry.user_id)
            assert user is not None
            out = await mission(db, user, entry, now=datetime(2026, 10, 20, 20, 0, tzinfo=UTC), tz_offset=tz_offset)
            return out.next.why

    assert "It's tomorrow" in client.portal.call(why, 0)  # type: ignore[union-attr]
    assert "It's today" in client.portal.call(why, 330)  # type: ignore[union-attr]
    assert client.get(f"/v1/jobs/tracker/{eid}/mission?tz_offset=330", headers=h).status_code == 200
    assert client.get(f"/v1/jobs/tracker/{eid}/mission?tz_offset=9999", headers=h).status_code == 422


def test_application_kit_is_an_owned_exact_listing_projection(client: TestClient) -> None:
    a, b = _register(client), _register(client)
    eid, other = _entry(client, a), _entry(client, b)

    async def seed(db: AsyncSession) -> str:
        entry = await db.get(JobApplication, eid)
        foreign = await db.get(JobApplication, other)
        assert entry and foreign
        foreign.listing_id = entry.listing_id
        for user_id in (entry.user_id, foreign.user_id):
            db.add(ApplicationPacket(user_id=user_id, listing_id=entry.listing_id,
                status="review", ats="lever", company="Example", company_key="example", title="Engineer",
                url="https://example.test/job", apply_url="https://example.test/apply",
                expires_at=datetime.now(UTC) + timedelta(days=1), resume_data={"private": "never project me"},
                answers=[{"private": "never project answers"}]))
        await db.flush()
        return entry.listing_id
    db_call(client, seed)
    base = f"/v1/jobs/tracker/{eid}/mission"
    response = client.get(base, headers=a)
    assert response.status_code == 200, response.text
    mine = response.json()["application"]
    theirs = client.get(f"/v1/jobs/tracker/{other}/mission", headers=b).json()["application"]
    assert mine["id"] != theirs["id"]
    assert set(mine) == {"id", "status", "submission_uncertain", "updated_at"}
    assert mine["status"] == "review" and mine["submission_uncertain"] is False
    assert response.json()["stages"]["apply"] is False
    assert client.get(base, headers=b).status_code == 404

    async def ambiguous(db: AsyncSession) -> None:
        packet = await db.get(ApplicationPacket, mine["id"])
        assert packet
        packet.status = "failed"
        packet.submission_started_at = datetime.now(UTC)
    db_call(client, ambiguous)
    uncertain = client.get(base, headers=a).json()["application"]
    assert uncertain["status"] == "failed" and uncertain["submission_uncertain"] is True

    async def confirmed(db: AsyncSession) -> None:
        packet = await db.get(ApplicationPacket, mine["id"])
        assert packet
        packet.status = "submitted"
    db_call(client, confirmed)
    assert client.get(base, headers=a).json()["application"]["submission_uncertain"] is False


def test_application_projection_does_not_guess_a_different_job_link(client: TestClient) -> None:
    h = _register(client)
    eid, conflicting = _entry(client, h), _entry(client, h, "Different employer")
    async def seed(db: AsyncSession) -> None:
        entry = await db.get(JobApplication, eid)
        assert entry
        db.add(ApplicationPacket(user_id=entry.user_id, listing_id=entry.listing_id, application_id=conflicting,
            status="review", ats="lever", company="Example", company_key="example", title="Engineer",
            url="https://example.test/job", apply_url="https://example.test/apply",
            expires_at=datetime.now(UTC) + timedelta(days=1)))
    db_call(client, seed)
    assert client.get(f"/v1/jobs/tracker/{eid}/mission", headers=h).json()["application"] is None
