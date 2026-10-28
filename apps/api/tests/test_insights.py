"""Candidate insights (orbit_api/insights.py): the source saved once in an account's first week, the activity log
(paths with ids hidden, never anything typed), the journey with where the account is stuck, and everyone's sources,
funnel, pages and errors for the admin only."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from orbit_api.insights import clean_host, clean_path, source_label
from orbit_api.models import ActivityEvent, User
from tests.test_signup_approval import _client
from tests.test_signup_approval import _register as _register_named


@pytest.fixture
def console(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, dict[str, str]]]:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    admin, _ = _register_named(client, admin_email)
    yield client, admin
    gen.close()


def _user(client: TestClient) -> tuple[dict[str, str], dict[str, Any]]:
    return _register_named(client, f"i-{uuid.uuid4().hex[:8]}@example.com")


def _db(client: TestClient, fn: Any) -> Any:
    from orbit_api.db import sessionmaker

    async def go() -> Any:
        async with sessionmaker()() as db:
            out = await fn(db)
            await db.commit()
            return out

    return client.portal.call(go)  # type: ignore[union-attr]


def test_paths_hosts_and_sources_are_cleaned() -> None:
    assert clean_path("/jobs/mission/0b7e3a52-1c3d-4e5f-8a9b-0c1d2e3f4a5b?tab=plan#x") == "/jobs/mission/:id"
    assert clean_path("/resumes/123/edit") == "/resumes/:id/edit"
    assert clean_path("https://evil.example/x") == "/x" and clean_path("nope") == ""
    assert clean_host("https://www.Google.co.in/search?q=secret") == "google.co.in"
    assert source_label({"referrer": "google.co.in"}) == "google"
    assert source_label({"referrer": "lnkd.in"}) == "linkedin"
    assert source_label({"utm_source": "YouTube", "referrer": "google.com"}) == "youtube"
    assert source_label({"ref": "PRIYA10"}) == "referral"
    assert source_label({"referrer": "blog.example.com"}) == "blog.example.com"
    assert (source_label({}), source_label(None)) == ("unknown", "unknown")


def test_the_source_is_saved_once_and_events_are_logged(console: Any) -> None:
    client, admin = console
    h, user = _user(client)
    body = {"source": {"referrer": "https://www.linkedin.com/feed/?trk=abc", "landing": "/?utm_source=x",
                       "utm_source": "linkedin", "utm_campaign": "launch week"},
            "events": [{"kind": "page", "name": "Today", "path": "/", "device": "phone"},
                       {"kind": "page", "name": "Job", "path": "/jobs/mission/0123456789abcdef0123", "device": "phone"},
                       {"kind": "action", "name": "Save job", "path": "/jobs/matches"},
                       {"kind": "error", "name": "Upload failed", "path": "/resumes", "detail": "File too large"},
                       {"kind": "page", "name": "<>", "path": "/"}]}
    assert client.post("/v1/activity", headers=h, json=body).status_code == 204
    # A second source never replaces the first.
    client.post("/v1/activity", headers=h, json={"source": {"utm_source": "google"}})
    j = client.get(f"/v1/admin/users/{user['id']}/journey", headers=admin).json()
    assert j["source"] == {"utm_source": "linkedin", "utm_campaign": "launch week", "referrer": "linkedin.com",
                           "landing": "/"}
    assert j["source_label"] == "linkedin"
    assert [(e["kind"], e["name"], e["path"]) for e in j["timeline"]][::-1] == [
        ("page", "Today", "/"), ("page", "Job", "/jobs/mission/:id"), ("action", "Save job", "/jobs/matches"),
        ("error", "Upload failed", "/resumes")]
    assert j["errors_30"] == 1 and j["active_days_30"] == 1 and j["last_seen"]
    assert {d["name"]: d["count"] for d in j["devices"]} == {"phone": 2}
    assert [s["key"] for s in j["steps"] if s["done_at"]] == ["signed_up"]
    assert j["stuck_at"] == "Verified email"


def test_a_source_after_the_first_week_is_ignored(console: Any) -> None:
    client, admin = console
    h, user = _user(client)
    _db(client, lambda db: db.execute(update(User).where(User.id == user["id"]).values(
        created_at=datetime.now(UTC) - timedelta(days=8))))
    client.post("/v1/activity", headers=h, json={"source": {"utm_source": "late"}})
    assert client.get(f"/v1/admin/users/{user['id']}/journey", headers=admin).json()["source"] is None


def test_the_journey_follows_what_the_account_has(console: Any) -> None:
    client, admin = console
    h, user = _user(client)
    r = client.post("/v1/jobs/tracker/manual", headers=h, json={"company": "Acme", "title": "SDE", "status": "saved"})
    assert r.status_code == 201, r.text
    steps = {s["key"]: s["done_at"] for s in client.get(f"/v1/admin/users/{user['id']}/journey",
                                                       headers=admin).json()["steps"]}
    assert steps["job_saved"] and not steps["applied"]
    client.patch(f"/v1/jobs/tracker/{r.json()['id']}", headers=h, json={"status": "interviewing"})
    j = client.get(f"/v1/admin/users/{user['id']}/journey", headers=admin).json()
    done = {s["key"] for s in j["steps"] if s["done_at"]}
    assert {"signed_up", "job_saved", "applied", "interview"} <= done
    assert j["stuck_at"] == "Verified email"


def test_everyones_insights_and_only_the_admin_sees_them(console: Any) -> None:
    client, admin = console
    h1, _ = _user(client)
    h2, u2 = _user(client)
    client.post("/v1/activity", headers=h1, json={"source": {"utm_source": "campus-fair"},
                                                   "events": [{"kind": "error", "name": "Payment failed",
                                                               "path": "/billing"}]})
    client.post("/v1/activity", headers=h2, json={"source": {"utm_source": "campus-fair"},
                                                   "events": [{"kind": "page", "name": "Billing", "path": "/billing",
                                                               "device": "desktop"},
                                                              {"kind": "error", "name": "Payment failed",
                                                               "path": "/billing"}]})
    out = client.get("/v1/admin/insights?days=7", headers=admin).json()
    fair = next(s for s in out["sources"] if s["source"] == "campus-fair")
    assert fair["signups"] == 2 and fair["paid"] == 0
    funnel = {f["key"]: f for f in out["funnel"]}
    assert funnel["signed_up"]["count"] >= 3 and funnel["verified"]["stuck"] >= 2
    err = next(e for e in out["errors"] if e["name"] == "Payment failed")
    assert (err["path"], err["count"], err["people"]) == ("/billing", 2, 2)
    assert out["active_1"] >= 2 and any(p["name"] == "/billing" for p in out["top_pages"])
    for path in ("/v1/admin/insights", f"/v1/admin/users/{u2['id']}/journey"):
        assert client.get(path, headers=h1).status_code == 403
    assert client.post("/v1/activity", json={"events": []}).status_code == 401
    assert client.get("/v1/admin/users/missing/journey", headers=admin).status_code == 404


def test_old_activity_is_deleted_and_the_export_has_it(console: Any) -> None:
    client, _ = console
    h, user = _user(client)
    old = datetime.now(UTC) - timedelta(days=200)

    async def add_old(db: Any) -> None:
        db.add(ActivityEvent(user_id=user["id"], kind="page", name="Old", path="/", created_at=old))

    _db(client, add_old)
    client.post("/v1/activity", headers=h, json={"events": [{"kind": "page", "name": "New", "path": "/"}]})
    export = client.get("/v1/auth/me/export", headers=h).json()
    assert [e["name"] for e in export["activity"]] == ["New"]
    assert "notices" in export
