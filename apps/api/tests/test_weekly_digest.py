"""The opt-in weekly progress email: off by default, only when there is news, stoppable without signing in."""
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import update

from orbit_api.db import sessionmaker
from orbit_api.job_portal import digest
from orbit_api.models import CareerPlaybook, JobApplication
from orbit_api.providers.email import OutgoingEmail
from tests.test_api import _register
from tests.test_email_flows import _outbox
from tests.test_job_alerts import _me, _verify
from tests.test_jobs import jobs, run  # noqa: F401  (the fixture)


def _digests(email: str) -> list[OutgoingEmail]:
    return [m for m in _outbox().sent if m.to == email and "digest/off" in m.text]


def _send(client: TestClient) -> int:
    out: list[int] = []

    async def go() -> None:
        out.append(await digest.send_due())
    run(client, go)
    return out[0]


def _rules(client: TestClient, h: dict[str, str], **values: object) -> dict[str, object]:
    current = client.get("/v1/jobs/playbook", headers=h).json()
    revision = current.pop("revision")
    r = client.put("/v1/jobs/playbook", headers=h, json={**current, "base_revision": revision, **values})
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def _applied(client: TestClient, h: dict[str, str], company: str, days_ago: float) -> str:
    r = client.post("/v1/jobs/tracker/manual", headers=h, json={
        "title": "Platform engineer", "company": company, "status": "applied"})
    assert r.status_code == 201, r.text
    jid = str(r.json()["id"])

    async def go() -> None:
        async with sessionmaker()() as db:
            when = datetime.now(UTC) - timedelta(days=days_ago)
            await db.execute(update(JobApplication).where(JobApplication.id == jid)
                             .values(applied_at=when, status_at=when))
            await db.commit()
    run(client, go)
    return jid


def test_weekly_digest_is_opt_in_sends_this_weeks_news_once_and_stops_by_link(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    me = _me(jobs, h)
    _verify(jobs, me["id"])
    _applied(jobs, h, "Northstar", 2)
    assert jobs.get("/v1/jobs/playbook", headers=h).json()["weekly_digest"] is False
    _send(jobs)
    assert not _digests(me["email"])  # off until turned on

    assert _rules(jobs, h, weekly_digest=True, follow_up_days=7)["weekly_digest"] is True
    _send(jobs)
    mine = _digests(me["email"])
    assert len(mine) == 1
    mail = mine[0]
    assert "1 application recorded" in mail.text and mail.subject.startswith("Your week: 1 application recorded")
    assert "not a prediction" in mail.text and "/jobs/digest/off?token=" in mail.text
    _send(jobs)
    assert len(_digests(me["email"])) == 1  # not again this week

    token = mail.text.split("digest/off?token=")[1].split()[0]
    assert jobs.post("/v1/jobs/playbook/digest/off", json={"token": "x" * 32}).status_code == 404
    assert jobs.post("/v1/jobs/playbook/digest/off", json={"token": token}).status_code == 204
    assert jobs.get("/v1/jobs/playbook", headers=h).json()["weekly_digest"] is False
    # The rest of the rules are untouched.
    assert jobs.get("/v1/jobs/playbook", headers=h).json()["follow_up_days"] == 7


def test_a_quiet_week_sends_nothing(jobs: TestClient) -> None:  # noqa: F811
    h = _register(jobs)
    me = _me(jobs, h)
    _verify(jobs, me["id"])
    _rules(jobs, h, weekly_digest=True)
    _send(jobs)
    assert not _digests(me["email"])

    async def sent_at() -> None:
        async with sessionmaker()() as db:
            row = await db.get(CareerPlaybook, me["id"])
            assert row is not None and row.digest_sent_at is not None  # checked, so not re-checked until next week
    run(jobs, sent_at)
