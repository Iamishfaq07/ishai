from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from orbit_api.db import sessionmaker
from orbit_api.job_portal import alerts
from orbit_api.models import JobSearchProfile, User
from tests.test_api import _register
from tests.test_email_flows import _outbox
from tests.test_jobs import _listing, insert, jobs, run  # noqa: F401  (the fixture)

PREFS = {"titles": ["Backend Engineer"], "skills": ["Go", "Kafka"], "locations": [], "posted_within": 7}


def _me(client: TestClient, h: dict[str, str]) -> dict[str, str]:
    me: dict[str, str] = client.get("/v1/auth/me", headers=h).json()
    return me


def _verify(client: TestClient, user_id: str) -> None:
    async def go() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(User).where(User.id == user_id).values(email_verified=True))
            await db.commit()
    run(client, go)


def _backdate(client: TestClient, user_id: str, days: float) -> None:
    async def go() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(JobSearchProfile).where(JobSearchProfile.user_id == user_id)
                             .values(alert_sent_at=datetime.now(UTC) - timedelta(days=days)))
            await db.commit()
    run(client, go)


def _send(client: TestClient) -> int:
    out: list[int] = []

    async def go() -> None:
        out.append(await alerts.send_due())
    run(client, go)
    return out[0]


def test_a_daily_alert_lists_new_matches_once_and_can_be_stopped(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    me = _me(jobs, h)
    _verify(jobs, me["id"])
    assert jobs.put("/v1/jobs/profile", headers=h, json={"prefs": PREFS}).status_code == 200
    r = jobs.put("/v1/jobs/alerts", headers=h, json={"frequency": "daily"})
    assert r.status_code == 200 and r.json()["frequency"] == "daily" and r.json()["can_email"] is True
    # Started just now: nothing is due yet.
    assert _send(jobs) == 0
    _backdate(jobs, me["id"], 1.2)
    old = _listing(company="Oldco", title="Backend Engineer", created_at=datetime.now(UTC) - timedelta(days=3))
    new = _listing(company="Razorpay", title="Backend Engineer", salary="₹30L a year")
    other = _listing(company="Sales Inc", title="Account Executive", keywords=["Salesforce"])
    tracked = _listing(company="Groww", title="Backend Engineer")
    _, _, _, t = insert(jobs, old, new, other, tracked)
    jobs.post("/v1/jobs/tracker", headers=h, json={"listing_id": t})
    assert _send(jobs) == 1
    mail = _outbox().sent[-1]
    assert mail.to == me["email"]
    assert len([m for m in _outbox().sent if m.to == me["email"] and "alerts/off" in m.text]) == 1
    assert "Backend Engineer at Razorpay" in mail.text and "₹30L a year" in mail.text
    assert "Oldco" not in mail.text and "Sales Inc" not in mail.text and "Groww" not in mail.text
    assert mail.subject == "Backend Engineer at Razorpay"
    # Sent: not again until tomorrow.
    assert _send(jobs) == 0
    token = mail.text.split("alerts/off?token=")[1].split()[0]
    assert jobs.post("/v1/jobs/alerts/off", json={"token": "x" * 32}).status_code == 404
    assert jobs.post("/v1/jobs/alerts/off", json={"token": token}).status_code == 204
    assert jobs.get("/v1/jobs/alerts", headers=h).json()["frequency"] == "off"


def test_weekly_waits_a_week_and_unverified_gets_nothing(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    me = _me(jobs, h)
    jobs.put("/v1/jobs/profile", headers=h, json={"prefs": PREFS})
    assert jobs.put("/v1/jobs/alerts", headers=h, json={"frequency": "weekly"}).json()["can_email"] is False
    _backdate(jobs, me["id"], 3)
    insert(jobs, _listing(company="Zerodha", title="Backend Engineer"))
    assert _send(jobs) == 0  # unverified
    _verify(jobs, me["id"])
    assert _send(jobs) == 0  # three days: not a week
    _backdate(jobs, me["id"], 7)
    assert _send(jobs) == 1


def test_alerts_need_sign_in_and_a_known_frequency(jobs: TestClient) -> None:  # noqa: F811
    assert jobs.get("/v1/jobs/alerts").status_code == 401
    h = _register(jobs)
    assert jobs.put("/v1/jobs/alerts", headers=h, json={"frequency": "hourly"}).status_code == 422
    # No saved profile yet: turning alerts on saves the one the feed uses.
    assert jobs.put("/v1/jobs/alerts", headers=h, json={"frequency": "daily"}).status_code == 200
    assert jobs.get("/v1/jobs/profile", headers=h).json()["saved"] is True


def test_weekly_alerts_not_due_dont_crowd_out_daily_ones(jobs: TestClient,  # noqa: F811
                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    """A sweep takes BATCH profiles, oldest send first. Weekly ones sent 2-6 days ago aren't due, but they used to be
    picked (only "a day ago" was asked), skipped, and picked again next sweep: with BATCH of them, no daily alert
    was ever sent."""
    monkeypatch.setattr(alerts, "BATCH", 3)

    def subscriber(frequency: str, days: float) -> str:
        h = _register(jobs)
        uid = _me(jobs, h)["id"]
        _verify(jobs, uid)
        jobs.put("/v1/jobs/profile", headers=h, json={"prefs": PREFS})
        jobs.put("/v1/jobs/alerts", headers=h, json={"frequency": frequency})
        _backdate(jobs, uid, days)
        return uid

    for days in (3, 4, 5):
        subscriber("weekly", days)
    daily = subscriber("daily", 1.2)
    _send(jobs)

    async def sent_at() -> datetime:
        async with sessionmaker()() as db:
            row = await db.get(JobSearchProfile, daily)
            assert row is not None and row.alert_sent_at is not None
            return row.alert_sent_at.replace(tzinfo=UTC) if row.alert_sent_at.tzinfo is None else row.alert_sent_at

    assert datetime.now(UTC) - run(jobs, sent_at) < timedelta(minutes=5)  # its turn came
