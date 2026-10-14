"""Launch hardening: email verification before paid features, CSRF, abuse limits, CAPTCHA, fail-fast config."""

import re
import uuid
from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from orbit_api import ratelimit
from orbit_api.config import Settings, get_settings
from orbit_api.providers.email import DevOutbox, get_email_sender

WEB = "http://localhost:5173"
EVIL = "https://evil.example"
PW = "correct horse battery"


@contextmanager
def app_with(monkeypatch: pytest.MonkeyPatch, **env: str) -> Iterator[TestClient]:
    from orbit_api.main import create_app

    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            yield c
    finally:
        for k in env:
            monkeypatch.delenv(k, raising=False)
        get_settings.cache_clear()


def _email() -> str:
    return f"sec-{uuid.uuid4().hex[:8]}@example.com"


def _register(c: TestClient, email: str | None = None, **extra: object) -> tuple[str, dict[str, str]]:
    email = email or _email()
    r = c.post("/v1/auth/register", json={"email": email, "password": PW, **extra}, headers={"Origin": WEB})
    if r.status_code == 202:  # verification required: sign-up waits for the inbox, then the person signs in
        assert r.json() == {"status": "verify_email", "email": email}
        r = c.post("/v1/auth/login", json={"email": email, "password": PW}, headers={"Origin": WEB})
        assert r.status_code == 200, r.text
    else:
        assert r.status_code == 201, r.text
    assert r.json()["access_token"] is None  # the web app's session lives only in the httpOnly cookie
    token = c.cookies.get("orbit_session")
    c.cookies.clear()
    return email, {"Authorization": f"Bearer {token}"}


def _verify(c: TestClient, email: str) -> None:
    sender = get_email_sender()
    assert isinstance(sender, DevOutbox)
    mail = next(m for m in reversed(sender.sent) if m.to == email and "/verify-email" in m.text)
    token = re.search(r"/verify-email\?token=([\w-]+)", mail.text)
    assert token
    assert c.post("/v1/auth/verify-email/confirm", json={"token": token.group(1)}).status_code == 200


# ---- email verification ---------------------------------------------------------------------------------


def test_unverified_user_cannot_spend_provider_quota(monkeypatch: pytest.MonkeyPatch) -> None:
    admin = _email()
    with app_with(monkeypatch, ORBIT_EMAIL_VERIFICATION="required", ORBIT_ADMIN_EMAIL=admin) as c:
        _register(c, admin)  # occupy the admin slot so the test user isn't the dev-mode stand-in admin
        email, h = _register(c)
        assert c.get("/v1/auth/me", headers=h).json()["email_verified"] is False

        def locked(r: object) -> None:
            assert r.status_code == 403, r.text  # type: ignore[attr-defined]
            err = r.json()["detail"]  # type: ignore[attr-defined]
            assert err["code"] == "email_unverified" and email in err["message"]

        locked(c.post("/v1/sessions", headers=h, json={"title": "t"}))
        locked(c.post("/v1/documents/text", headers=h, json={"kind": "notes", "title": "n", "text": "hello world"}))
        locked(c.post("/v1/documents", headers=h, data={"kind": "notes"},
                      files={"file": ("n.txt", b"notes", "text/plain")}))
        pre = c.get("/v1/preflight", headers=h).json()
        assert pre["ok"] is False and [x["id"] for x in pre["checks"]][-1] == "account"
        # account essentials stay reachable
        assert c.post("/v1/auth/verify-email/request", headers=h).status_code in (202, 429)
        assert c.patch("/v1/auth/me/privacy", headers=h, json={"store_transcripts": False}).status_code == 200

        _verify(c, email)
        sid = c.post("/v1/sessions", headers=h, json={"title": "t"})
        assert sid.status_code == 201
        assert c.post(f"/v1/sessions/{sid.json()['id']}/live-ticket", headers=h).status_code == 200


def test_live_ticket_screenshot_and_review_are_gated(monkeypatch: pytest.MonkeyPatch) -> None:
    admin = _email()
    with app_with(monkeypatch, ORBIT_ADMIN_EMAIL=admin) as c:  # verification off: create a session first
        _register(c, admin)
        _, h = _register(c)
        sid = c.post("/v1/sessions", headers=h, json={"title": "t"}).json()["id"]
    with app_with(monkeypatch, ORBIT_EMAIL_VERIFICATION="required", ORBIT_ADMIN_EMAIL=admin) as c:
        for r in (c.post(f"/v1/sessions/{sid}/live-ticket", headers=h),
                  c.post(f"/v1/sessions/{sid}/screenshots", headers=h,
                         files={"image": ("s.png", b"\x89PNG\r\n\x1a\n" + b"0" * 32, "image/png")}),
                  c.post(f"/v1/sessions/{sid}/review", headers=h)):
            assert r.status_code == 403 and r.json()["detail"]["code"] == "email_unverified"


def test_admin_must_verify_when_mail_can_be_delivered(monkeypatch: pytest.MonkeyPatch) -> None:
    # Otherwise whoever registered the admin address first would be admin without proving the inbox.
    admin = _email()
    with app_with(monkeypatch, ORBIT_EMAIL_VERIFICATION="required", ORBIT_ADMIN_EMAIL=admin) as c:
        _, h = _register(c, admin)
        r = c.post("/v1/sessions", headers=h, json={"title": "t"})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "email_unverified"
        _verify(c, admin)
        assert c.post("/v1/sessions", headers=h, json={"title": "t"}).status_code == 201
        assert c.get("/v1/entitlements", headers=h).json()["plan"] == "unlimited"


def test_auth_config_is_public(monkeypatch: pytest.MonkeyPatch) -> None:
    with app_with(monkeypatch, ORBIT_EMAIL_VERIFICATION="required") as c:
        assert c.get("/v1/auth/config").json() == {"captcha": None, "email_verification": "required",
                                                   "google": False}
    with app_with(monkeypatch, ORBIT_CAPTCHA_PROVIDER="turnstile", TURNSTILE_SITE_KEY="site-123",
                  TURNSTILE_SECRET_KEY="secret") as c:
        assert c.get("/v1/auth/config").json()["captcha"] == {"provider": "turnstile", "site_key": "site-123"}


# ---- CSRF ------------------------------------------------------------------------------------------------


def _cookie_session(c: TestClient) -> str:
    """Sign in via the browser path; returns the CSRF token from the auth response."""
    r = c.post("/v1/auth/register", json={"email": _email(), "password": PW}, headers={"Origin": WEB})
    assert r.status_code == 201
    return str(r.json()["user"]["csrf_token"])


def test_csrf_cookie_requests_need_allowed_origin_and_token(monkeypatch: pytest.MonkeyPatch) -> None:
    with app_with(monkeypatch, ORBIT_CSRF_PROTECTION="true") as c:
        token = _cookie_session(c)
        body = {"store_transcripts": False}
        ok = c.patch("/v1/auth/me/privacy", json=body, headers={"Origin": WEB, "X-CSRF-Token": token})
        assert ok.status_code == 200
        # /me hands out the same token (what the web app reads on load)
        assert c.get("/v1/auth/me").json()["csrf_token"] == token

        evil = c.patch("/v1/auth/me/privacy", json=body, headers={"Origin": EVIL, "X-CSRF-Token": token})
        assert evil.status_code == 403 and evil.json()["error"]["code"] == "csrf_origin"
        missing = c.patch("/v1/auth/me/privacy", json=body, headers={"Origin": WEB})
        assert missing.status_code == 403 and missing.json()["error"]["code"] == "csrf_token"
        wrong = c.patch("/v1/auth/me/privacy", json=body, headers={"Origin": WEB, "X-CSRF-Token": "nope"})
        assert wrong.status_code == 403
        no_origin = c.patch("/v1/auth/me/privacy", json=body, headers={"X-CSRF-Token": token})
        assert no_origin.status_code == 403
        referer = c.patch("/v1/auth/me/privacy", json=body,
                          headers={"Referer": f"{WEB}/settings", "X-CSRF-Token": token})
        assert referer.status_code == 200
        # multipart uploads and deletes are covered too
        up = c.post("/v1/documents", data={"kind": "notes"}, files={"file": ("n.txt", b"x", "text/plain")},
                    headers={"Origin": WEB})
        assert up.status_code == 403
        assert c.delete("/v1/auth/me", headers={"Origin": EVIL}).status_code == 403
        assert c.get("/v1/auth/me").status_code == 200  # the account survived the forged delete


def test_csrf_does_not_affect_bearer_clients(monkeypatch: pytest.MonkeyPatch) -> None:
    with app_with(monkeypatch, ORBIT_CSRF_PROTECTION="true") as c:
        _, h = _register(c)
        # desktop: Bearer token, tauri origin (or any origin) and no CSRF header
        r = c.post("/v1/sessions", json={"title": "t"}, headers={**h, "Origin": "http://tauri.localhost"})
        assert r.status_code == 201
        assert c.post("/v1/documents", headers=h, data={"kind": "notes"},
                      files={"file": ("n.txt", b"notes here", "text/plain")}).status_code == 201


def test_login_csrf_and_stale_cookie(monkeypatch: pytest.MonkeyPatch) -> None:
    with app_with(monkeypatch, ORBIT_CSRF_PROTECTION="true") as c:
        email = _email()
        assert c.post("/v1/auth/register", json={"email": email, "password": PW},
                      headers={"Origin": WEB}).status_code == 201
        # a forged cross-site login (signing the victim into the attacker's account) is refused
        assert c.post("/v1/auth/login", json={"email": email, "password": PW},
                      headers={"Origin": EVIL}).status_code == 403
        # an existing (possibly stale) cookie never blocks signing in from the real app
        assert c.post("/v1/auth/login", json={"email": email, "password": PW},
                      headers={"Origin": WEB}).status_code == 200


def test_cors_allows_put_and_csrf_header() -> None:
    from orbit_api.main import create_app

    with TestClient(create_app()) as c:
        r = c.options("/v1/workspaces/abc", headers={
            "Origin": "http://tauri.localhost", "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type,x-csrf-token"})
        assert r.status_code == 200
        assert "PUT" in r.headers["access-control-allow-methods"]
        assert "x-csrf-token" in r.headers["access-control-allow-headers"].lower()


# ---- abuse limits & CAPTCHA -----------------------------------------------------------------------------


@pytest.fixture
def enforce_limits(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    ratelimit.reset_all()
    monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
    yield
    ratelimit.reset_all()


def test_signup_is_rate_limited_per_ip(monkeypatch: pytest.MonkeyPatch, enforce_limits: None) -> None:
    with app_with(monkeypatch) as c:
        codes = [c.post("/v1/auth/register", json={"email": _email(), "password": PW}).status_code for _ in range(8)]
        assert codes.count(201) <= 5 and codes[-1] == 429


def test_login_is_rate_limited_per_email(monkeypatch: pytest.MonkeyPatch, enforce_limits: None) -> None:
    with app_with(monkeypatch) as c:
        email = _email()
        c.post("/v1/auth/register", json={"email": email, "password": PW})
        codes = [c.post("/v1/auth/login", json={"email": email, "password": "wrong password"}).status_code
                 for _ in range(12)]
        assert codes[0] == 401 and codes[-1] == 429


def test_provider_cost_endpoints_are_limited_per_user(monkeypatch: pytest.MonkeyPatch, enforce_limits: None) -> None:
    with app_with(monkeypatch) as c:
        _, h = _register(c)
        codes = [c.post("/v1/sessions", headers=h, json={"title": "t"}).status_code for _ in range(12)]
        assert codes[0] == 201 and 429 in codes


def test_captcha_required_on_signup_when_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.auth import captcha

    seen: list[str] = []

    async def fake_verify(token: str, ip: str | None) -> bool:
        seen.append(token)
        return token == "good-token"

    monkeypatch.setattr(captcha, "_verify_turnstile", fake_verify)
    with app_with(monkeypatch, ORBIT_CAPTCHA_PROVIDER="turnstile", TURNSTILE_SITE_KEY="k",
                  TURNSTILE_SECRET_KEY="s") as c:
        r = c.post("/v1/auth/register", json={"email": _email(), "password": PW})
        assert r.status_code == 400 and r.json()["detail"]["code"] == "captcha_failed"
        r = c.post("/v1/auth/register", json={"email": _email(), "password": PW, "captcha_token": "bad"})
        assert r.status_code == 400
        r = c.post("/v1/auth/register", json={"email": _email(), "password": PW, "captcha_token": "good-token"})
        assert r.status_code == 201 and seen == ["bad", "good-token"]
        assert c.post("/v1/auth/password-reset/request", json={"email": _email()}).status_code == 400


# ---- fail-fast production config ------------------------------------------------------------------------


def _prod(**kw: object) -> Settings:
    base = dict(ORBIT_ENV="production", ORBIT_JWT_SECRET="Q8f2LmZr7Tq1VbN4xKc9WsYe3HpJd6Ug", DEEPSEEK_API_KEY="k",
                DEEPGRAM_API_KEY="k",
                ORBIT_DATABASE_URL="postgresql+asyncpg://u:p@h/db", ORBIT_ADMIN_EMAIL="owner@example.com",
                ORBIT_LLM_PROVIDER="deepseek", ORBIT_STT_PROVIDER="deepgram", ORBIT_PROXY_SECRET="p" * 32)
    base.update({k: str(v) for k, v in kw.items()})
    return Settings(_env_file=None, **base)  # type: ignore[call-arg]


def test_production_refuses_unverifiable_or_unsafe_signup() -> None:
    assert _prod().verification_required  # admin-only: fine without SMTP
    with pytest.raises(ValueError, match="SMTP"):
        _prod(ORBIT_ALLOWED_EMAILS="friend@example.com")
    # Fully open (no verification, no approval): a new account's only free spend is its welcome credits, one per
    # network and capped per day, so it's allowed, as long as that daily cap stays bounded.
    open_free = _prod(ORBIT_ALLOWED_EMAILS="*", ORBIT_EMAIL_VERIFICATION="off", ORBIT_SIGNUP_APPROVAL="false")
    assert open_free.public_signup and not open_free.approval_required and not open_free.verification_required
    with pytest.raises(ValueError, match="ORBIT_WELCOME_DAILY"):
        _prod(ORBIT_ALLOWED_EMAILS="*", ORBIT_EMAIL_VERIFICATION="off", ORBIT_SIGNUP_APPROVAL="false",
              ORBIT_WELCOME_DAILY="5000")
    # With sign-up approval (on by default in production) nobody spends anything before the admin looks, so open
    # sign-up without SMTP is allowed: the admin sees new accounts in the app instead of by email.
    open_approved = _prod(ORBIT_ALLOWED_EMAILS="*", ORBIT_EMAIL_VERIFICATION="off")
    assert open_approved.public_signup and open_approved.approval_required
    with pytest.raises(ValueError, match="SMTP"):  # "*" alone still needs a way to verify
        _prod(ORBIT_ALLOWED_EMAILS="*")
    with pytest.raises(ValueError, match="TURNSTILE"):
        _prod(ORBIT_CAPTCHA_PROVIDER="turnstile")
    # a private list of exact addresses may opt out explicitly; public sign-up needs SMTP
    assert not _prod(ORBIT_ALLOWED_EMAILS="friend@example.com", ORBIT_EMAIL_VERIFICATION="off").verification_required
    assert _prod(ORBIT_ALLOWED_EMAILS="*", ORBIT_SMTP_HOST="smtp.example.com").public_signup
    # production never lets CAPTCHA_ENABLED=false switch a configured CAPTCHA off
    prod_captcha = _prod(ORBIT_CAPTCHA_PROVIDER="turnstile", TURNSTILE_SITE_KEY="k", TURNSTILE_SECRET_KEY="s",
                         CAPTCHA_ENABLED="false")
    assert prod_captcha.captcha_active


def test_production_refuses_more_than_one_replica() -> None:
    assert _prod().api_replicas == 1
    with pytest.raises(ValueError, match="ORBIT_API_REPLICAS must be 1"):
        _prod(ORBIT_API_REPLICAS=2)


def test_cors_origins_accept_json_or_comma_list(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ORBIT_CORS_ORIGINS", '["https://a.example", "http://tauri.localhost"]')
    assert Settings().cors_origins == ["https://a.example", "http://tauri.localhost"]
    monkeypatch.setenv("ORBIT_CORS_ORIGINS", " https://a.example/ ,http://tauri.localhost,, ")
    assert Settings().cors_origins == ["https://a.example", "http://tauri.localhost"]
