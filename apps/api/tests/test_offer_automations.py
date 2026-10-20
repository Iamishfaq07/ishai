"""Offer tasks follow real lifecycle events and never send reminders or make decisions."""
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.business import automation
from orbit_api.models import BizEvent
from tests.business_helpers import auth, db_call
from tests.test_business_automations import client as client
from tests.test_business_automations import config, paths, queue, run
from tests.test_business_handoff import plan
from tests.test_business_hiring_studio import setup


def offer(client: TestClient, owner: Any, cid: str, aid: str, days: int = 1, base: str | None = None) -> Any:
    response = client.post(f"/v1/business/companies/{cid}/applications/{aid}/offer", headers=auth(owner), json={
        "role": "Backend Engineer", "compensation": "INR 2,400,000 per year", "start_date": "To be agreed",
        "terms": "Full-time role. Formal agreement and joining arrangements will be reviewed together.",
        "expires_days": days, "request_id": str(uuid.uuid4()), "base_offer_id": base})
    assert response.status_code == 200, response.text
    return response.json()["offer"]


def enabled(client: TestClient, owner: Any, cid: str, jid: str, **kw: Any) -> Any:
    return config(client, owner, cid, jid, stalled_days=None, question_hours=None, feedback_hours=None,
        assessment_hours=None, scheduling_hours=None, prep_hours=None, **kw)


def test_offer_preview_opt_in_and_versioned_replacement(client: TestClient) -> None:
    owner, cid, job, aid, _ = setup(client)
    first = offer(client, owner, cid, aid)
    assert run(client, owner, cid, job["id"])["changes"]["created"] == 0
    preview = client.get(paths(cid, job["id"])[1] + "/preview", headers=auth(owner),
        params={"stalled_days": 0, "question_hours": 0, "feedback_hours": 0, "assessment_hours": 0, "offer_hours": 24})
    assert preview.status_code == 200, preview.text
    assert preview.json()["counts"]["offer"] == 1
    assert queue(client, owner, cid)["items"] == []
    assert enabled(client, owner, cid, job["id"], offer_hours=24)["changes"]["created"] == 1
    assert run(client, owner, cid, job["id"])["changes"]["created"] == 0
    offer(client, owner, cid, aid, days=5, base=first["id"])
    result = run(client, owner, cid, job["id"])
    assert result["changes"]["resolved"] == 1 and result["changes"]["created"] == 0
    assert queue(client, owner, cid)["items"][0]["status"] == "resolved"
    future = datetime.now(UTC) + timedelta(days=5)
    client.portal.call(automation.sweep, future)  # type: ignore[union-attr]
    pending = queue(client, owner, cid, status="open")["items"]
    assert len(pending) == 1 and pending[0]["kind"] == "offer"
    client.portal.call(automation.sweep, future + timedelta(minutes=5))  # type: ignore[union-attr]
    assert len(queue(client, owner, cid, status="open")["items"]) == 1


def test_expired_offer_stays_an_internal_review_task_until_withdrawn(client: TestClient) -> None:
    owner, cid, job, aid, _ = setup(client)
    published = offer(client, owner, cid, aid)
    async def expire(db: Any) -> None:
        row = await db.get(BizEvent, published["id"])
        row.data = {**row.data, "expires_at": (datetime.now(UTC) - timedelta(hours=2)).isoformat()}
    db_call(client, expire)
    enabled(client, owner, cid, job["id"], offer_hours=24)
    tasks = queue(client, owner, cid)["items"]
    assert [t["kind"] for t in tasks] == ["offer"]
    state = client.get(f"/v1/business/companies/{cid}/applications/{aid}/offer", headers=auth(owner)).json()
    assert state["offer"]["status"] == "expired"
    withdraw = client.post(f"/v1/business/companies/{cid}/applications/{aid}/offer/withdraw", headers=auth(owner),
        json={"offer_id": published["id"], "request_id": str(uuid.uuid4())})
    assert withdraw.status_code == 200, withdraw.text
    assert run(client, owner, cid, job["id"])["changes"]["resolved"] == 1


def test_accepted_offer_creates_handoff_task_then_source_plan_resolves_it(client: TestClient) -> None:
    owner, cid, job, aid, token = setup(client)
    published = offer(client, owner, cid, aid)
    enabled(client, owner, cid, job["id"], offer_hours=24, handoff_hours=1)
    response = client.post(f"/v1/public/business/applications/{token}/offer/respond", json={
        "offer_id": published["id"], "response": "accepted", "acknowledge": True, "request_id": str(uuid.uuid4())})
    assert response.status_code == 200, response.text
    async def age(db: Any) -> None:
        row = await db.scalar(select(BizEvent).where(BizEvent.application_id == aid, BizEvent.kind == "offer_response"))
        row.created_at = datetime.now(UTC) - timedelta(hours=2)
    db_call(client, age)
    result = run(client, owner, cid, job["id"])
    assert result["changes"]["created"] == 1 and result["changes"]["resolved"] == 1
    task = next(t for t in queue(client, owner, cid)["items"] if t["status"] == "open")
    assert task["kind"] == "handoff"
    result = client.post(f"/v1/business/companies/{cid}/applications/{aid}/handoff", headers=auth(owner), json=plan())
    assert result.status_code == 200, result.text
    assert run(client, owner, cid, job["id"])["changes"]["resolved"] == 1


def test_declines_and_malformed_legacy_expiry_never_create_offer_tasks(client: TestClient) -> None:
    owner, cid, job, aid, token = setup(client)
    published = offer(client, owner, cid, aid)
    response = client.post(f"/v1/public/business/applications/{token}/offer/respond", json={
        "offer_id": published["id"], "response": "declined", "acknowledge": True, "request_id": str(uuid.uuid4())})
    assert response.status_code == 200, response.text
    enabled(client, owner, cid, job["id"], offer_hours=24, handoff_hours=1)
    assert queue(client, owner, cid)["items"] == []
    event = BizEvent(id="legacy", company_id=cid, application_id=aid, kind="offer_published",
        data={"expires_at": "unknown", "revision": 1}, created_at=datetime.now(UTC))
    assert automation.offer_signals([event], automation.Recipe(offer_hours=24)) == []
