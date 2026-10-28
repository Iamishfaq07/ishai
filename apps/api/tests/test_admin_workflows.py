"""Global workflow operations require administrator access, an explicit reason and the current failed version."""
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from orbit_api.config import get_settings
from orbit_api.models import AuditLog, Job
from tests.business_helpers import auth, db_call, register
from tests.test_job_leases import quiet_client  # noqa: F401


def test_workflow_health_and_retry_are_scoped_audited_and_payload_free(quiet_client, monkeypatch):  # noqa: F811
    client = quiet_client
    monkeypatch.setattr(get_settings(), "admin_email", "workflow-admin@example.com")
    admin = auth(register(client, "workflow-admin@example.com"))
    other = auth(register(client, "workflow-other@example.com"))
    identities = {}

    async def seed(db):
        now = datetime.now(UTC)
        report = Job(kind="report", payload={"private": "candidate-secret"}, status="failed", attempts=3,
                     last_error="RuntimeError: private-provider-token")
        tailor = Job(kind="tailor", payload={"private": "resume-secret"}, status="failed", attempts=3)
        running = Job(kind="report", payload={}, status="running", attempts=1, lease_token="active",
                      lease_until=now + timedelta(minutes=5))
        expired = Job(kind="report", payload={}, status="running", attempts=1, lease_token="expired",
                      lease_until=now - timedelta(seconds=1))
        db.add_all([report, tailor, running, expired])
        await db.flush()
        identities.update(report=report.id, tailor=tailor.id, running=running.id)
    db_call(client, seed)
    assert client.get("/v1/admin/workflows", headers=other).status_code == 403
    result = client.get("/v1/admin/workflows", headers=admin)
    assert result.status_code == 200, result.text
    assert "secret" not in result.text and "private-provider-token" not in result.text
    health = result.json()
    assert health["expired_leases"] == 1 and health["counts"]["failed"] >= 2
    report = next(row for row in health["failed"] if row["id"] == identities["report"])
    assert report["can_retry"] and report["error_type"] == "RuntimeError"
    assert not next(row for row in health["failed"] if row["id"] == identities["tailor"])["can_retry"]
    body = {"updated_at": report["updated_at"], "reason": "Provider connection restored"}
    url = f"/v1/admin/workflows/{report['id']}/retry"
    assert client.post(url, headers=other, json=body).status_code == 403
    assert client.post(url, headers=admin, json={**body, "reason": "short"}).status_code == 422
    assert client.post(url, headers=admin, json={**body,
        "updated_at": (datetime.now(UTC) - timedelta(days=1)).isoformat()}).status_code == 409
    assert client.post(url, headers=admin, json=body).status_code == 200
    assert client.post(url, headers=admin, json=body).status_code == 409
    assert client.post(f"/v1/admin/workflows/{identities['tailor']}/retry", headers=admin, json=body).status_code == 409

    async def check(db):
        row = await db.get(Job, report["id"])
        assert (row.status, row.attempts, row.payload) == ("queued", 0, {"private": "candidate-secret"})
        events = list(await db.scalars(select(AuditLog).where(AuditLog.action == "admin.workflow_retry")))
        assert len(events) == 1 and "Provider connection restored" in events[0].target
        assert "candidate-secret" not in json.dumps([event.target for event in events])
    db_call(client, check)


def test_failure_listing_is_bounded_and_hides_raw_errors(quiet_client, monkeypatch):  # noqa: F811
    client = quiet_client
    monkeypatch.setattr(get_settings(), "admin_email", "bounded-admin@example.com")
    admin = auth(register(client, "bounded-admin@example.com"))

    async def seed(db):
        for _ in range(27):
            db.add(Job(kind="unknown", payload={"secret": "do-not-export"}, status="failed", attempts=3,
                       last_error="https://private-token.example/path"))
    db_call(client, seed)
    response = client.get("/v1/admin/workflows", headers=admin)
    assert response.status_code == 200
    assert response.json()["truncated"] and len(response.json()["failed"]) == 25
    assert "private-token" not in response.text and "do-not-export" not in response.text
