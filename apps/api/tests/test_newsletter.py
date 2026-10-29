"""The weekly tips and offers email: opt-in only, at most once a week, true to the week, stoppable without sign-in."""
import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from orbit_api import newsletter
from orbit_api.config import get_settings
from orbit_api.providers.email import OutgoingEmail
from tests.test_email_flows import _outbox
from tests.test_job_alerts import _me, _verify
from tests.test_jobs import jobs, run  # noqa: F401  (the fixture)


def _mine(email: str) -> list[OutgoingEmail]:
    return [m for m in _outbox().sent if m.to == email and m.unsubscribe and "newsletter/off" in m.unsubscribe]


def _send(client: TestClient) -> int:
    out: list[int] = []

    async def go() -> None:
        out.append(await newsletter.send_due())
    run(client, go)
    return out[0]


def _signup(client: TestClient, **extra: object) -> dict[str, str]:
    r = client.post("/v1/auth/register", json={"email": f"n-{uuid.uuid4().hex[:8]}@example.com",
                                               "password": "correct horse battery", **extra})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_nobody_gets_it_without_choosing_it(jobs: TestClient) -> None:  # noqa: F811
    h = _signup(jobs)
    me = _me(jobs, h)
    _verify(jobs, me["id"])
    assert jobs.get("/v1/newsletter", headers=h).json() == {"subscribed": None}  # never asked
    _send(jobs)
    assert not _mine(me["email"])
    # An unticked sign-up box is a no (Today doesn't ask again).
    h2 = _signup(jobs, newsletter=False)
    assert jobs.get("/v1/newsletter", headers=h2).json() == {"subscribed": False}
    # Saying no is remembered (Today stops asking), and still sends nothing.
    assert jobs.put("/v1/newsletter", headers=h, json={"subscribed": False, "source": "today"}).json() == {
        "subscribed": False}
    _send(jobs)
    assert not _mine(me["email"])


def test_no_offer_line_when_no_offer_runs(jobs: TestClient) -> None:  # noqa: F811
    h = _signup(jobs, newsletter=True)
    me = _me(jobs, h)
    _verify(jobs, me["id"])
    _send(jobs)
    (m,) = _mine(me["email"])
    assert "FIRST10" not in m.text and "off your first pack" not in m.subject


def test_chosen_at_sign_up_sent_once_a_week_with_the_offer_and_stopped_by_link(
        jobs: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    monkeypatch.setattr(get_settings(), "first_purchase_percent", 10)
    h = _signup(jobs, newsletter=True)
    me = _me(jobs, h)
    assert jobs.get("/v1/newsletter", headers=h).json() == {"subscribed": True}
    _send(jobs)
    assert not _mine(me["email"])  # not until the address is verified
    _verify(jobs, me["id"])
    _send(jobs)
    mail = _mine(me["email"])
    assert len(mail) == 1
    m = mail[0]
    assert "FIRST10" in m.text and "First purchase only" in m.text  # the account hasn't bought anything
    assert m.subject.startswith("10% off your first pack")
    assert "This week's tools:" in m.text and "chose Orbit's weekly tips" in (m.footer or "")
    _send(jobs)
    assert len(_mine(me["email"])) == 1  # not again this week

    token = (m.unsubscribe or "").split("token=")[1]
    assert (m.one_click or "").endswith(f"/api/v1/newsletter/one-click?token={token}")
    assert jobs.post("/v1/newsletter/off", json={"token": "x" * 32}).status_code == 404
    assert jobs.post("/v1/newsletter/off", json={"token": token}).status_code == 204
    assert jobs.get("/v1/newsletter", headers=h).json() == {"subscribed": False}


def test_settings_turns_it_on_and_the_week_decides_the_tools() -> None:
    a, b = newsletter.tools_for(datetime(2026, 11, 2, tzinfo=UTC).date()), newsletter.tools_for(
        datetime(2026, 11, 9, tzinfo=UTC).date())
    assert len(a) == 2 and a != b and a[0] != a[1]
    assert all(path.startswith("/") for _, _, path in newsletter.TOOLS)



def test_admin_note_link_stats_and_preview() -> None:
    from tests.test_signup_approval import _client

    email = f"nl-admin-{uuid.uuid4().hex[:6]}@example.com"
    with pytest.MonkeyPatch.context() as mp:
        gen = _client(mp, ORBIT_ADMIN_EMAIL=email)
        c = next(gen)
        try:
            r = c.post("/v1/auth/register", json={"email": email, "password": "correct horse battery"})
            admin = {"Authorization": f"Bearer {r.json()['access_token']}"}
            c.cookies.clear()
            r = c.put("/v1/admin/config", headers=admin, json={
                "newsletter_note": "  New: Plan my prep\non every guide.  ", "newsletter_link": "/interview-questions"})
            assert r.status_code == 200, r.text
            assert r.json()["newsletter_note"] == "New: Plan my prep on every guide."
            for bad in ("javascript:alert(1)", "//evil.example", "http://plain.example"):
                assert c.put("/v1/admin/config", headers=admin, json={"newsletter_link": bad}).status_code == 422

            h = _signup(c, newsletter=True)
            me = _me(c, h)
            _verify(c, me["id"])
            _send(c)
            (m,) = _mine(me["email"])
            assert m.text.index("New: Plan my prep on every guide.") < m.text.index("This week's tools:")
            assert "/interview-questions" in m.text

            stats = c.get("/v1/admin/newsletter", headers=admin).json()
            assert stats["subscribed"] >= 1 and stats["sent_last_week"] >= 1
            r = c.post("/v1/admin/newsletter/preview", headers=admin)
            assert r.status_code == 200 and r.json()["to"] == email, r.text
            sent = [x for x in _outbox().sent if x.to == email and x.subject.startswith("[Preview]")]
            assert sent and "New: Plan my prep" in sent[-1].text
            assert c.get("/v1/admin/newsletter", headers=h).status_code == 403
            c.put("/v1/admin/config", headers=admin, json={"newsletter_note": "", "newsletter_link": ""})
        finally:
            next(gen, None)


class _FakeSmtp:
    def __init__(self, *args: object, **kwargs: object) -> None: ...

    def __enter__(self) -> "_FakeSmtp":
        return self

    def __exit__(self, *args: object) -> None: ...


def test_one_click_unsubscribe_and_its_headers(jobs: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    from email.message import EmailMessage

    from orbit_api.providers import email as email_mod

    h = _signup(jobs, newsletter=True)
    me = _me(jobs, h)
    _verify(jobs, me["id"])
    _send(jobs)
    (m,) = _mine(me["email"])
    token = (m.unsubscribe or "").split("token=")[1]
    # The SMTP sender lists the one-click address first and says it takes a POST.
    seen: list[EmailMessage] = []
    monkeypatch.setattr("orbit_api.providers.email.smtplib.SMTP", _FakeSmtp)
    sender = email_mod.SmtpSender("localhost", 25, None, None, False, "Orbit <hello@example.com>")
    monkeypatch.setattr(sender, "_login_and_send", lambda smtp, msg: seen.append(msg))
    sender._send_sync(m)
    assert seen[0]["List-Unsubscribe"] == f"<{m.one_click}>, <{m.unsubscribe}>"
    assert seen[0]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"

    assert jobs.post("/v1/newsletter/one-click", params={"token": "x" * 32},
                     data={"List-Unsubscribe": "One-Click"}).status_code == 404
    r = jobs.post("/v1/newsletter/one-click", params={"token": token}, data={"List-Unsubscribe": "One-Click"})
    assert r.status_code == 200, r.text
    assert jobs.get("/v1/newsletter", headers=h).json() == {"subscribed": False}
