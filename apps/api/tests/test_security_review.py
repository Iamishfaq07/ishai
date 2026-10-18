"""Security review fixes: no Bearer token in web responses, spoof-proof client IPs, request size cap, update links
that ignore the Host header, and production config that refuses a wildcard CORS origin."""

import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from orbit_api import ratelimit
from orbit_api.config import get_settings
from tests.test_launch_security import _prod

WEB = "http://localhost:5173"
DESKTOP = "http://tauri.localhost"
PW = "correct horse battery"
SECRET = "p" * 40


def _email() -> str:
    return f"sr-{uuid.uuid4().hex[:8]}@example.com"


def test_web_app_gets_no_bearer_token_but_desktop_does(client: TestClient) -> None:
    email = _email()
    web = client.post("/v1/auth/register", json={"email": email, "password": PW}, headers={"Origin": WEB})
    assert web.status_code == 201 and web.json()["access_token"] is None
    cookie = web.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    client.cookies.clear()

    desk = client.post("/v1/auth/login", json={"email": email, "password": PW}, headers={"Origin": DESKTOP})
    assert desk.status_code == 200 and desk.json()["access_token"]
    client.cookies.clear()
    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {desk.json()['access_token']}"})
    assert me.status_code == 200 and me.json()["email"] == email

    # a non-browser client (no Origin) still gets its token
    assert client.post("/v1/auth/login", json={"email": email, "password": PW}).json()["access_token"]


def _request(headers: dict[str, str], peer: str = "10.0.0.9") -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": raw, "client": (peer, 1234)})


@pytest.fixture
def proxy_secret(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("ORBIT_PROXY_SECRET", SECRET)
    get_settings.cache_clear()
    yield
    monkeypatch.delenv("ORBIT_PROXY_SECRET")
    get_settings.cache_clear()


def test_client_ip_without_proxy_secret_is_the_socket_peer() -> None:
    assert ratelimit.client_ip(_request({"x-orbit-client-ip": "1.2.3.4"})) == "10.0.0.9"


def test_client_ip_trusts_only_the_edge_proxy(proxy_secret: None) -> None:
    # the web app's edge proxy, with the shared secret, states the real client
    trusted = {"x-orbit-proxy-secret": SECRET, "x-orbit-client-ip": "203.0.113.7"}
    assert ratelimit.client_ip(_request(trusted)) == "203.0.113.7"
    # anyone else: the right-most X-Forwarded-For hop (the host's edge), never the client's own claim
    spoof = {"x-forwarded-for": "1.1.1.1, 198.51.100.4", "x-orbit-client-ip": "1.1.1.1"}
    assert ratelimit.client_ip(_request(spoof)) == "198.51.100.4"
    wrong = {"x-orbit-proxy-secret": "guess", "x-orbit-client-ip": "1.1.1.1", "x-forwarded-for": "198.51.100.4"}
    assert ratelimit.client_ip(_request(wrong)) == "198.51.100.4"
    # garbage never becomes a bucket key
    assert ratelimit.client_ip(_request({**trusted, "x-orbit-client-ip": "not-an-ip"})) == "10.0.0.9"
    assert ratelimit.client_ip(_request({"x-forwarded-for": "<script>"})) == "10.0.0.9"


def test_oversized_request_bodies_are_refused(client: TestClient) -> None:
    cap = get_settings().max_upload_bytes + 1024 * 1024
    r = client.post("/v1/auth/login", content=b"x" * (cap + 1), headers={"content-type": "application/json"})
    assert r.status_code == 413

    def chunks() -> Iterator[bytes]:
        for _ in range(cap // (1024 * 1024) + 2):
            yield b"x" * (1024 * 1024)

    r = client.post("/v1/auth/login", content=chunks(), headers={"content-type": "application/json"})
    assert r.status_code == 413  # answered by BodyLimit itself, not a parse error


def test_a_too_large_answer_reaches_the_app_that_sent_it(client: TestClient) -> None:
    """BodyLimit runs outside CORS: its 413 carries CORS headers for an allowed origin itself, or the browser hides it
    and the web app says "Can't reach Orbit" instead of what's wrong. Another origin gets none."""
    cap = get_settings().max_upload_bytes + 1024 * 1024
    big = b"x" * (cap + 1)
    ours = get_settings().cors_origins[0]
    r = client.post("/v1/documents", content=big, headers={"content-type": "multipart/form-data; boundary=x",
                                                           "origin": ours})
    assert r.status_code == 413
    assert r.headers["access-control-allow-origin"] == ours
    assert r.headers["access-control-allow-credentials"] == "true"
    assert "up to 5 MB" in r.json()["detail"]
    r = client.post("/v1/documents", content=big, headers={"content-type": "multipart/form-data; boundary=x",
                                                           "origin": "https://evil.example"})
    assert r.status_code == 413 and "access-control-allow-origin" not in r.headers


def test_update_links_use_the_configured_public_url(client: TestClient, tmp_path: Path,
                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    d = tmp_path / "0.2.0"
    d.mkdir()
    (d / "Orbit_0.2.0_x64-setup.exe").write_bytes(b"MZ")
    (d / "Orbit_0.2.0_x64-setup.exe.sig").write_text("sig", encoding="utf-8")
    monkeypatch.setattr(get_settings(), "desktop_updates_dir", str(tmp_path))
    monkeypatch.setattr(get_settings(), "api_public_url", "https://api.orbit.example/")
    r = client.get("/v1/desktop/update/windows/x86_64/0.1.0", headers={"Host": "evil.example"})
    assert r.status_code == 200
    assert r.json()["url"] == "https://api.orbit.example/v1/desktop/download/0.2.0/Orbit_0.2.0_x64-setup.exe"


def test_production_refuses_wildcard_cors_and_ignores_a_weak_proxy_secret() -> None:
    _prod()  # the baseline is valid
    with pytest.raises(ValueError, match="CORS"):
        _prod(ORBIT_CORS_ORIGINS='["*"]')
    # A weak or missing secret isn't trusted (no caller may state its IP), and the API still starts: refusing to
    # start took production down when Render didn't have the secret.
    assert _prod(ORBIT_PROXY_SECRET="short").proxy_secret is None


def test_dropped_email_logs_a_masked_address() -> None:
    from orbit_api.providers.email import mask_email

    assert mask_email("jane.doe@example.com") == "j***@example.com"
    assert mask_email("nonsense") == "***"


def test_websockets_refuse_foreign_origins_without_burning_the_ticket(client: TestClient) -> None:
    from starlette.websockets import WebSocketDisconnect

    r = client.post("/v1/auth/register", json={"email": _email(), "password": PW}, headers={"Origin": DESKTOP})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    client.cookies.clear()
    sid = client.post("/v1/sessions", headers=h, json={"title": "t"}).json()["id"]
    ticket = client.post(f"/v1/sessions/{sid}/live-ticket", headers=h).json()["ticket"]
    for path in (f"/v1/sessions/{sid}/live?ticket={ticket}", f"/v1/sessions/{sid}/view?ticket=x"):
        with pytest.raises(WebSocketDisconnect) as closed:
            with client.websocket_connect(path, headers={"Origin": "https://evil.example"}) as ws:
                ws.receive_text()
        assert closed.value.code == 1008
    # the ticket survived the refused attempt, and our own frontends get in
    with client.websocket_connect(f"/v1/sessions/{sid}/live?ticket={ticket}", headers={"Origin": DESKTOP}) as ws:
        assert ws.receive_json()["type"]
        ws.send_json({"type": "session.end", "data": {}})
        while ws.receive_json()["type"] != "session.ended":
            pass


# ---- sign-up never reveals whether an email is registered ----------------------------------------------------


def test_signup_answers_the_same_for_new_and_taken_emails(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.providers.email import DevOutbox, get_email_sender
    from tests.test_launch_security import _verify, app_with

    sender = get_email_sender()
    assert isinstance(sender, DevOutbox)
    with app_with(monkeypatch, ORBIT_EMAIL_VERIFICATION="required") as c:
        email = _email()
        new = c.post("/v1/auth/register", json={"email": email, "password": PW}, headers={"Origin": WEB})
        assert new.status_code == 202 and "set-cookie" not in new.headers
        assert new.json() == {"status": "verify_email", "email": email}
        assert c.get("/v1/auth/me").status_code == 401  # not signed in until they prove the inbox and sign in

        # taken (by someone else's attempt with a different password): identical answer, the owner is told
        taken = c.post("/v1/auth/register", json={"email": email, "password": "someone else's pw"},
                       headers={"Origin": WEB})
        assert (taken.status_code, taken.json(), "set-cookie" in taken.headers) == (202, new.json(), False)
        assert any(m.to == email and "already has one" in m.text for m in sender.sent)

        # verified accounts too; then the person signs in with their password
        _verify(c, email)
        again = c.post("/v1/auth/register", json={"email": email, "password": PW}, headers={"Origin": WEB})
        assert (again.status_code, again.json()) == (202, new.json())
        signed_in = c.post("/v1/auth/login", json={"email": email, "password": PW}, headers={"Origin": WEB})
        assert signed_in.status_code == 200 and signed_in.json()["user"]["email_verified"] is True


def test_owner_signing_up_again_before_verifying_gets_a_fresh_link(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.providers.email import DevOutbox, get_email_sender
    from tests.test_launch_security import app_with

    sender = get_email_sender()
    assert isinstance(sender, DevOutbox)
    with app_with(monkeypatch, ORBIT_EMAIL_VERIFICATION="required") as c:
        email = _email()
        c.post("/v1/auth/register", json={"email": email, "password": PW}, headers={"Origin": WEB})
        links = lambda: [m for m in sender.sent if m.to == email and "/verify-email" in m.text]  # noqa: E731
        assert len(links()) == 1
        c.post("/v1/auth/register", json={"email": email, "password": PW}, headers={"Origin": WEB})
        assert len(links()) == 1  # a link went out moments ago: no second one yet (resend cooldown)
        assert not any(m.to == email and "already has one" in m.text for m in sender.sent)  # and no confusing notice


def test_simultaneous_signups_for_one_address_get_the_same_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    from sqlalchemy.exc import IntegrityError

    from orbit_api.auth import routes
    from tests.test_launch_security import app_with

    async def lost_the_race(*_: object) -> None:
        raise IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed: users.email"))

    with app_with(monkeypatch, ORBIT_EMAIL_VERIFICATION="required") as c:
        monkeypatch.setattr(routes, "_create_user", lost_the_race)
        email = _email()
        r = c.post("/v1/auth/register", json={"email": email, "password": PW}, headers={"Origin": WEB})
        assert (r.status_code, r.json()) == (202, {"status": "verify_email", "email": email})


def test_signup_signs_straight_in_when_verification_is_off(client: TestClient) -> None:
    email = _email()
    r = client.post("/v1/auth/register", json={"email": email, "password": PW}, headers={"Origin": WEB})
    assert r.status_code == 201 and r.json()["user"]["email"] == email
    client.cookies.clear()
    dup = client.post("/v1/auth/register", json={"email": email, "password": PW}, headers={"Origin": WEB})
    assert dup.status_code == 409  # only local/private deploys, where nobody else can sign up


# ---- web sessions expire when unused and renew while in use ---------------------------------------------------


def _claims(token: str) -> dict[str, object]:
    from orbit_api.auth.security import decode_claims

    claims = decode_claims(token)
    assert claims is not None
    return claims


def _claims_unverified(token: str) -> dict[str, object]:
    import jwt

    claims: dict[str, object] = jwt.decode(token, options={"verify_signature": False})
    return claims


def test_web_session_is_short_lived_and_renews_while_used(client: TestClient,
                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    import time

    from orbit_api.auth import security

    email = _email()
    r = client.post("/v1/auth/register", json={"email": email, "password": PW}, headers={"Origin": WEB})
    assert r.status_code == 201
    web = _claims(client.cookies["orbit_session"])
    idle = get_settings().session_idle_hours * 3600
    cap = get_settings().jwt_ttl_minutes * 60
    assert web["idle"] is True and int(web["exp"]) - int(web["iat"]) == idle  # type: ignore[call-overload]
    assert "max-age=259200" in r.headers["set-cookie"].lower()

    # fresh cookie: no renewal on every request
    assert "set-cookie" not in client.get("/v1/auth/me").headers
    # an hour later the same session is renewed (new expiry, same sign-in time)
    later = time.time() + 3600
    monkeypatch.setattr(security, "_now", lambda: int(later))
    renewed = client.get("/v1/auth/me")
    assert renewed.status_code == 200 and "orbit_session=" in renewed.headers["set-cookie"]
    fresh = _claims_unverified(client.cookies["orbit_session"])
    assert fresh["auth"] == web["auth"] and int(fresh["exp"]) > int(web["exp"])  # type: ignore[call-overload]

    # never past the hard cap, however active
    auth = int(web["auth"])  # type: ignore[call-overload]
    monkeypatch.setattr(security, "_now", lambda: auth + cap - 60)
    capped = _claims_unverified(security.create_access_token(email, 0, idle=True, signed_in_at=auth))
    assert int(capped["exp"]) == auth + cap  # type: ignore[call-overload]


def test_unused_web_session_expires_but_desktop_token_lasts(client: TestClient,
                                                            monkeypatch: pytest.MonkeyPatch) -> None:
    import time

    from orbit_api.auth import security

    email = _email()
    four_days_ago = time.time() - 4 * 24 * 3600
    monkeypatch.setattr(security, "_now", lambda: int(four_days_ago))  # both sign-ins happened 4 days ago
    client.post("/v1/auth/register", json={"email": email, "password": PW}, headers={"Origin": WEB})
    web_cookie = client.cookies["orbit_session"]
    client.cookies.clear()
    desk = client.post("/v1/auth/login", json={"email": email, "password": PW}, headers={"Origin": DESKTOP})
    client.cookies.clear()
    monkeypatch.undo()
    assert _claims(desk.json()["access_token"])["idle"] is False
    client.cookies.set("orbit_session", web_cookie)
    assert client.get("/v1/auth/me").status_code == 401  # unused for more than 3 days
    client.cookies.clear()
    bearer = {"Authorization": f"Bearer {desk.json()['access_token']}"}
    assert client.get("/v1/auth/me", headers=bearer).status_code == 200  # desktop: until the 7-day cap
