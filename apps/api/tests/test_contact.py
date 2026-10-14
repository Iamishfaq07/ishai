"""The Contact page and the admin's Inbox: a public form (signed in or out) whose messages wait in the admin console,
with no email sent when one arrives; validation, the honeypot, rate limits, the bot check, plain text only; the
Inbox's list, filters and counts, opening (marks read), status and notes, replying from Orbit (Reply-To the admin),
deleting; admin only; account deletion keeps the message without the link; retention; the migration."""

import json
import re
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import select

from orbit_api import ratelimit
from orbit_api.admin import inbox as inbox_mod
from orbit_api.config import get_settings
from orbit_api.contact import routes as contact_mod
from orbit_api.models import AuditLog, ContactMessage
from tests.test_admin_console import _db
from tests.test_security_idor import _insert_listing
from tests.test_signup_approval import _client, _outbox
from tests.test_signup_approval import _register as _register_named

PROXY = "proxy-secret-for-contact-tests-" + "z" * 8


@pytest.fixture
def inbox(monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[TestClient, dict[str, str], dict[str, Any]]]:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    admin, admin_user = _register_named(client, admin_email)
    yield client, admin, admin_user
    gen.close()


def _tag() -> str:
    return f"zq{uuid.uuid4().hex[:10]}"


def _msg(tag: str, **over: Any) -> dict[str, Any]:
    return {"name": "Asha Rao", "email": f"asha-{tag}@example.com", "topic": "payment",
            "message": f"I paid for the Mini pack but the credits haven't arrived. {tag}", **over}


def _send(client: TestClient, body: dict[str, Any], headers: dict[str, str] | None = None) -> Any:
    client.cookies.clear()
    return client.post("/v1/contact", json=body, headers=headers or {})


def _find(client: TestClient, admin: dict[str, str], tag: str, **params: Any) -> list[dict[str, Any]]:
    r = client.get("/v1/admin/inbox", headers=admin, params={"q": tag, "status": "all", **params})
    assert r.status_code == 200, r.text
    return list(r.json()["items"])


def _row(client: TestClient, message_id: str) -> ContactMessage | None:
    async def go(db: Any) -> ContactMessage | None:
        return await db.get(ContactMessage, message_id)

    return _db(client, go)  # type: ignore[no-any-return]


# ---- sending ----------------------------------------------------------------------------------------------------


def test_a_signed_out_message_waits_in_the_inbox_and_emails_nobody(inbox: Any) -> None:
    client, admin, _ = inbox
    tag = _tag()
    sent_before = len(_outbox().sent)
    r = _send(client, _msg(tag, phone="+91 98765 43210"))
    assert r.status_code == 201, r.text
    ref = r.json()["reference"]
    assert r.json()["status"] == "received" and re.fullmatch(r"C-[0-9A-F]{8}", ref)
    [item] = _find(client, admin, tag)
    assert item["reference"] == ref and item["status"] == "new" and item["user_id"] is None
    assert item["topic"] == "payment" and item["topic_label"] == "Payment or credits"
    assert item["name"] == "Asha Rao" and tag in item["snippet"]
    # The Inbox is the only place it goes: no email to the admin (or anyone) for a new message.
    assert len(_outbox().sent) == sent_before
    row = _row(client, item["id"])
    assert row is not None and row.phone == "+91 98765 43210" and row.network_hash and len(row.network_hash) == 64
    assert row.context is None


def test_signed_in_the_account_is_linked_and_nothing_is_copied_from_it(inbox: Any) -> None:
    client, admin, _ = inbox
    h, user = _register_named(client, f"sender-{uuid.uuid4().hex[:8]}@example.com")
    tag = _tag()
    r = _send(client, _msg(tag, name="Someone Else", email=f"other-{tag}@example.com"), headers=h)
    assert r.status_code == 201, r.text
    [item] = _find(client, admin, tag)
    assert item["user_id"] == user["id"]
    detail = client.get(f"/v1/admin/inbox/{item['id']}", headers=admin).json()
    assert detail["name"] == "Someone Else" and detail["email"] == f"other-{tag}@example.com"  # as typed
    assert detail["account"] == {"id": user["id"], "email": user["email"], "name": "Ana"}


def test_a_stale_or_suspended_session_is_simply_signed_out_here(inbox: Any) -> None:
    client, admin, _ = inbox
    tag = _tag()
    r = _send(client, _msg(tag), headers={"Authorization": "Bearer not.a.token"})
    assert r.status_code == 201
    assert _find(client, admin, tag)[0]["user_id"] is None


@pytest.mark.parametrize(("patch", "why"), [
    ({"name": "   "}, "blank name"),
    ({"name": "x" * 121}, "long name"),
    ({"message": "too short"}, "9 characters"),
    ({"message": "x" * 3001}, "too long"),
    ({"message": "  \n\n  hi  \n\n\n  "}, "short once trimmed"),
    ({"email": "not-an-email"}, "bad email"),
    ({"email": "a@example.com\r\nBcc: victim@example.com"}, "header in the email"),
    ({"topic": "sales"}, "unknown topic"),
    ({"phone": "call me maybe"}, "not a phone"),
    ({"phone": "12345"}, "too few digits"),
    ({"context": {"listing_id": "j1", "admin": True}}, "unknown context key"),
    ({"context": {"listing_title": "x" * 301}}, "long context"),
    ({"website": "x" * 501}, "long honeypot"),
])
def test_tight_bounds_refuse_bad_input(inbox: Any, patch: dict[str, Any], why: str) -> None:
    client, admin, _ = inbox
    tag = _tag()
    r = _send(client, {**_msg(tag), **patch})
    assert r.status_code == 422, (why, r.status_code, r.text)
    assert _find(client, admin, tag) == []


def test_everything_is_plain_text_and_nothing_typed_can_inject_lines(inbox: Any) -> None:
    client, admin, admin_user = inbox
    tag = _tag()
    r = _send(client, _msg(tag, name="Eve\r\nBcc: victim@example.com X-Evil: 1",
                           message=f"Line one {tag}\r\nLine two\x00\x1b[31m red\r\n\r\n\r\n\r\nafter gaps   ",
                           context={"listing_url": "javascript:alert(1)", "page": "//evil.example/x",
                                    "reason": "Asked\nme to pay"}))
    assert r.status_code == 201, r.text
    [item] = _find(client, admin, tag)
    detail = client.get(f"/v1/admin/inbox/{item['id']}", headers=admin).json()
    assert detail["name"] == "Eve Bcc: victim@example.com X-Evil: 1"  # one line
    assert detail["message"] == f"Line one {tag}\nLine two[31m red\n\nafter gaps"
    assert detail["context"] == {"reason": "Asked me to pay"}  # a non-http link and a foreign page are dropped
    # The reply's headers carry nothing anyone typed: the validated address, a subject from the topic list.
    mail = inbox_mod.reply_email(_row(client, item["id"]), "Thanks, looking into it.", admin_user["email"])  # type: ignore[arg-type]
    assert mail.to == item["email"] and mail.reply_to == admin_user["email"]
    assert mail.subject == f"Re: Payment or credits ({item['reference']})"
    assert "\n" not in mail.subject and "\r" not in mail.subject and "Eve" not in mail.subject


def test_the_honeypot_looks_like_success_and_keeps_nothing(inbox: Any) -> None:
    client, admin, _ = inbox
    tag = _tag()
    r = _send(client, _msg(tag, website="https://cheap-seo.example"))
    assert r.status_code == 201 and re.fullmatch(r"C-[0-9A-F]{8}", r.json()["reference"])
    assert _find(client, admin, tag) == []


def test_a_reported_job_takes_its_details_from_the_job_cache(inbox: Any) -> None:
    client, admin, _ = inbox
    listing = _insert_listing(client)
    tag = _tag()
    r = _send(client, _msg(tag, topic="report_job", context={
        "listing_id": listing, "listing_title": "Totally Real Job", "listing_url": "https://phish.example",
        "reason": "Asked me to pay a fee", "page": f"/jobs/listing/{listing}"}))
    assert r.status_code == 201, r.text
    [item] = _find(client, admin, tag, topic="report_job")
    assert item["listing_title"] == "Staff Engineer"
    ctx = client.get(f"/v1/admin/inbox/{item['id']}", headers=admin).json()["context"]
    assert ctx == {"listing_id": listing, "listing_title": "Staff Engineer", "listing_company": "Acme",
                   "listing_url": "https://example.com/jobs/staff", "reason": "Asked me to pay a fee",
                   "page": f"/jobs/listing/{listing}"}
    # An id that isn't in the cache keeps what the page said (a link only if it's http(s)).
    tag2 = _tag()
    _send(client, _msg(tag2, topic="report_job", context={"listing_id": "jgone", "listing_title": "Old post",
                                                          "listing_url": "https://jobs.example/1"}))
    [gone] = _find(client, admin, tag2)
    assert gone["listing_title"] == "Old post"


# ---- spam protection --------------------------------------------------------------------------------------------


@pytest.fixture
def limits(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    ratelimit.reset_all()
    monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr(PROXY))
    yield
    ratelimit.reset_all()


def _via(ip: str) -> dict[str, str]:
    return {"X-Orbit-Proxy-Secret": PROXY, "X-Orbit-Client-IP": ip}


def test_five_an_hour_and_twenty_a_day_per_network(inbox: Any, limits: None, monkeypatch: pytest.MonkeyPatch) -> None:
    client, _, _ = inbox
    codes = [_send(client, _msg(_tag()), headers=_via("100.70.1.1")).status_code for _ in range(6)]
    assert codes == [201] * 5 + [429], codes
    slow = _send(client, _msg(_tag()), headers=_via("100.70.1.1"))
    assert slow.status_code == 429 and "wait" in slow.json()["detail"]
    assert _send(client, _msg(_tag()), headers=_via("100.70.1.2")).status_code == 201  # per network
    # IPv6: one /64 is one network.
    v6 = [_send(client, _msg(_tag()), headers=_via(f"2001:db8:7:1::{i}")).status_code for i in range(1, 7)]
    assert v6 == [201] * 5 + [429], v6
    # The day's 20, with the hourly bucket out of the way.
    monkeypatch.setattr(contact_mod, "_per_hour", ratelimit.TokenBucket(rate_per_s=1, burst=1000))
    day = [_send(client, _msg(_tag()), headers=_via("100.70.1.3")).status_code for _ in range(21)]
    assert day == [201] * 20 + [429], day
    assert "tomorrow" in _send(client, _msg(_tag()), headers=_via("100.70.1.3")).json()["detail"]


def test_a_daily_cap_for_everyone_together(inbox: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    client, _, _ = inbox

    async def today(db: Any) -> int:
        from sqlalchemy import func

        since = datetime.now(UTC) - timedelta(days=1)
        return int(await db.scalar(select(func.count()).select_from(ContactMessage).where(
            ContactMessage.created_at >= since)) or 0)

    monkeypatch.setattr(get_settings(), "contact_daily_cap", _db(client, today) + 1)
    assert _send(client, _msg(_tag())).status_code == 201
    busy = _send(client, _msg(_tag()))
    assert busy.status_code == 429 and "busy" in busy.json()["detail"]


def test_the_bot_check_applies_to_signed_out_senders_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.auth import captcha

    async def fake_verify(token: str, ip: str | None) -> bool:
        return token == "good-token"

    monkeypatch.setattr(captcha, "_verify_turnstile", fake_verify)
    gen = _client(monkeypatch, ORBIT_CAPTCHA_PROVIDER="turnstile", TURNSTILE_SITE_KEY="k", TURNSTILE_SECRET_KEY="s")
    client = next(gen)
    try:
        no = _send(client, _msg(_tag()))
        assert no.status_code == 400 and no.json()["detail"]["code"] == "captcha_failed"
        assert _send(client, _msg(_tag(), captcha_token="bad")).status_code == 400
        assert _send(client, _msg(_tag(), captcha_token="good-token")).status_code == 201
    finally:
        gen.close()


def test_the_bot_check_is_skipped_for_a_signed_in_account(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.auth import captcha

    async def fake_verify(token: str, ip: str | None) -> bool:
        return token == "good-token"

    monkeypatch.setattr(captcha, "_verify_turnstile", fake_verify)
    gen = _client(monkeypatch, ORBIT_CAPTCHA_PROVIDER="turnstile", TURNSTILE_SITE_KEY="k", TURNSTILE_SECRET_KEY="s")
    client = next(gen)
    try:
        r = client.post("/v1/auth/register", json={"email": f"cap-{uuid.uuid4().hex[:8]}@example.com",
                                                   "password": "correct horse battery", "captcha_token": "good-token"})
        assert r.status_code == 201, r.text
        client.cookies.clear()
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}
        assert _send(client, _msg(_tag()), headers=h).status_code == 201
    finally:
        gen.close()


# ---- the Inbox --------------------------------------------------------------------------------------------------


def test_the_list_filters_searches_pages_and_counts(inbox: Any) -> None:
    client, admin, _ = inbox
    tag = _tag()
    for topic in ("payment", "technical", "technical"):
        assert _send(client, _msg(tag, topic=topic)).status_code == 201
    assert len(_find(client, admin, tag)) == 3
    assert len(_find(client, admin, tag, topic="technical")) == 2
    todo = client.get("/v1/admin/inbox", headers=admin, params={"q": tag}).json()  # default: new and open
    assert todo["total"] == 3 and all(i["status"] == "new" for i in todo["items"])
    counts = todo["counts"]
    assert counts["new"] >= 3 and counts["todo"] == counts["new"] + counts["open"]
    assert counts["all"] == counts["new"] + counts["open"] + counts["done"] + counts["spam"]
    first = client.get("/v1/admin/inbox", headers=admin, params={"q": tag, "limit": 2}).json()
    assert (len(first["items"]), first["has_more"], first["total"]) == (2, True, 3)
    rest = client.get("/v1/admin/inbox", headers=admin, params={"q": tag, "limit": 2, "offset": 2}).json()
    assert len(rest["items"]) == 1 and rest["has_more"] is False
    newest = first["items"][0]
    assert newest["created_at"] >= first["items"][1]["created_at"]  # newest first
    # By reference, with or without the "C-".
    ref = newest["reference"]
    assert [i["id"] for i in _find(client, admin, ref)] == [newest["id"]]
    assert [i["id"] for i in _find(client, admin, ref[2:].lower())] == [newest["id"]]
    # By email, phone, name; SQL wildcards are plain text.
    assert len(_find(client, admin, f"asha-{tag}@example")) == 3
    assert _find(client, admin, "%") == [] and _find(client, admin, "_") == []  # wildcards are plain text
    for bad in ({"status": "unread"}, {"topic": "sales"}, {"limit": 201}, {"offset": -1}, {"q": "x" * 121}):
        assert client.get("/v1/admin/inbox", headers=admin, params=bad).status_code == 422, bad


def test_opening_marks_read_and_status_and_notes_are_audited(inbox: Any) -> None:
    client, admin, _ = inbox
    h, user = _register_named(client, f"sender-{uuid.uuid4().hex[:8]}@example.com")
    tag = _tag()
    _send(client, _msg(tag), headers=h)
    [item] = _find(client, admin, tag)
    mid = item["id"]
    unread = client.get("/v1/admin/inbox", headers=admin, params={"status": "new", "limit": 1}).json()["counts"]["new"]

    opened = client.get(f"/v1/admin/inbox/{mid}", headers=admin).json()
    assert opened["status"] == "open" and opened["read_at"] and opened["handled_at"] is None
    assert opened["same_network_30d"] >= 1 and opened["can_reply"] is True
    after = client.get("/v1/admin/inbox", headers=admin, params={"status": "new", "limit": 1}).json()["counts"]["new"]
    assert after == unread - 1
    assert client.get(f"/v1/admin/inbox/{mid}", headers=admin).json()["read_at"] == opened["read_at"]  # once

    def patch(body: dict[str, Any]) -> Any:
        return client.patch(f"/v1/admin/inbox/{mid}", headers=admin, json=body)

    done = patch({"status": "done", "admin_note": "  Refunded by UPI, 8 Oct  "}).json()
    assert done["status"] == "done" and done["handled_at"] and done["admin_note"] == "Refunded by UPI, 8 Oct"
    assert patch({"status": "spam"}).json()["status"] == "spam"
    reopened = patch({"status": "open"}).json()
    assert reopened["status"] == "open" and reopened["handled_at"] is None and reopened["read_at"]
    unread_again = patch({"status": "new"}).json()
    assert unread_again["status"] == "new" and unread_again["read_at"] is None
    assert patch({"admin_note": ""}).json()["admin_note"] is None
    assert patch({}).status_code == 422
    assert patch({"admin_note": "x" * 2001}).status_code == 422
    assert patch({"status": "archived"}).status_code == 422
    assert client.get("/v1/admin/inbox/nope", headers=admin).status_code == 404
    assert client.patch("/v1/admin/inbox/nope", headers=admin, json={"status": "done"}).status_code == 404

    # Each change is audited (opening isn't), and shows as about the sender's account.
    log = client.get(f"/v1/admin/audit?user_id={user['id']}", headers=admin).json()["items"]
    assert [i["action"] for i in log] == ["admin.contact.update"] * 5
    assert log[-1]["target"] == f"{mid} done,note" and log[0]["target"] == f"{mid} note"
    assert {i["subject_id"] for i in log} == {user["id"]} and log[0]["subject_email"] == user["email"]
    detail = client.get(f"/v1/admin/users/{user['id']}", headers=admin).json()
    assert "admin.contact.update" in [a["action"] for a in detail["admin_actions"]]


def test_a_reply_goes_from_orbit_with_reply_to_the_admin_and_closes_the_message(
        inbox: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    client, admin, admin_user = inbox
    tag = _tag()
    _send(client, _msg(tag, message=f"Where are my credits? {tag}\nUTR 123456789012"))
    [item] = _find(client, admin, tag)
    mid = item["id"]
    url = f"/v1/admin/inbox/{mid}/reply"
    assert client.post(url, headers=admin, json={"text": " "}).status_code == 422
    assert client.post(url, headers=admin, json={"text": "x" * 5001}).status_code == 422

    r = client.post(url, headers=admin, json={"text": "Hi Asha,\n\nThey're on your account now.\n"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "done" and out["handled_at"]
    assert [(x["by"], x["text"]) for x in out["replies"]] == [(admin_user["email"], "Hi Asha,\n\nThey're on your "
                                                                                    "account now.")]
    mail = next(m for m in reversed(_outbox().sent) if m.to == f"asha-{tag}@example.com")
    assert mail.reply_to == admin_user["email"]
    assert mail.subject == f"Re: Payment or credits ({item['reference']})"
    assert mail.text.startswith("Hi Asha,\n\nThey're on your account now.")
    assert f"> Where are my credits? {tag}\n> UTR 123456789012" in mail.text
    # The dev outbox file says where the reply goes, too.
    from orbit_api.providers.email import dev_outbox_path

    assert f"to=asha-{tag}@example.com reply_to={admin_user['email']}" in dev_outbox_path().read_text(encoding="utf-8")
    logged = client.get("/v1/admin/audit?action=admin.contact.reply", headers=admin).json()["items"][0]
    assert logged["target"] == f"{mid} asha-{tag}@example.com"

    # A failed send shows, and nothing is kept; no SMTP at all: reply from your own mail app.
    monkeypatch.setattr(inbox_mod, "send_now", _never_sent)
    failed = client.post(url, headers=admin, json={"text": "Second try"})
    assert failed.status_code == 502 and len(client.get(f"/v1/admin/inbox/{mid}", headers=admin).json()["replies"]) == 1
    monkeypatch.setattr(inbox_mod, "can_deliver", lambda: False)
    no_smtp = client.post(url, headers=admin, json={"text": "Third try"})
    assert no_smtp.status_code == 409 and "mail app" in no_smtp.json()["detail"]
    assert client.get(f"/v1/admin/inbox/{mid}", headers=admin).json()["can_reply"] is False


async def _never_sent(_: Any) -> bool:
    return False


def test_deleting_a_message_keeps_the_email_in_the_audit_log(inbox: Any) -> None:
    client, admin, _ = inbox
    tag = _tag()
    _send(client, _msg(tag))
    [item] = _find(client, admin, tag)
    r = client.request("DELETE", f"/v1/admin/inbox/{item['id']}", headers=admin)
    assert r.status_code == 204
    assert client.get(f"/v1/admin/inbox/{item['id']}", headers=admin).status_code == 404
    assert client.request("DELETE", f"/v1/admin/inbox/{item['id']}", headers=admin).status_code == 404
    logged = client.get("/v1/admin/audit?action=admin.contact.delete", headers=admin).json()["items"][0]
    assert logged["target"] == f"{item['id']} asha-{tag}@example.com" and logged["subject_id"] is None


INBOX_ROUTES: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "/v1/admin/inbox", None),
    ("GET", "/v1/admin/inbox/{id}", None),
    ("PATCH", "/v1/admin/inbox/{id}", {"status": "done"}),
    ("POST", "/v1/admin/inbox/{id}/reply", {"text": "hello there"}),
    ("DELETE", "/v1/admin/inbox/{id}", None),
]


def test_the_inbox_is_admin_only(inbox: Any) -> None:
    client, admin, _ = inbox
    tag = _tag()
    _send(client, _msg(tag))
    [item] = _find(client, admin, tag)
    h, _ = _register_named(client, f"nosy-{uuid.uuid4().hex[:8]}@example.com")
    for method, path, body in INBOX_ROUTES:
        url = path.replace("{id}", item["id"])
        client.cookies.clear()
        r = client.request(method, url, headers=h, json=body)
        assert r.status_code == 403 and tag not in r.text, (method, path, r.status_code)
        assert client.request(method, url, json=body).status_code == 401, (method, path)
    after = client.get(f"/v1/admin/inbox/{item['id']}", headers=admin).json()
    assert after["replies"] == [] and after["status"] == "open"  # (opened just now by the admin)


# ---- account deletion, export, retention ------------------------------------------------------------------------


def test_deleting_the_account_keeps_its_messages_without_the_link_and_the_export_has_them(inbox: Any) -> None:
    client, admin, _ = inbox
    email = f"leaving-{uuid.uuid4().hex[:8]}@example.com"
    h, _ = _register_named(client, email)
    tag = _tag()
    _send(client, _msg(tag, email=email), headers=h)
    [item] = _find(client, admin, tag)
    client.patch(f"/v1/admin/inbox/{item['id']}", headers=admin, json={"admin_note": "VIP, reply fast"})

    export = client.get("/v1/auth/me/export", headers=h).json()
    [mine] = [m for m in export["contact_messages"] if m["id"] == item["id"]]
    assert tag in mine["message"] and mine["topic"] == "payment"
    assert "admin_note" not in mine and "network_hash" not in mine and "VIP" not in json.dumps(export)

    gone = client.request("DELETE", "/v1/auth/me", headers=h, json={"password": "correct horse battery"})
    assert gone.status_code == 204
    kept = client.get(f"/v1/admin/inbox/{item['id']}", headers=admin).json()
    assert kept["account"] is None and tag in kept["message"] and kept["email"] == email
    row = _row(client, item["id"])
    assert row is not None and row.user_id is None


def test_handled_messages_are_deleted_after_the_retention_period(inbox: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    client, _, _ = inbox
    now = datetime.now(UTC)
    old, recent = now - timedelta(days=400), now - timedelta(days=30)
    ids: dict[str, str] = {}

    async def seed(db: Any) -> None:
        for key, status, handled, created in [("done_old", "done", old, old), ("spam_old", "spam", old, old),
                                              ("done_recent", "done", recent, old), ("new_old", "new", None, old),
                                              ("open_old", "open", None, old), ("spam_unstamped", "spam", None, old)]:
            row = ContactMessage(name="x", email="x@example.com", topic="other", message="an old message",
                                 status=status, handled_at=handled, created_at=created)
            db.add(row)
            await db.flush()
            ids[key] = row.id
        await db.commit()

    _db(client, seed)
    monkeypatch.setattr(get_settings(), "contact_retention_days", 0)
    assert _db(client, lambda db: contact_mod.purge_expired(db)) == 0  # 0 = kept
    monkeypatch.setattr(get_settings(), "contact_retention_days", 365)
    assert _db(client, lambda db: contact_mod.purge_expired(db)) >= 3

    async def left(db: Any) -> set[str]:
        return set((await db.scalars(select(ContactMessage.id).where(ContactMessage.id.in_(ids.values())))).all())

    assert _db(client, left) == {ids["done_recent"], ids["new_old"], ids["open_old"]}
    assert client.portal.call(contact_mod.purge_expired_messages) == 0  # type: ignore[union-attr]


def test_no_audit_row_is_written_by_sending_or_opening(inbox: Any) -> None:
    client, admin, _ = inbox
    tag = _tag()
    _send(client, _msg(tag))
    [item] = _find(client, admin, tag)
    client.get(f"/v1/admin/inbox/{item['id']}", headers=admin)

    async def rows(db: Any) -> int:
        return len((await db.scalars(select(AuditLog).where(AuditLog.target.like(f"{item['id']}%")))).all())

    assert _db(client, rows) == 0


def test_the_migration_adds_and_removes_the_table(tmp_path: Any) -> None:
    import os
    import sqlite3
    import subprocess
    import sys
    from pathlib import Path

    db = tmp_path / "contact.db"
    env = {**os.environ, "ORBIT_DATABASE_URL": f"sqlite+aiosqlite:///{db.as_posix()}"}
    api = Path(__file__).parents[1]

    def alembic(*args: str) -> None:
        out = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=api, env=env, capture_output=True,
                             text=True, timeout=180)
        assert out.returncode == 0, out.stderr[-2000:]

    def tables() -> set[str]:
        with sqlite3.connect(db) as conn:
            return {r[0] for r in conn.execute("select name from sqlite_master where type='table'")}

    def columns() -> set[str]:
        with sqlite3.connect(db) as conn:
            return {r[1] for r in conn.execute("pragma table_info(contact_messages)")}

    alembic("upgrade", "head")
    assert "contact_messages" in tables()
    assert {"id", "created_at", "user_id", "name", "email", "phone", "topic", "message", "context", "status",
            "read_at", "handled_at", "admin_note", "replies", "network_hash", "source_support_thread_id"} == columns()
    with sqlite3.connect(db) as conn:
        fks = list(conn.execute("pragma foreign_key_list(contact_messages)"))
    # A support chat's ticket goes with its chat (c3e5a7b9d1f2).
    assert sorted((fk[2], fk[3], fk[6]) for fk in fks) == [("support_threads", "source_support_thread_id", "CASCADE"),
                                                         ("users", "user_id", "SET NULL")]
    alembic("downgrade", "f3a9c1e7b5d4")
    assert "contact_messages" not in tables() and "users" in tables()
    alembic("upgrade", "head")
    assert "contact_messages" in tables()


def test_the_topic_list_and_its_type_agree() -> None:
    from typing import get_args

    assert set(get_args(contact_mod.Topic)) == set(contact_mod.TOPICS)
    assert set(get_args(contact_mod.Status)) == set(contact_mod.STATUSES)
