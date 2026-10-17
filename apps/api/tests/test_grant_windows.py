"""Plans for a while (paid months and the admin's grants, entitlements.py, DECISIONS D57): each one's allowance runs in
30-day windows from when it began, so use from before never counts against it; every window has the plan's whole
allowance (a week's too: it's a fair-use cap the pricing promises); and a new plan never cuts short time already given
or paid for."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.entitlements import (
    active_grant,
    add_grant,
    clear_grants,
    current_grant,
    grants,
    period_start,
    roll,
    running_until,
)
from orbit_api.models import User

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=UTC)
DAY = timedelta(days=1)


def _user() -> User:
    return User(email=f"g-{uuid.uuid4().hex[:8]}@example.com", password_hash="x", grant_paid=False)


def test_a_weeks_window_starts_when_it_was_bought() -> None:
    u = _user()
    add_grant(u, "premium", 7 * DAY, paid=True, now=T0)
    assert period_start(u, T0 + 2 * DAY) == T0  # it used to reach back 23 days before the purchase


def test_a_year_runs_in_30_day_windows_from_its_start() -> None:
    u = _user()
    add_grant(u, "premium", 365 * DAY, paid=True, now=T0)
    assert period_start(u, T0 + 45 * DAY) == T0 + 30 * DAY
    assert period_start(u, T0 + 362 * DAY) == T0 + 360 * DAY  # the last window: the year's last 5 days


def test_an_admin_grants_window_starts_when_it_was_given() -> None:
    u = _user()
    add_grant(u, "pro", timedelta(hours=2), paid=False, now=T0)
    assert period_start(u, T0 + timedelta(minutes=5)) == T0


def test_a_week_renewed_early_follows_on_with_its_own_whole_allowance() -> None:
    """Bought again while it runs, the second week starts where the first ends, with a window of its own: it used to
    join the first in one window, so a week renewed after the first's hours were used started with none."""
    u = _user()
    add_grant(u, "premium", 7 * DAY, paid=True, now=T0)
    second = add_grant(u, "premium", 7 * DAY, paid=True, now=T0 + 3 * DAY)
    assert (second.start, second.until) == (T0 + 7 * DAY, T0 + 14 * DAY)
    assert running_until(u, T0 + 4 * DAY) == T0 + 14 * DAY  # the plan doesn't stop in between
    assert period_start(u, T0 + 4 * DAY) == T0 and period_start(u, T0 + 8 * DAY) == T0 + 7 * DAY
    add_grant(u, "premium", 7 * DAY, paid=True, now=T0 + 20 * DAY)  # after it ended: from now, a fresh window
    assert period_start(u, T0 + 21 * DAY) == T0 + 20 * DAY


def test_the_admins_more_of_the_same_adds_on_in_place() -> None:
    u = _user()
    add_grant(u, "unlimited", timedelta(hours=2), paid=False, now=T0)
    add_grant(u, "unlimited", timedelta(hours=2), paid=False, now=T0 + timedelta(hours=1))
    assert (u.grant_until, u.grant_queue) == (T0 + timedelta(hours=4), None)



def test_a_paid_week_never_cuts_an_admin_unlimited_grant_short() -> None:
    u = _user()
    add_grant(u, "unlimited", 90 * DAY, paid=False, now=T0)
    week = add_grant(u, "premium", 7 * DAY, paid=True, now=T0 + DAY)
    assert active_grant(u, T0 + 2 * DAY) == "unlimited" and current_grant(u, T0 + 2 * DAY).until == T0 + 90 * DAY  # type: ignore[union-attr]
    assert (week.start, week.until) == (T0 + 90 * DAY, T0 + 97 * DAY)  # it waits its turn, whole
    later = T0 + 90 * DAY + timedelta(hours=1)
    assert active_grant(u, later) == "premium" and period_start(u, later) == T0 + 90 * DAY
    roll(u, later)  # stored as running once the sweep (or the next change) moves it on
    assert (u.grant_plan, u.grant_until, u.grant_queue) == ("premium", T0 + 97 * DAY, None)


def test_a_higher_plan_runs_now_and_the_rest_waits_with_its_windows() -> None:
    u = _user()
    add_grant(u, "premium", 30 * DAY, paid=True, now=T0)
    two_hours = add_grant(u, "unlimited", timedelta(hours=2), paid=False, now=T0 + 10 * DAY)
    assert active_grant(u, two_hours.start) == "unlimited"  # type: ignore[arg-type]
    back = T0 + 10 * DAY + timedelta(hours=3)
    month = current_grant(u, back)
    assert month is not None and month.plan == "premium"
    assert month.until == T0 + 30 * DAY + timedelta(hours=2)  # all 20 days left, after the 2 hours
    assert period_start(u, back) == T0  # still the month's own window: its first 10 days' use counts in it
    assert [g.plan for g in grants(u)] == ["unlimited", "premium"]


def test_a_lower_plan_waits_and_the_best_waiting_runs_next() -> None:
    u = _user()
    add_grant(u, "unlimited", 2 * DAY, paid=False, now=T0)
    add_grant(u, "pro", 3 * DAY, paid=False, now=T0 + timedelta(hours=1))
    add_grant(u, "premium", 7 * DAY, paid=True, now=T0 + timedelta(hours=2))
    assert [(g.plan, g.start) for g in grants(u)] == [
        ("unlimited", T0), ("premium", T0 + 2 * DAY), ("pro", T0 + 9 * DAY)]
    clear_grants(u)  # the admin's revoke: nothing left waiting either
    assert grants(u) == [] and u.grant_queue is None


def _db(client: TestClient, fn: Any) -> Any:
    from orbit_api.db import sessionmaker

    async def go() -> Any:
        async with sessionmaker()() as db:
            return await fn(db)

    return client.portal.call(go)  # type: ignore[union-attr]


def test_a_week_gets_the_full_allowance_from_its_start(client: TestClient) -> None:
    """3,000 minutes used on a Premium week that ended ten days ago: a new week starts with the plan's whole 3,000 (and
    1,500 mock), as the pricing promises; only its own use counts."""
    from orbit_api.entitlements import minutes_remaining
    from orbit_api.models import UsageEvent
    from tests.test_api import _register

    _register(client)  # the first account stands in as the admin (no limits) when this runs alone
    h = _register(client)
    uid = client.get("/v1/auth/me", headers=h).json()["id"]
    now = datetime.now(UTC)

    def used(minutes: int, ago: timedelta) -> UsageEvent:
        return UsageEvent(user_id=uid, metric="live_seconds", quantity=minutes * 60, pool="premium",
                          created_at=now - ago)

    async def buy(db: Any) -> tuple[float | None, float | None]:
        db.add(used(3000, 10 * DAY))  # the earlier week's
        user = await db.get(User, uid)
        add_grant(user, "premium", 7 * DAY, paid=True, now=now - timedelta(hours=1))
        await db.commit()
        fresh = await minutes_remaining(db, uid, "interview")
        db.add(used(100, timedelta(minutes=5)))  # this week's
        await db.commit()
        return fresh, await minutes_remaining(db, uid, "interview")

    assert _db(client, buy) == (3000, 2900)
    e = client.get("/v1/entitlements", headers=h).json()
    assert e["plan"] == "premium" and (e["limits"]["live_minutes"], e["limits"]["mock_minutes"]) == (3000, 1500)


def test_buying_while_the_admins_unlimited_runs_keeps_both(monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.test_monthly_plans import _pay
    from tests.test_signup_approval import _client, _outbox
    from tests.test_signup_approval import _register as _register_named

    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_UPI_ID="owner@okicici", ORBIT_UPI_NAME="Owner")
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, user = _register_named(client, f"g-{uuid.uuid4().hex[:8]}@example.com")
        given = client.post(f"/v1/admin/users/{user['id']}/access", headers=admin,
                            json={"action": "grant", "plan": "unlimited", "hours": 24 * 60})
        assert given.status_code == 200, given.text
        until = datetime.fromisoformat(client.get("/v1/entitlements", headers=h).json()["until"])
        _pay(client, h, admin, "premium_weekly")
        e = client.get("/v1/entitlements", headers=h).json()
        # It used to become a Premium week from now, and the 60 days of Unlimited were gone.
        assert e["plan"] == "unlimited" and datetime.fromisoformat(e["until"]) == until
        mail = next(m for m in reversed(_outbox().sent) if m.subject.startswith("Payment received"))
        assert "It starts on" in mail.text and "none of either is lost" in mail.text
    finally:
        gen.close()


def test_the_sweep_stores_the_next_grant_as_running(client: TestClient) -> None:
    from orbit_api.entitlements import roll_due_grants
    from tests.test_api import _register

    h = _register(client)
    uid = client.get("/v1/auth/me", headers=h).json()["id"]
    now = datetime.now(UTC)

    async def queued(db: Any) -> None:
        user = await db.get(User, uid)
        add_grant(user, "unlimited", timedelta(hours=1), paid=False, now=now - timedelta(hours=2))
        add_grant(user, "premium", 7 * DAY, paid=True, now=now - timedelta(hours=2) + timedelta(minutes=1))
        await db.commit()

    async def stored(db: Any) -> tuple[Any, ...]:
        user = await db.get(User, uid)
        return user.grant_plan, user.grant_queue

    _db(client, queued)
    assert _db(client, stored) == ("unlimited", [{"plan": "premium", "seconds": 7 * 86400.0, "paid": True,
                                                  "anchor": None}])
    client.portal.call(roll_due_grants)  # type: ignore[union-attr]
    assert _db(client, stored) == ("premium", None)


def test_the_migration_backfills_where_each_grant_began(tmp_path: Any) -> None:
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    db = tmp_path / "grants.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}
    api = Path(__file__).parents[1]

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    alembic("upgrade", "b4d6f8a0c2e4")  # the revision before this one
    bought, given = T0 + 2 * DAY, T0 + 5 * DAY
    with sqlite3.connect(db) as conn:
        for uid, until in (("paid", bought + 7 * DAY), ("admin", given + 2 * DAY), ("unknown", T0 + 9 * DAY)):
            conn.execute("INSERT INTO users (id, email, password_hash, has_password, email_verified, token_version, "
                         "store_transcripts, store_screenshots, approved, grant_plan, grant_until, created_at) VALUES "
                         "(?, ?, 'x', 1, 1, 0, 1, 0, 1, 'premium', ?, ?)",
                         (uid, f"{uid}@example.com", until.isoformat(" "), T0.isoformat(" ")))
        conn.execute("INSERT INTO payments (id, user_id, plan, amount_inr, days, resume_credits, interview_minutes, "
                     "reference, status, refunded_paise, reconcile_attempts, currency, decided_at, created_at) VALUES "
                     "('p1', 'paid', 'premium_weekly', 4799, 7, 0, 0, 'R1', 'approved', 0, 0, 'INR', ?, ?)",
                     (bought.isoformat(" "), bought.isoformat(" ")))
        conn.execute("INSERT INTO audit_logs (id, user_id, action, target, created_at) VALUES "
                     "('a1', 'boss', 'admin.access.grant', 'admin unlimited 48.0h', ?)", (given.isoformat(" "),))
    alembic("upgrade", "head")
    with sqlite3.connect(db) as conn:
        rows = {r[0]: r[1:] for r in conn.execute("SELECT id, grant_started_at, grant_paid FROM users")}
    assert rows["paid"][0].startswith("2026-10-03 09:00") and rows["paid"][1] == 1
    assert rows["admin"][0].startswith("2026-10-06 09:00") and rows["admin"][1] == 0
    assert rows["unknown"] == (None, 0)  # nothing to go by: its windows count back from its end, as before
    alembic("downgrade", "b4d6f8a0c2e4")
    alembic("upgrade", "head")
