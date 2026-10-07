"""The admin console: one account in full, deleting it (typed email, live work stopped, payments kept), taking credits
away (never below zero), suspending, signing out everywhere, notes and edits, bulk credits, the filtered list and its
CSV, the audit log, the dashboard numbers and the announcement banner. Admin only, and never on the admin account."""

import csv
import io
import json
import re
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from orbit_api.admin import accounts as accounts_mod
from orbit_api.models import (
    AuditLog,
    CreditEntry,
    JobApplication,
    JobFitCheck,
    LiveSessionRow,
    Payment,
    User,
)
from tests.test_api import _close_code, _doc
from tests.test_phase1 import _add_usage, _collect, _live
from tests.test_signup_approval import _client, _outbox
from tests.test_signup_approval import _register as _register_named

PASSWORD = "correct horse battery"


@pytest.fixture
def console(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, dict[str, str], dict[str, Any]]]:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_UPI_ID="owner@okicici", ORBIT_UPI_NAME="Owner")
    client = next(gen)
    admin, admin_user = _register_named(client, admin_email)
    yield client, admin, admin_user
    gen.close()


def _user(client: TestClient, tag: str = "u") -> tuple[dict[str, str], dict[str, Any]]:
    return _register_named(client, f"{tag}-{uuid.uuid4().hex[:8]}@example.com")


def _login(client: TestClient, email: str, password: str = PASSWORD) -> Any:
    r = client.post("/v1/auth/login", json={"email": email, "password": password})
    client.cookies.clear()
    return r


def _db(client: TestClient, fn: Any) -> Any:
    from orbit_api.db import sessionmaker

    async def go() -> Any:
        async with sessionmaker()() as db:
            return await fn(db)

    return client.portal.call(go)  # type: ignore[union-attr]


def _utr() -> str:
    return f"{uuid.uuid4().int % 10**12:012d}"


def _approved_payment(client: TestClient, admin: dict[str, str], h: dict[str, str]) -> dict[str, Any]:
    o = client.post("/v1/billing/upi/orders", headers=h, json={"pack": "starter"}).json()
    assert client.post(f"/v1/billing/upi/orders/{o['id']}/utr", headers=h, json={"utr": _utr()}).status_code == 200
    r = client.post(f"/v1/admin/payments/{o['id']}", headers=admin, json={"action": "approve"})
    assert r.status_code == 200, r.text
    return dict(r.json())


# ---- admin only, and never the admin account ----------------------------------------------------------------

ENDPOINTS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "/v1/admin/users/{id}", None),
    ("PATCH", "/v1/admin/users/{id}", {"name": "x"}),
    ("DELETE", "/v1/admin/users/{id}", {"confirm_email": "a@example.com"}),
    ("POST", "/v1/admin/users/{id}/credits/remove", {"resume": 1, "reason": "testing"}),
    ("POST", "/v1/admin/users/{id}/suspend", {"reason": "testing"}),
    ("POST", "/v1/admin/users/{id}/unsuspend", None),
    ("POST", "/v1/admin/users/{id}/sign-out", None),
    ("POST", "/v1/admin/users/{id}/password-reset", None),
    ("POST", "/v1/admin/users/bulk-credits", {"user_ids": ["{id}"], "resume": 1}),
    ("GET", "/v1/admin/users/export", None),
    ("GET", "/v1/admin/audit", None),
    ("GET", "/v1/admin/stats", None),
]


def test_every_console_endpoint_is_admin_only(console: Any) -> None:
    client, _, admin_user = console
    h, user = _user(client)
    for method, path, body in ENDPOINTS:
        url = path.replace("{id}", admin_user["id"])
        payload = json.loads(json.dumps(body).replace("{id}", admin_user["id"])) if body else None
        r = client.request(method, url, headers=h, json=payload)
        assert r.status_code == 403, (method, path, r.status_code, r.text)
        assert client.request(method, url, json=payload).status_code in (401, 403), (method, path)
    # Nothing happened to anyone.
    assert client.get("/v1/auth/me", headers=h).json()["id"] == user["id"]


def test_the_admin_cant_suspend_delete_zero_or_sign_out_themselves_or_the_admin_account(
        console: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    client, admin, admin_user = console
    me = admin_user["id"]
    tries = [("POST", f"/v1/admin/users/{me}/suspend", {"reason": "testing"}),
             ("DELETE", f"/v1/admin/users/{me}", {"confirm_email": admin_user["email"]}),
             ("POST", f"/v1/admin/users/{me}/credits/remove", {"all_resume": True, "all_interview": True,
                                                                "reason": "testing"}),
             ("POST", f"/v1/admin/users/{me}/sign-out", None)]
    for method, url, body in tries:
        r = client.request(method, url, headers=admin, json=body)
        assert r.status_code == 422 and "your own account" in r.json()["detail"], (url, r.text)
    # Another account that counts as the admin (the dev-mode first account, say) is protected the same way.
    _, other = _user(client, "other")
    real = accounts_mod.is_admin

    async def also_admin(db: Any, u: User) -> bool:
        return u.id == other["id"] or await real(db, u)

    monkeypatch.setattr(accounts_mod, "is_admin", also_admin)
    for method, url, body in tries:
        url = url.replace(me, other["id"])
        if body and "confirm_email" in body:
            body = {"confirm_email": other["email"]}
        r = client.request(method, url, headers=admin, json=body)
        assert r.status_code == 422 and "the admin account" in r.json()["detail"], (url, r.text)
    # Its email-verified flag isn't the console's to change (un-verifying the admin would lock them out).
    assert client.patch(f"/v1/admin/users/{other['id']}", headers=admin,
                        json={"email_verified": False}).status_code == 422
    assert client.get(f"/v1/admin/users/{me}", headers=admin).json()["is_you"] is True
    assert client.get("/v1/auth/me", headers=admin).status_code == 200  # still signed in
    assert client.post(f"/v1/admin/users/{me}/access", headers=admin, json={"action": "revoke"}).status_code == 422


# ---- delete --------------------------------------------------------------------------------------------------


_DELETED_IDS_FK = ("users", "sessions", "documents", "workspaces", "resumes")


def test_deleting_an_account_needs_its_email_stops_live_work_and_keeps_the_payments(console: Any) -> None:
    client, admin, admin_user = console
    h, user = _user(client, "gone")
    uid = user["id"]
    doc = _doc(client, h, "resume_sample")
    ws = client.post("/v1/workspaces", headers=h, json={"name": "Acme"}).json()["id"]
    sid = client.post("/v1/sessions", headers=h, json={"title": "loop", "document_ids": [doc]}).json()["id"]
    resume = client.post("/v1/resumes", headers=h, json={"title": "Mine"}).json()["id"]
    assert client.post("/v1/stories", headers=h, json={"title": "Outage"}).status_code == 201
    pay = _approved_payment(client, admin, h)
    assert client.post(f"/v1/admin/users/{uid}/credits", headers=admin,
                       json={"resume": 2, "note": "sorry about the outage"}).status_code == 200
    _add_usage(uid, "live_seconds", 120)

    async def jobs(db: Any) -> None:
        db.add(JobApplication(user_id=uid, listing_id="l1", source="greenhouse", company="Acme", title="SRE",
                              url="https://x", apply_url="https://x", resume_id=resume, document_id=doc))
        db.add(JobFitCheck(user_id=uid, listing_id="l1", resume_hash="h", result={}))
        await db.commit()

    _db(client, jobs)
    revenue = client.get("/v1/admin/stats", headers=admin).json()["revenue_total_inr"]
    assert revenue >= pay["amount_inr"]

    # Typed email, exactly that account's.
    wrong = client.request("DELETE", f"/v1/admin/users/{uid}", headers=admin, json={"confirm_email": "x@y.z"})
    assert wrong.status_code == 422 and "Type the account's email" in wrong.json()["detail"]
    assert client.request("DELETE", f"/v1/admin/users/{uid}", headers=admin, json={}).status_code == 422
    with _live(client, h, sid) as live:
        _collect(live, lambda ev: any(e["type"] == "session.started" for e in ev))
        r = client.request("DELETE", f"/v1/admin/users/{uid}", headers=admin,
                           json={"confirm_email": f"  {user['email'].upper()} "})
        assert r.status_code == 204, r.text
        _collect(live, lambda ev: any(e["type"] == "session.ended" for e in ev))  # its live session was stopped
        assert _close_code(live) == 4009

    assert client.get("/v1/auth/me", headers=h).status_code == 401
    assert client.get(f"/v1/admin/users/{uid}", headers=admin).status_code == 404

    async def leftovers(db: Any) -> dict[str, Any]:
        from orbit_api.db import Base

        ids = {"users": [uid], "sessions": [sid], "documents": [doc], "workspaces": [ws], "resumes": [resume]}
        orphans: dict[str, int] = {}
        for table in Base.metadata.sorted_tables:
            for col in table.columns:
                for fk in col.foreign_keys:
                    parent = fk.column.table.name
                    if parent in _DELETED_IDS_FK:
                        n = await db.scalar(select(func.count()).select_from(table).where(col.in_(ids[parent])))
                        if n:
                            orphans[f"{table.name}.{col.name}"] = n
        kept = await db.get(Payment, pay["id"])
        notes = (await db.scalars(select(CreditEntry.note).where(CreditEntry.user_id == uid))).all()
        trail = (await db.scalars(select(AuditLog).where(AuditLog.action == "admin.user.delete",
                                                         AuditLog.target.like(f"{uid}%")))).all()
        ips = (await db.scalars(select(AuditLog.ip).where(AuditLog.user_id == uid))).all()
        return {"orphans": orphans, "payment": (kept.user_id, kept.status) if kept else None, "notes": notes,
                "trail": [(t.user_id, t.target) for t in trail], "ips": ips}

    left = _db(client, leftovers)
    assert left["orphans"] == {}  # every row of the account and its sessions/documents/... went with it
    assert left["payment"] == (None, "approved")  # the payment stays on the books, without the account
    assert left["notes"] and all(n is None for n in left["notes"])  # ledger kept (welcome abuse), notes cleared
    assert left["trail"] == [(admin_user["id"], f"{uid} {user['email']}")]  # outlives it, with the email
    assert left["ips"] and all(ip is None for ip in left["ips"])
    # Revenue history is unchanged, and the payment list says whose it was.
    assert client.get("/v1/admin/stats", headers=admin).json()["revenue_total_inr"] == revenue
    rows = client.get("/v1/admin/payments?only=all", headers=admin).json()["payments"]
    assert next(p for p in rows if p["id"] == pay["id"])["email"] == "(deleted account)"
    found = client.get(f"/v1/admin/audit?q={user['email'][:12]}", headers=admin).json()["items"]
    assert [i["action"] for i in found] == ["admin.user.delete"]


# ---- taking credits away -------------------------------------------------------------------------------------


def test_removing_credits_never_goes_below_zero_and_each_removal_says_why(console: Any) -> None:
    client, admin, _ = console
    h, user = _user(client, "credits")
    uid = user["id"]
    url = f"/v1/admin/users/{uid}/credits/remove"
    # Welcome: 1 resume credit, 20 minutes. Plus 4 and 30 by hand; 7 minutes used.
    assert client.post(f"/v1/admin/users/{uid}/credits", headers=admin,
                       json={"resume": 4, "interview_minutes": 30, "note": "beta tester"}).status_code == 200
    _add_usage(uid, "live_seconds", 7 * 60)

    assert client.post(url, headers=admin, json={"resume": 1}).status_code == 422  # a reason is required
    assert client.post(url, headers=admin, json={"resume": 1, "reason": "   x  "}).status_code == 422
    assert client.post(url, headers=admin, json={"reason": "nothing asked"}).status_code == 422
    assert client.post(url, headers=admin, json={"resume": -1, "reason": "negative"}).status_code == 422

    r = client.post(url, headers=admin, json={"resume": 2, "reason": "duplicate refund"}).json()
    assert (r["removed_resume"], r["clamped"], r["user"]["resume_credits"]) == (2, False, 3)
    assert r["message"] == "Removed 2 resume credits."

    r = client.post(url, headers=admin, json={"resume": 10, "interview_minutes": 100,
                                               "reason": "chargeback"}).json()
    assert r["clamped"] is True and r["removed_resume"] == 3 and r["removed_interview_minutes"] == 43
    assert r["user"]["resume_credits"] == 0 and r["user"]["interview_minutes_left"] == 0
    assert "Only 3 resume credits were left" in r["message"] and "Only 43 interview minutes were left" in r["message"]
    nothing = client.post(url, headers=admin, json={"resume": 1, "reason": "again"})
    assert nothing.status_code == 409 and "already zero" in nothing.json()["detail"]

    # "Set to zero" takes exactly what's left.
    client.post(f"/v1/admin/users/{uid}/credits", headers=admin, json={"interview_minutes": 5})
    r = client.post(url, headers=admin, json={"all_interview": True, "reason": "trial over"}).json()
    assert r["removed_interview_minutes"] == 5 and r["clamped"] is False and r["user"]["interview_minutes_left"] == 0

    # The account sees zero, never less; its history explains each removal.
    wallet = client.get("/v1/entitlements", headers=h).json()["credits"]
    assert wallet["resume"] == 0 and wallet["interview_minutes_left"] == 0
    detail = client.get(f"/v1/admin/users/{uid}", headers=admin).json()
    removed = [e for e in detail["ledger"] if e["reason"] == "admin_remove"]
    assert [e["note"] for e in removed] == ["trial over", "chargeback", "chargeback", "duplicate refund"]
    assert {e["text"] for e in removed} >= {"Removed by you: chargeback", "Removed by you: trial over"}
    assert any(e["text"] == "Given by you: beta tester" for e in detail["ledger"])
    usage = detail["user"]["usage"]
    assert usage["resume_removed"] == 5 and usage["resume_used"] == 0  # removals aren't "used"
    assert usage["interview_minutes_removed"] == 48
    texts = {i["text"] for i in client.get(f"/v1/admin/users/{uid}/activity", headers=admin).json()["items"]}
    assert "Removed by you: duplicate refund" in texts
    actions = [a["action"] for a in detail["admin_actions"]]
    assert actions.count("admin.credits.remove") == 3 and "admin.credits" in actions


# ---- suspend, sign out ---------------------------------------------------------------------------------------


def test_a_suspended_account_cant_sign_in_or_use_the_api_and_is_told_why(console: Any) -> None:
    from orbit_api.auth.security import create_access_token, issue_ticket

    client, admin, admin_user = console
    h, user = _user(client, "susp")
    uid = user["id"]
    sid = client.post("/v1/sessions", headers=h, json={"title": "live one"}).json()["id"]
    assert client.post(f"/v1/admin/users/{uid}/suspend", headers=admin, json={"reason": "no"}).status_code == 422
    with _live(client, h, sid) as live:
        _collect(live, lambda ev: any(e["type"] == "session.started" for e in ev))
        r = client.post(f"/v1/admin/users/{uid}/suspend", headers=admin, json={"reason": "Shared the account"})
        assert r.status_code == 200, r.text
        assert r.json()["suspended_at"] and r.json()["suspended_reason"] == "Shared the account"
        _collect(live, lambda ev: any(e["type"] == "session.ended" for e in ev))  # its live session stopped
        assert _close_code(live) == 4009
    assert client.get(f"/v1/sessions/{sid}", headers=admin).status_code == 404  # (not the admin's)

    # Signed out everywhere; signing in again is refused with the reason, only for the right password.
    assert client.get("/v1/auth/me", headers=h).status_code == 401
    assert _login(client, user["email"], "wrong password!!").status_code == 401
    refused = _login(client, user["email"])
    assert refused.status_code == 403
    detail = refused.json()["detail"]
    assert detail["code"] == "account_suspended" and "Reason: Shared the account. If you" in detail["message"]
    assert admin_user["email"] not in detail["message"]  # the admin's address isn't handed out
    mail = next(m for m in reversed(_outbox().sent) if m.to == user["email"])
    assert mail.subject == "Your Orbit account is suspended" and "Shared the account" in mail.text

    # Anything minted meanwhile is refused too: the API, the live socket, a reset link.
    async def version(db: Any) -> int:
        u = await db.get(User, uid)
        return int(u.token_version)

    fresh = {"Authorization": f"Bearer {create_access_token(uid, _db(client, version))}"}
    blocked = client.get("/v1/documents", headers=fresh)
    assert blocked.status_code == 403 and blocked.json()["detail"]["code"] == "account_suspended"
    from starlette.websockets import WebSocketDisconnect

    try:
        with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={issue_ticket(uid, sid)}") as ws:
            ws.receive_text()
        raise AssertionError("suspended account went live")
    except WebSocketDisconnect as e:
        assert e.code == 4001
    assert client.post(f"/v1/admin/users/{uid}/password-reset", headers=admin).status_code == 202
    token = re.search(r"token=([\w-]+)", next(m for m in reversed(_outbox().sent) if m.to == user["email"]).text)
    assert token
    reset = client.post("/v1/auth/password-reset/confirm", json={"token": token.group(1),
                                                                  "password": "a brand new phrase 9"})
    assert reset.status_code == 403 and reset.json()["detail"]["code"] == "account_suspended"

    listed = client.get("/v1/admin/users?only=suspended", headers=admin).json()["users"]
    assert uid in [u["id"] for u in listed]
    # Unsuspended: the old password works again.
    assert client.post(f"/v1/admin/users/{uid}/unsuspend", headers=admin).json()["suspended_at"] is None
    again = client.post(f"/v1/admin/users/{uid}/unsuspend", headers=admin)  # already active: nothing changes
    assert again.status_code == 200 and again.json()["suspended_at"] is None
    assert _login(client, user["email"]).status_code == 200
    events = [e["action"] for e in client.get(f"/v1/admin/users/{uid}", headers=admin).json()["events"]]
    assert "auth.login_suspended" in events
    actions = [a["action"] for a in client.get(f"/v1/admin/users/{uid}", headers=admin).json()["admin_actions"]]
    assert actions[:3] == ["admin.user.unsuspend", "admin.user.password_reset", "admin.user.suspend"]


def test_sign_out_everywhere_from_the_console(console: Any) -> None:
    client, admin, _ = console
    h, user = _user(client, "signout")
    other_device = {"Authorization": f"Bearer {_login(client, user['email']).json()['access_token']}"}
    assert client.get("/v1/auth/me", headers=other_device).status_code == 200
    r = client.post(f"/v1/admin/users/{user['id']}/sign-out", headers=admin)
    assert r.status_code == 200, r.text
    assert client.get("/v1/auth/me", headers=h).status_code == 401
    assert client.get("/v1/auth/me", headers=other_device).status_code == 401
    assert _login(client, user["email"]).status_code == 200  # the password still works
    audit = client.get(f"/v1/admin/audit?user_id={user['id']}&action=admin.user.sign_out", headers=admin).json()
    assert audit["total"] == 1 and audit["items"][0]["subject_email"] == user["email"]


# ---- one account in full, edits, notes, reset ----------------------------------------------------------------


def test_an_account_in_full_with_edits_notes_and_a_reset_email(console: Any) -> None:
    client, admin, admin_user = console
    h, user = _user(client, "detail")
    uid = user["id"]
    _doc(client, h, "resume_sample")
    client.post("/v1/resumes", headers=h, json={"title": "Mine"})
    client.post("/v1/sessions", headers=h, json={"title": "loop"})
    d = client.get(f"/v1/admin/users/{uid}", headers=admin).json()
    assert d["is_you"] is False and d["is_admin_account"] is False
    c = d["counts"]
    assert (c["documents"], c["resumes"], c["sessions"], c["sessions_open"], c["jobs_tracked"]) == (1, 1, 1, 1, 0)
    assert d["user"]["email"] == user["email"] and d["user"]["has_note"] is False
    assert d["sessions"][0]["type"] == "interview" and "title" not in d["sessions"][0]  # never the account's content
    assert any(e["reason"] == "welcome" for e in d["ledger"])
    assert d["events"][0]["action"] == "auth.register"

    r = client.patch(f"/v1/admin/users/{uid}", headers=admin,
                     json={"name": "  Asha   K ", "email_verified": True, "admin_note": "Paid in cash, 3 Oct"})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["user"]["name"] == "Asha K" and d["user"]["email_verified"] is True and d["user"]["has_note"] is True
    assert d["admin_note"] == "Paid in cash, 3 Oct"
    assert client.patch(f"/v1/admin/users/{uid}", headers=admin, json={}).status_code == 422
    assert client.patch(f"/v1/admin/users/{uid}", headers=admin, json={"admin_note": "x" * 4001}).status_code == 422
    # The note is the admin's: not in the account's own data export.
    export = client.get("/v1/auth/me/export", headers=h).json()
    assert "admin_note" not in export["account"] and export["account"]["name"] == "Asha K"
    assert "Paid in cash" not in json.dumps(export, default=str)

    # The usual reset email, once a minute at most.
    sent = client.post(f"/v1/admin/users/{uid}/password-reset", headers=admin)
    assert sent.status_code == 202 and user["email"] in sent.json()["message"]
    mail = next(m for m in reversed(_outbox().sent) if m.to == user["email"])
    assert mail.subject == "Reset your Orbit password" and "/reset-password?token=" in mail.text
    assert client.post(f"/v1/admin/users/{uid}/password-reset", headers=admin).status_code == 429
    actions = [a["action"] for a in client.get(f"/v1/admin/users/{uid}", headers=admin).json()["admin_actions"]]
    assert actions == ["admin.user.password_reset", "admin.user.update"]
    assert client.get("/v1/admin/users/nope", headers=admin).status_code == 404
    assert client.get(f"/v1/admin/users/{admin_user['id']}", headers=admin).json()["is_admin_account"] is True


def test_bulk_credits_skip_the_admin_and_unknown_accounts(console: Any) -> None:
    client, admin, admin_user = console
    (ha, a), (hb, b) = _user(client, "bulk"), _user(client, "bulk")
    r = client.post("/v1/admin/users/bulk-credits", headers=admin, json={
        "user_ids": [a["id"], b["id"], b["id"], admin_user["id"], "missing"], "resume": 3, "interview_minutes": 10,
        "note": "launch week"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["given"] == 2 and {(s["id"], s["why"]) for s in out["skipped"]} == {
        (admin_user["id"], "the admin account"), ("missing", "not found")}
    for h in (ha, hb):
        wallet = client.get("/v1/entitlements", headers=h).json()["credits"]
        assert wallet["resume"] == 4 and wallet["interview_minutes_left"] == 30
    assert client.post("/v1/admin/users/bulk-credits", headers=admin,
                       json={"user_ids": [a["id"]]}).status_code == 422
    assert client.post("/v1/admin/users/bulk-credits", headers=admin,
                       json={"user_ids": [str(i) for i in range(101)], "resume": 1}).status_code == 422
    assert client.post("/v1/admin/users/bulk-credits", headers=admin,
                       json={"user_ids": [a["id"]], "resume": 1001}).status_code == 422
    logged = client.get(f"/v1/admin/audit?user_id={a['id']}", headers=admin).json()["items"]
    assert [i["target"].endswith("(bulk)") for i in logged] == [True]


# ---- the list: filters, sort, pages, CSV ---------------------------------------------------------------------


def test_the_list_filters_sorts_pages_and_exports(console: Any) -> None:
    client, admin, _ = console
    tag = uuid.uuid4().hex[:10]
    made: dict[str, tuple[dict[str, str], dict[str, Any]]] = {
        k: _register_named(client, f"{tag}-{k}@example.com") for k in ("paid", "active", "idle", "susp")}
    _approved_payment(client, admin, made["paid"][0])
    _add_usage(made["active"][1]["id"], "live_seconds", 5 * 60)
    client.post(f"/v1/admin/users/{made['susp'][1]['id']}/suspend", headers=admin, json={"reason": "spam"})
    client.patch(f"/v1/admin/users/{made['idle'][1]['id']}", headers=admin, json={"name": "=HYPERLINK(\"x\")"})

    def ids(**params: Any) -> list[str]:
        r = client.get("/v1/admin/users", headers=admin, params={"q": tag, **params})
        assert r.status_code == 200, r.text
        return [u["email"].split("@")[0].split("-", 1)[1] for u in r.json()["users"]]

    assert sorted(ids()) == ["active", "idle", "paid", "susp"]
    assert ids(only="paid") == ["paid"]
    assert ids(only="active") == ["active"]
    assert sorted(ids(only="never_used")) == ["idle", "paid", "susp"]
    assert ids(only="suspended") == ["susp"]
    assert ids(sort="paid")[0] == "paid"
    assert ids(sort="minutes")[0] == "active"
    assert ids(sort="email", order="asc") == ["active", "idle", "paid", "susp"]
    assert ids(sort="last_active")[0] == "active"
    assert ids(sort="created", order="asc") == ["paid", "active", "idle", "susp"]
    first = client.get("/v1/admin/users", headers=admin,
                       params={"q": tag, "sort": "email", "order": "asc", "limit": 3}).json()
    assert (first["total"], first["has_more"], len(first["users"])) == (4, True, 3) and first["totals"]
    rest = client.get("/v1/admin/users", headers=admin,
                      params={"q": tag, "sort": "email", "order": "asc", "limit": 3, "offset": 3}).json()
    assert [u["email"] for u in rest["users"]] == [f"{tag}-susp@example.com"]
    assert rest["has_more"] is False and rest["totals"] is None
    for bad in ({"only": "everyone"}, {"sort": "password"}, {"limit": 501}, {"offset": -1}, {"q": "x" * 121}):
        assert client.get("/v1/admin/users", headers=admin, params=bad).status_code == 422, bad

    r = client.get("/v1/admin/users/export", headers=admin, params={"q": tag, "sort": "email", "order": "asc"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0][:3] == ["id", "email", "name"] and len(rows) == 5
    by_email = {row[1]: dict(zip(rows[0], row, strict=True)) for row in rows[1:]}
    assert by_email[f"{tag}-idle@example.com"]["name"] == "'=HYPERLINK(\"x\")"  # not a formula in a spreadsheet
    assert by_email[f"{tag}-paid@example.com"]["paid_inr"] != "0"
    assert by_email[f"{tag}-susp@example.com"]["suspended"]
    paid_only = client.get("/v1/admin/users/export", headers=admin, params={"q": tag, "only": "paid"})
    assert len(list(csv.reader(io.StringIO(paid_only.content.decode("utf-8-sig"))))) == 2
    logged = client.get("/v1/admin/audit?action=admin.users.export", headers=admin).json()["items"]
    assert logged and logged[0]["target"].startswith("1 accounts · paid")

    # The pending filter is still what the header badge counts.
    assert client.get("/v1/admin/users?only=pending", headers=admin).json()["users"] == []


# ---- the audit log, the dashboard, the announcement ----------------------------------------------------------


def test_the_audit_log_filters_by_action_account_and_search(console: Any) -> None:
    client, admin, admin_user = console
    _, user = _user(client, "audit")
    client.post(f"/v1/admin/users/{user['id']}/credits", headers=admin, json={"resume": 1})
    client.post(f"/v1/admin/users/{user['id']}/suspend", headers=admin, json={"reason": "testing it"})
    page = client.get("/v1/admin/audit", headers=admin).json()
    assert all(i["action"].startswith("admin.") for i in page["items"])
    assert {"admin.credits", "admin.user.suspend"} <= set(page["actions"])
    top = page["items"][0]
    assert top["action"] == "admin.user.suspend" and top["actor_email"] == admin_user["email"]
    assert top["subject_id"] == user["id"] and top["subject_email"] == user["email"]
    mine = client.get(f"/v1/admin/audit?user_id={user['id']}", headers=admin).json()
    assert [i["action"] for i in mine["items"]] == ["admin.user.suspend", "admin.credits"]
    everything = client.get(f"/v1/admin/audit?scope=all&user_id={user['id']}", headers=admin).json()
    assert "auth.register" in [i["action"] for i in everything["items"]]
    by_email = client.get(f"/v1/admin/audit?q={user['email']}", headers=admin).json()
    assert by_email["total"] == 2
    paged = client.get("/v1/admin/audit?limit=1", headers=admin).json()
    assert len(paged["items"]) == 1 and paged["has_more"] is True
    for bad in ("action=DROP%20TABLE", "limit=201", "scope=everyone", f"user_id={'x' * 37}"):
        assert client.get(f"/v1/admin/audit?{bad}", headers=admin).status_code == 422, bad


def test_the_dashboard_counts_days_in_the_admins_time_zone(console: Any) -> None:
    client, admin, _ = console
    _, user = _user(client, "stats")
    _add_usage(user["id"], "mock_seconds", 90)
    s = client.get("/v1/admin/stats?days=30&tz_offset=330", headers=admin).json()
    assert len(s["signups"]) == 30 and len(s["interview_minutes"]) == 30
    today = (datetime.now(UTC) + timedelta(minutes=330)).date().isoformat()
    assert s["signups"][-1]["day"] == today and s["signups"][-1]["value"] >= 1
    assert s["interview_minutes"][-1]["value"] >= 1.5
    assert s["users"] >= 2 and s["active_7d"] >= 1 and s["active_30d"] >= s["active_7d"]
    assert s["interview_minutes_month"] >= 1.5
    for bad in ("days=6", "days=91", "tz_offset=841", "tz_offset=-721"):
        assert client.get(f"/v1/admin/stats?{bad}", headers=admin).status_code == 422, bad


def test_the_announcement_banner(console: Any) -> None:
    client, admin, _ = console
    h, _ = _user(client, "banner")
    r = client.put("/v1/admin/config", headers=admin,
                   json={"announcement": "  Maintenance\n tonight at 10 pm IST ", "announcement_tone": "warning"})
    assert r.status_code == 200, r.text
    assert r.json()["announcement"] == "Maintenance tonight at 10 pm IST"
    shown = client.get("/v1/announcement").json()  # public: the banner needs no session
    assert shown["text"] == "Maintenance tonight at 10 pm IST" and shown["tone"] == "warning" and shown["id"]
    assert client.put("/v1/admin/config", headers=admin, json={"announcement": "x" * 301}).status_code == 422
    assert client.put("/v1/admin/config", headers=admin, json={"announcement_tone": "red"}).status_code == 422
    assert client.put("/v1/admin/config", headers=h, json={"announcement": "hi"}).status_code == 403
    assert client.put("/v1/admin/config", headers=admin, json={"announcement": ""}).status_code == 200
    assert client.get("/v1/announcement").json()["text"] is None
    logged = client.get("/v1/admin/audit?action=admin.config", headers=admin).json()["items"]
    assert logged[0]["target"] == "announcement" and "Maintenance" not in json.dumps(logged)
    client.put("/v1/admin/config", headers=admin, json={"announcement_tone": "info"})


def test_the_migration_adds_and_removes_the_console_columns(tmp_path: Any) -> None:
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    db = tmp_path / "console.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}
    api = Path(__file__).parents[1]

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    def columns(table: str) -> set[str]:
        with sqlite3.connect(db) as conn:
            return {r[1] for r in conn.execute(f"pragma table_info({table})")}

    alembic("upgrade", "head")
    assert {"suspended_at", "suspended_reason", "admin_note"} <= columns("users")
    assert "note" in columns("credit_entries")
    alembic("downgrade", "-1")
    assert not {"suspended_at", "suspended_reason", "admin_note"} & columns("users")
    assert "note" not in columns("credit_entries") and "email_hash" in columns("credit_entries")
    alembic("upgrade", "head")
    assert "admin_note" in columns("users")


def test_session_rows_stop_when_suspended_even_without_a_socket(console: Any) -> None:
    """A session left "live" by a dropped connection can't be continued once the account is suspended."""
    client, admin, _ = console
    h, user = _user(client, "dropped")
    sid = client.post("/v1/sessions", headers=h, json={"title": "dropped"}).json()["id"]
    with _live(client, h, sid) as live:
        _collect(live, lambda ev: any(e["type"] == "session.started" for e in ev))
    assert client.post(f"/v1/admin/users/{user['id']}/suspend", headers=admin,
                       json={"reason": "abuse"}).status_code == 200

    async def row(db: Any) -> Any:
        return await db.get(LiveSessionRow, sid)

    ended = _db(client, row)
    assert ended.status == "ended" and ended.carryover is None  # nothing left to reconnect to
    assert ended.ended_at is not None
