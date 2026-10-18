"""Users & access: what each account has had and used (credits, interview minutes, sessions, payments), the server
totals, search, and one account's history. Admin only."""

import uuid

import pytest

from orbit_api.resumes import allowance
from tests.test_phase1 import _add_usage
from tests.test_signup_approval import _client
from tests.test_signup_approval import _register as _register_named


def test_the_admin_sees_what_each_account_has_used(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(allowance, "ENFORCE_IN_TESTS", True)  # resume AI spends a credit, as in production
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, user = _register_named(client, f"u-{uuid.uuid4().hex[:8]}@example.com")
        _add_usage(user["id"], "live_seconds", 7 * 60)
        _add_usage(user["id"], "mock_seconds", 3 * 60)
        assert client.post(f"/v1/admin/users/{user['id']}/credits", headers=admin,
                           json={"resume": 4, "interview_minutes": 30}).status_code == 200
        assert client.post("/v1/resumes/cover-letter", headers=h, json={
            "data": {"basics": {"name": "Sam"}, "experience": [{"title": "Engineer", "company": "X",
                                                                 "bullets": ["Built the API"]}]},
            "job_text": ""}).status_code == 200  # one resume AI action

        out = client.get("/v1/admin/users?only=all", headers=admin).json()
        row = next(u for u in out["users"] if u["id"] == user["id"])
        usage = row["usage"]
        assert usage["live_minutes_used"] == 7 and usage["mock_minutes_used"] == 3
        assert usage["interview_minutes_given"] == 50  # 20 welcome + 30 from the admin
        assert row["interview_minutes_left"] == 40
        assert usage["resume_given"] == 5 and usage["resume_used"] == 1 and row["resume_credits"] == 4
        assert usage["last_active"] is not None
        totals = out["totals"]
        assert totals["users"] >= 2 and totals["interview_minutes_this_month"] >= 10
        assert totals["resume_credits_used_this_month"] >= 1

        # Search by email, and the account's history.
        found = client.get(f"/v1/admin/users?only=all&q={user['email'][:6]}", headers=admin).json()["users"]
        assert [u["id"] for u in found] == [user["id"]]
        assert client.get("/v1/admin/users?only=all&q=%25", headers=admin).json()["users"] == []  # no wildcards
        items = client.get(f"/v1/admin/users/{user['id']}/activity", headers=admin).json()["items"]
        texts = {i["text"] for i in items}
        assert {"Welcome credits", "Given by you", "Resume AI"} <= texts
        assert any(i["amount"] == "+30 interview mins" for i in items)

        # Admin only.
        assert client.get("/v1/admin/users", headers=h).status_code == 403
        assert client.get(f"/v1/admin/users/{user['id']}/activity", headers=h).status_code == 403
        assert client.get("/v1/admin/users/nope/activity", headers=admin).status_code == 404
    finally:
        gen.close()


def test_last_active_counts_every_tool_and_signing_in_is_seen_apart(monkeypatch: pytest.MonkeyPatch) -> None:
    """An account that only used the story bank (or documents, Code AI, offers…) read "Last active: never"; and one
    that only signed in looked the same as one nobody opened. Signing in is `last_seen`, never `last_active`."""
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        h, user = _register_named(client, f"u-{uuid.uuid4().hex[:8]}@example.com")
        client.get("/v1/auth/me", headers=h)

        def usage() -> dict[str, object]:
            out = client.get("/v1/admin/users?only=all", headers=admin).json()
            return dict(next(u for u in out["users"] if u["id"] == user["id"])["usage"])

        before = usage()
        assert before["last_active"] is None and before["last_seen"] is not None
        r = client.post("/v1/stories", headers=h, json={"title": "Cut the build time", "situation": "Slow CI.",
                                                         "action": "Cached the deps.", "result": "Builds 3x faster."})
        assert r.status_code in (200, 201), r.text
        assert usage()["last_active"] is not None
    finally:
        gen.close()
