"""The people in a job search: the contacts tracker (orbit_api/job_portal/contacts.py)."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient

from tests.test_api import _register


def _add(client: TestClient, h: dict[str, str], **body: Any) -> Any:
    r = client.post("/v1/jobs/contacts", headers=h, json={"name": "Asha Rao", **body})
    assert r.status_code == 201, r.text
    return r.json()


def _tracked(client: TestClient, h: dict[str, str]) -> str:
    r = client.post("/v1/jobs/tracker/manual", headers=h, json={
        "title": "Android Engineer", "company": "PhonePe", "url": "https://careers.phonepe.com/jobs/android"})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def test_add_edit_and_remove_a_contact(client: TestClient) -> None:
    h = _register(client)
    c = _add(client, h, company="  Razorpay ", title="Senior   Engineer", relation="alum",
             linkedin_url="linkedin.com/in/asha", email="asha@example.com", phone="+91 98765 43210",
             notes="Same college, 2019 batch.")
    assert c["company"] == "Razorpay" and c["title"] == "Senior Engineer"  # tidied to one line
    assert c["linkedin_url"] == "https://linkedin.com/in/asha" and c["relation"] == "alum"
    assert c["follow_up_at"] is None and c["last_contacted_at"] is None and c["application_label"] is None

    r = client.patch(f"/v1/jobs/contacts/{c['id']}", headers=h, json={"title": "Staff Engineer", "phone": None})
    assert r.status_code == 200 and r.json()["title"] == "Staff Engineer" and r.json()["phone"] is None
    assert r.json()["email"] == "asha@example.com"  # untouched
    assert client.patch(f"/v1/jobs/contacts/{c['id']}", headers=h, json={"name": ""}).status_code == 422

    assert [x["id"] for x in client.get("/v1/jobs/contacts", headers=h).json()] == [c["id"]]
    assert client.delete(f"/v1/jobs/contacts/{c['id']}", headers=h).status_code == 204
    assert client.get("/v1/jobs/contacts", headers=h).json() == []


def test_contacts_are_checked_and_private(client: TestClient) -> None:
    h, other = _register(client), _register(client)
    for bad in ({"email": "not-an-email"}, {"linkedin_url": "nope"}, {"phone": "call me"}, {"relation": "boss"},
                {"name": ""}):
        assert client.post("/v1/jobs/contacts", headers=h, json={"name": "A", **bad}).status_code == 422, bad
    c = _add(client, h)
    assert client.get("/v1/jobs/contacts", headers=other).json() == []
    assert client.patch(f"/v1/jobs/contacts/{c['id']}", headers=other, json={"title": "x"}).status_code == 404
    assert client.post(f"/v1/jobs/contacts/{c['id']}/contacted", headers=other).status_code == 404
    assert client.delete(f"/v1/jobs/contacts/{c['id']}", headers=other).status_code == 404
    # Someone else's tracked job can't be linked.
    theirs = _tracked(client, other)
    assert client.post("/v1/jobs/contacts", headers=h, json={"name": "B", "application_id": theirs}).status_code == 404


def test_a_contact_linked_to_a_tracked_job_keeps_existing_when_the_job_goes(client: TestClient) -> None:
    h = _register(client)
    job = _tracked(client, h)
    c = _add(client, h, relation="referral", application_id=job)
    assert c["application_label"] == "Android Engineer at PhonePe"
    assert [x["id"] for x in client.get(f"/v1/jobs/contacts?application_id={job}", headers=h).json()] == [c["id"]]
    assert client.delete(f"/v1/jobs/tracker/{job}", headers=h).status_code == 204
    left = client.get("/v1/jobs/contacts", headers=h).json()
    assert [x["id"] for x in left] == [c["id"]] and left[0]["application_id"] is None


def test_getting_in_touch_sets_the_next_follow_up_and_due_ones_come_first(client: TestClient) -> None:
    h = _register(client)
    now = datetime.now(UTC)
    later = _add(client, h, name="Later", follow_up_at=(now + timedelta(days=3)).isoformat())
    _add(client, h, name="Someday")
    due = _add(client, h, name="Due", follow_up_at=(now - timedelta(days=2)).isoformat())
    assert [x["name"] for x in client.get("/v1/jobs/contacts", headers=h).json()] == ["Due", "Later", "Someday"]

    r = client.post(f"/v1/jobs/contacts/{due['id']}/contacted", headers=h)
    assert r.status_code == 200
    touched = r.json()
    assert touched["last_contacted_at"] is not None
    next_at = datetime.fromisoformat(touched["follow_up_at"])
    assert timedelta(days=6, hours=23) < next_at - now < timedelta(days=7, hours=1)  # a week out
    r = client.post(f"/v1/jobs/contacts/{later['id']}/contacted", headers=h, json={"no_follow_up": True})
    assert r.json()["follow_up_at"] is None
    assert client.get("/v1/jobs/contacts", headers=h).json()[0]["name"] == "Due"  # next week's, before the rest


def test_the_migration_adds_and_removes_the_table(tmp_path: Any) -> None:
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    db = tmp_path / "contacts.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}
    api = Path(__file__).parents[1]

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    def tables() -> set[str]:
        with sqlite3.connect(db) as conn:
            return {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}

    alembic("upgrade", "head")
    assert "job_contacts" in tables()
    with sqlite3.connect(db) as conn:
        cols = {r[1] for r in conn.execute("pragma table_info(job_contacts)")}
    assert {"name", "relation", "follow_up_at", "application_id", "last_contacted_at"} <= cols
    alembic("downgrade", "b5d7e9f1a3c6")
    assert "job_contacts" not in tables()
    alembic("upgrade", "head")
