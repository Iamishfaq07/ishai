from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import CareerWorkspaceState, GmailAttempt
from tests.business_helpers import db_call
from tests.test_career_workflows import tracked
from tests.test_career_workspace import account


def test_today_connects_gmail_and_transition_actions_and_preserves_outcomes(client: TestClient) -> None:
    h, other = account(client), account(client)
    entry = tracked(client, h)
    user_id = client.get("/v1/auth/me", headers=h).json()["id"]
    for stage in ("interviewing", "offer", "rejected"):
        assert client.patch(f"/v1/jobs/tracker/{entry}", headers=h, json={"status": stage}).status_code == 200
    overdue = (datetime.now(UTC) - timedelta(days=2)).date().isoformat()
    async def seed(db: AsyncSession) -> None:
        db.add(GmailAttempt(user_id=user_id, application_id=entry, status="uncertain", data={"private": "Secret body"}))
        db.add(CareerWorkspaceState(user_id=user_id, kind="transition", revision=1, data={"targetRole": "Analyst",
            "requirements": [{"id": "sql", "requirement": "SQL", "state": "practising", "due": overdue,
                              "nextAction": "Run cohort query"},
                             {"id": "done", "requirement": "Charts", "state": "demonstrated", "due": overdue,
                              "nextAction": "Already completed"}]}))
    db_call(client, seed)
    queue = client.get("/v1/jobs/actions", headers=h)
    assert queue.status_code == 200, queue.text
    items = queue.json()["items"]
    gmail = next(i for i in items if i.get("source_channel") == "gmail")
    assert "Do not resend" in gmail["detail"]
    assert "#gmail-apply" in gmail["path"]
    transition = next(i for i in items if i.get("source_channel") == "transition")
    assert transition["overdue"] and transition["due_at"] is None
    assert "Secret body" not in queue.text and "Already completed" not in queue.text
    assert not any(i.get("source_channel") in {"gmail", "transition"} for i in
                   client.get("/v1/jobs/actions", headers=other).json()["items"])
    overview = client.get("/v1/career/overview", headers=h).json()
    assert overview["ever_interviewed"] == overview["ever_offered"] == 1
    assert overview["gmail_needs_review"] == 1
    assert client.get("/v1/career/overview", headers=other).json()["gmail_needs_review"] == 0
