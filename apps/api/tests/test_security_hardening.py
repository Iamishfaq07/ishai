"""Audit fixes: rate-limit keys (IPv6 /64, the right-most X-Forwarded-For, eviction), failed-only login throttling,
welcome credits per inbox and per network, password change, sign-out-everywhere revoking emailed links and live
sessions, the admin account's protections, and common passwords."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from orbit_api import credits, ratelimit
from orbit_api.auth import routes as auth_routes
from orbit_api.auth.email_tokens import issue
from orbit_api.db import sessionmaker
from orbit_api.ratelimit import TokenBucket, client_ip, network_of
from tests.test_credits import _new_ip, _signup, _wallet, enforce  # noqa: F401 (the fixture)
from tests.test_signup_approval import _client
from tests.test_signup_approval import _register as _register_named

PW = "correct horse battery"


def _request(headers: dict[str, str], client: str = "10.0.0.9") -> Request:
    return Request({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
                    "client": (client, 1234)})


def test_ipv6_callers_are_grouped_by_their_slash_64() -> None:
    assert network_of("2001:db8:1:2:aaaa::1") == network_of("2001:db8:1:2:ffff::9") == "2001:db8:1:2::/64"
    assert network_of("2001:db8:1:3::1") != network_of("2001:db8:1:2::1")
    assert network_of("203.0.113.7") == "203.0.113.7"
    assert network_of("::ffff:203.0.113.7") == "203.0.113.7"
    assert credits.ip_hash("2001:db8:1:2::1") == credits.ip_hash("2001:db8:1:2:9::9")


def test_the_client_ip_is_the_hop_the_host_added_not_one_the_caller_wrote(monkeypatch: pytest.MonkeyPatch) -> None:
    from pydantic import SecretStr

    from orbit_api.config import get_settings

    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr("s" * 32))
    assert client_ip(_request({"X-Forwarded-For": "1.2.3.4, 198.51.100.20"})) == "198.51.100.20"
    assert client_ip(_request({})) == "10.0.0.9"
    assert client_ip(_request({"X-Forwarded-For": "not-an-ip"})) == "10.0.0.9"
    worker = {"X-Orbit-Proxy-Secret": "s" * 32, "X-Orbit-Client-IP": "203.0.113.50", "X-Forwarded-For": "9.9.9.9"}
    assert client_ip(_request(worker)) == "203.0.113.50"  # only the Worker may say who the visitor is


def test_a_full_bucket_table_forgets_the_oldest_not_everyone(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ratelimit, "MAX_KEYS", 100)
    bucket = TokenBucket(rate_per_s=0.0001, burst=1)
    for i in range(150):  # a flood of junk keys past the limit
        bucket.allow(f"junk-{i}")
    bucket.allow("victim")
    assert not bucket.allow("victim")  # the throttle on a recent key survives the flood (it used to be wiped)
    assert len(bucket._buckets) <= ratelimit.MAX_KEYS + 1


def test_wrong_passwords_from_elsewhere_dont_lock_the_owner_out(client: TestClient,
                                                                monkeypatch: pytest.MonkeyPatch) -> None:
    from pydantic import SecretStr

    from orbit_api.config import get_settings

    monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr("s" * 32))  # X-Forwarded-For's last hop counts
    ratelimit.reset_all()
    email = f"owner-{uuid.uuid4().hex[:8]}@example.com"
    assert client.post("/v1/auth/register", json={"email": email, "password": PW}).status_code == 201
    client.cookies.clear()
    attacker = {"X-Forwarded-For": "198.51.100.66"}
    owner = {"X-Forwarded-For": "203.0.113.5"}
    for _ in range(10):
        client.post("/v1/auth/login", headers=attacker, json={"email": email, "password": "wrong password x"})
    assert client.post("/v1/auth/login", headers=attacker, json={"email": email, "password": PW}).status_code == 429
    assert client.post("/v1/auth/login", headers=owner, json={"email": email, "password": PW}).status_code == 200
    for _ in range(5):  # a correct password never counts against the owner
        assert client.post("/v1/auth/login", headers=owner, json={"email": email, "password": PW}).status_code == 200
    ratelimit.reset_all()


def test_one_welcome_per_inbox_however_its_spelled(client: TestClient, enforce: None,  # noqa: F811
                                                   monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import get_settings

    monkeypatch.setattr(get_settings(), "welcome_daily_limit", 10**9)
    assert credits.inbox("A.Sha+jobs@GoogleMail.com") == "asha@gmail.com"
    assert credits.inbox("asha+x@example.com") == "asha@example.com"
    local = f"farm{uuid.uuid4().hex[:6]}"

    def signup(email: str, ip: str) -> dict[str, str]:
        r = client.post("/v1/auth/register", headers=ratelimit_headers(ip), json={"email": email, "password": PW})
        assert r.status_code == 201, r.text
        client.cookies.clear()
        return {**ratelimit_headers(ip), "Authorization": f"Bearer {r.json()['access_token']}"}

    first = signup(f"{local}@gmail.com", _new_ip())
    assert _wallet(client, first)["resume"] == 1
    for variant in (f"{local[:2]}.{local[2:]}@gmail.com", f"{local}+2@gmail.com", f"{local}@googlemail.com"):
        assert _wallet(client, signup(variant, _new_ip()))["resume"] == 0  # a new network, the same inbox
    # Rotating addresses inside one IPv6 /64 isn't a new network either.
    net = f"2001:db8:{uuid.uuid4().int % 9999:x}:1"
    assert _wallet(client, signup(f"v6a{uuid.uuid4().hex[:6]}@example.com", f"{net}::1"))["resume"] == 1
    assert _wallet(client, signup(f"v6b{uuid.uuid4().hex[:6]}@example.com", f"{net}::2"))["resume"] == 0


def ratelimit_headers(ip: str) -> dict[str, str]:
    from tests.test_credits import _ip

    return _ip(ip)


def test_changing_the_password_signs_out_every_other_device(client: TestClient) -> None:
    email = f"pw-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": PW})
    client.cookies.clear()
    old = {"Authorization": f"Bearer {r.json()['access_token']}"}
    bad = client.post("/v1/auth/me/password", headers=old,
                      json={"current_password": "not it at all", "new_password": "a brand new phrase 7"})
    assert bad.status_code == 403
    assert client.post("/v1/auth/me/password", headers=old,
                       json={"current_password": PW, "new_password": "password123"}).status_code == 422  # common
    ok = client.post("/v1/auth/me/password", headers=old,
                     json={"current_password": PW, "new_password": "a brand new phrase 7"})
    assert ok.status_code == 200
    client.cookies.clear()
    assert client.get("/v1/auth/me", headers=old).status_code == 401  # other devices are out
    mine = {"Authorization": f"Bearer {ok.json()['access_token']}"}
    assert client.get("/v1/auth/me", headers=mine).status_code == 200
    assert client.post("/v1/auth/login", json={"email": email, "password": "a brand new phrase 7"}).status_code == 200


def test_signing_out_everywhere_kills_pending_emailed_links(client: TestClient) -> None:
    email = f"links-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": PW})
    client.cookies.clear()
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    user_id = client.get("/v1/auth/me", headers=h).json()["id"]

    async def pending_change() -> str:
        async with sessionmaker()() as db:
            token = await issue(db, user_id, "change_email", new_email=f"thief-{uuid.uuid4().hex[:6]}@example.com")
            await db.commit()
            return token

    token = client.portal.call(pending_change)  # type: ignore[union-attr]
    assert client.post("/v1/auth/logout-all", headers=h).status_code == 204
    # The change someone started with the stolen password can't be finished after the owner signs out everywhere.
    assert client.post("/v1/auth/email-change/confirm", json={"token": token}).status_code == 400


def test_the_admin_account_cant_be_deleted_or_moved_to_another_email(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)
    client = next(gen)
    try:
        admin, _ = _register_named(client, admin_email)
        assert client.request("DELETE", "/v1/auth/me", headers=admin, json={"password": PW}).status_code == 422
        moved = client.post("/v1/auth/me/email", headers=admin, json={"new_email": "x@example.com", "password": PW})
        assert moved.status_code == 422
    finally:
        gen.close()


@pytest.mark.parametrize(("password", "ok"), [("password123", False), ("aaaaaaaaaaaa", False),
                                              ("1234567890", False), ("a long and unusual phrase", True)])
def test_common_passwords_are_refused(password: str, ok: bool) -> None:
    assert (auth_routes.password_problem(password) is None) is ok


def test_the_signup_notice_name_is_one_short_line() -> None:
    from types import SimpleNamespace

    sent: list[Any] = []

    class Tasks:
        def add_task(self, _fn: Any, mail: Any) -> None:
            sent.append(mail)

    user = SimpleNamespace(name="Asha\n\nURGENT: pay at evil.example\n" + "x" * 300, email="a@example.com",
                           email_verified=True, approved=False, grant_plan=None, grant_until=None)
    s = auth_routes.get_settings()
    with pytest.MonkeyPatch.context() as m:
        m.setattr(s, "admin_email", "boss@example.com")
        m.setattr(auth_routes, "awaiting_approval", lambda _u: True)
        auth_routes._alert_admin_if_waiting(user, Tasks())  # type: ignore[arg-type]
    assert sent and "\n\nURGENT" not in sent[0].text and len(sent[0].text.splitlines()[0]) < 200


async def test_audio_faster_than_real_time_is_dropped(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.live import engine as live_engine
    from orbit_api.providers.llm.mock import MockLLMProvider
    from tests.test_engine import _engine

    eng, _sink = await _engine(MockLLMProvider())
    clock = [0]
    monkeypatch.setattr(eng, "now_ms", lambda: clock[0])
    frame = b"\x01" + b"\x00" * 32_000  # one second of system audio
    for _ in range(30):  # 30 s of audio, all at once
        await eng.handle_audio(frame)
    sent = eng.channel_bytes["system"]
    assert sent <= live_engine.AUDIO_BURST_BYTES + 32_000 and eng._audio_dropped > 0
    clock[0] += 10_000  # ten real seconds later: about ten seconds more is accepted
    for _ in range(30):
        await eng.handle_audio(frame)
    assert eng.channel_bytes["system"] - sent <= 10 * live_engine.AUDIO_RATE_BYTES + 32_000
    await eng.handle_client({"type": "session.start", "data": "not a dict"})  # a bad message, not a crash
    await eng.end(final=True)


def test_admin_config_cant_redirect_the_ai_key_or_go_mock_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import get_settings
    from orbit_api.runtime_config import validate_value

    assert validate_value("deepseek_base_url", "http://localhost:9999") == "http://localhost:9999"  # dev: anything
    monkeypatch.setattr(get_settings(), "env", "production")
    assert validate_value("deepseek_base_url", "https://api.deepseek.com") == "https://api.deepseek.com"
    for bad in ("https://evil.example/v1", "http://api.deepseek.com", "https://api.deepseek.com:8443",
                "https://user:pw@api.deepseek.com", "http://169.254.169.254/latest"):
        with pytest.raises(ValueError):
            validate_value("deepseek_base_url", bad)
    with pytest.raises(ValueError):
        validate_value("llm_provider", "mock")


def test_logged_paths_hide_tickets_and_share_codes() -> None:
    import logging

    from orbit_api.observability import RedactArgs, redact

    assert redact("POST /v1/companion/AbCdEfGhIjKlMnOpQrStUv123") == "POST /v1/companion/[redacted]"
    record = logging.LogRecord("uvicorn.access", 20, "x", 1, '%s - "%s %s"', (
        "1.2.3.4", "GET", "/v1/sessions/s/live?ticket=SECRET123456"), None)
    RedactArgs().filter(record)
    assert "SECRET" not in record.getMessage() and "ticket=[redacted]" in record.getMessage()
