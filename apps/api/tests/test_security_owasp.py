"""OWASP Top 10 checks beyond access control (A01 lives in tests/test_security_idor.py), through the real HTTP stack.

Covered elsewhere and deliberately not repeated here:
- tests/test_payment_integrity.py: UTRs are ASCII digits (unit level), a deleted account's UTR stays taken, a payment
  is decided once (approving twice credits once) and only with the UTR the admin checked, and the database refuses a
  second grant for one payment.
- tests/test_security_hardening.py: another network's wrong passwords don't lock the owner out, a password change signs
  out other devices, sign-out-everywhere kills a pending email-change link, the common-password list (unit level), the
  sign-up notice name is one line, admin config can't point the AI key elsewhere in production.
- tests/test_launch_security.py: CSRF on privacy/upload/delete, login CSRF, Bearer clients exempt, CAPTCHA.
- tests/test_job_link.py, tests/test_job_link_hardening.py: the SSRF guard at the resolver/transport level.

One app serves the whole module (CSRF on, an explicit admin, UPI configured), so no two apps ever share the DB engine.
Tests that need another setting patch it on the live settings object for their own duration.
"""

import base64
import itertools
import json
import re
import time
import uuid
import warnings
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from orbit_api import ratelimit
from orbit_api.config import get_settings
from orbit_api.prep import job_link
from orbit_api.sessions import companion
from tests.test_email_flows import _last_token
from tests.test_job_link import LD_PAGE
from tests.test_security_idor import approve_leftovers
from tests.test_signup_approval import _client, _outbox

WEB = "http://localhost:5173"
EVIL = "https://evil.example"
PW = "correct horse battery"
UPI = "owner@okicici"
PROXY = "proxy-secret-for-tests-" + "q" * 16


# ---- the app and its callers ---------------------------------------------------------------------------------------


@dataclass
class Api:
    c: TestClient
    admin: dict[str, str]
    admin_email: str


@pytest.fixture(scope="module")
def api() -> Iterator[Api]:
    admin_email = f"owasp-admin-{uuid.uuid4().hex[:8]}@example.com"
    with pytest.MonkeyPatch.context() as mp:
        gen = _client(mp, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_UPI_ID=UPI, ORBIT_CSRF_PROTECTION="true")
        c = next(gen)
        try:
            admin, _ = _bearer(c, admin_email)
            yield Api(c, admin, admin_email)
        finally:
            approve_leftovers(c, "owasp-")
            gen.close()
    get_settings.cache_clear()


def _email(tag: str = "u") -> str:
    return f"owasp-{tag}-{uuid.uuid4().hex[:8]}@example.com"


def _bearer(c: TestClient, email: str | None = None, *, headers: dict[str, str] | None = None,
            password: str = PW, **extra: Any) -> tuple[dict[str, str], dict[str, Any]]:
    """A desktop-style account: Bearer token, no cookie kept."""
    c.cookies.clear()
    r = c.post("/v1/auth/register", headers=headers or {},
               json={"email": email or _email(), "password": password, **extra})
    assert r.status_code == 201, r.text
    c.cookies.clear()
    return {**(headers or {}), "Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]


@dataclass
class Web:
    cookie: str
    csrf: str
    user: dict[str, Any]


def _web(c: TestClient, email: str | None = None) -> Web:
    """A browser-style account: the session lives only in the httpOnly cookie, plus the CSRF token."""
    c.cookies.clear()
    r = c.post("/v1/auth/register", headers={"Origin": WEB}, json={"email": email or _email("web"), "password": PW})
    assert r.status_code == 201 and r.json()["access_token"] is None, r.text
    web = Web(c.cookies["orbit_session"], r.json()["user"]["csrf_token"], r.json()["user"])
    c.cookies.clear()
    return web


def _as(c: TestClient, cookie: str) -> None:
    c.cookies.clear()
    c.cookies.set("orbit_session", cookie)


@pytest.fixture
def limits(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Rate limits on, and callers placed on networks of our choosing the way production does it: the web Worker
    (which knows ORBIT_PROXY_SECRET) states the visitor's IP."""
    ratelimit.reset_all()
    monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
    monkeypatch.setattr(get_settings(), "proxy_secret", SecretStr(PROXY))
    yield
    ratelimit.reset_all()


_nets = itertools.count(uuid.uuid4().int % 10_000)


def _net() -> str:
    n = next(_nets)
    return f"100.{64 + n // 62_500 % 64}.{n // 250 % 250}.{n % 250 + 1}"


def _via(ip: str, h: dict[str, str] | None = None) -> dict[str, str]:
    return {**(h or {}), "X-Orbit-Proxy-Secret": PROXY, "X-Orbit-Client-IP": ip}


# ---- A02 cryptographic failures: cookies, hashes, tokens --------------------------------------------------------


def test_web_sign_in_gets_only_an_httponly_samesite_cookie_and_sign_out_clears_it(api: Api) -> None:
    c = api.c
    email = _email("cookie")
    reg = c.post("/v1/auth/register", headers={"Origin": WEB}, json={"email": email, "password": PW})
    assert reg.status_code == 201
    c.cookies.clear()
    r = c.post("/v1/auth/login", headers={"Origin": WEB}, json={"email": email, "password": PW})
    assert r.status_code == 200 and r.json()["access_token"] is None  # nothing script on the page could steal
    cookie = r.headers["set-cookie"].lower()
    assert cookie.startswith("orbit_session=") and "httponly" in cookie and "samesite=lax" in cookie
    assert "path=/" in cookie and "domain=" not in cookie  # host-only
    max_age = int(re.search(r"max-age=(\d+)", cookie).group(1))  # type: ignore[union-attr]
    assert 0 < max_age <= get_settings().session_idle_hours * 3600

    out = c.post("/v1/auth/logout", headers={"Origin": WEB})
    assert out.status_code == 204
    cleared = out.headers["set-cookie"].lower()
    assert cleared.startswith('orbit_session=""') or cleared.startswith("orbit_session=;")
    assert "max-age=0" in cleared and "httponly" in cleared
    c.cookies.clear()


def test_the_cookie_is_secure_whenever_it_may_travel_cross_site(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "cookie_samesite", "none")
    r = api.c.post("/v1/auth/register", headers={"Origin": WEB}, json={"email": _email("none"), "password": PW})
    api.c.cookies.clear()
    cookie = r.headers["set-cookie"].lower()
    assert "samesite=none" in cookie and "secure" in cookie and "httponly" in cookie


def test_passwords_are_stored_as_argon2id(api: Api) -> None:
    from argon2 import PasswordHasher

    from orbit_api.db import sessionmaker
    from orbit_api.models import User

    _, user = _bearer(api.c)

    async def stored() -> str:
        async with sessionmaker()() as db:
            u = await db.get(User, user["id"])
            assert u is not None
            return u.password_hash

    hashed = api.c.portal.call(stored)  # type: ignore[union-attr]
    assert hashed.startswith("$argon2id$v=19$") and PW not in hashed
    assert PasswordHasher().verify(hashed, PW)


def test_password_hashes_and_token_versions_never_leave_the_server(api: Api) -> None:
    c, admin = api.c, api.admin
    email = _email("leak")
    c.cookies.clear()
    bodies = {"register": c.post("/v1/auth/register", json={"email": email, "password": PW}).text}
    c.cookies.clear()
    login = c.post("/v1/auth/login", json={"email": email, "password": PW})
    bodies["login"] = login.text
    c.cookies.clear()
    bodies["web login"] = c.post("/v1/auth/login", headers={"Origin": WEB}, json={"email": email, "password": PW}).text
    c.cookies.clear()
    h = {"Authorization": f"Bearer {login.json()['access_token']}"}
    uid = login.json()["user"]["id"]
    bodies["me"] = c.get("/v1/auth/me", headers=h).text
    bodies["privacy"] = c.patch("/v1/auth/me/privacy", headers=h, json={"store_transcripts": True}).text
    bodies["export"] = c.get("/v1/auth/me/export", headers=h).text
    bodies["entitlements"] = c.get("/v1/entitlements", headers=h).text
    bodies["admin users"] = c.get("/v1/admin/users", headers=admin, params={"q": email}).text
    bodies["admin activity"] = c.get(f"/v1/admin/users/{uid}/activity", headers=admin).text
    bodies["admin credits"] = c.post(f"/v1/admin/users/{uid}/credits", headers=admin, json={"resume": 1}).text
    assert email in bodies["admin users"] and '"account"' in bodies["export"]
    for name, body in bodies.items():
        for secret in ("$argon2", "password_hash", "token_version", PW):
            assert secret not in body, f"{name} response contains {secret!r}"


def _b64(obj: dict[str, Any]) -> str:
    return base64.urlsafe_b64encode(json.dumps(obj, separators=(",", ":")).encode()).rstrip(b"=").decode()


def _token(kind: str, user_id: str) -> str:
    secret = get_settings().jwt_secret.get_secret_value()
    now = int(time.time())
    claims = {"sub": user_id, "ver": 0, "iat": now, "exp": now + 3600, "auth": now, "idle": False,
              "jti": uuid.uuid4().hex}
    if kind == "valid":
        return jwt.encode(claims, secret, algorithm="HS256")
    if kind == "alg_none":
        return f"{_b64({'alg': 'none', 'typ': 'JWT'})}.{_b64(claims)}."
    if kind == "alg_None_with_signature":
        return f"{_b64({'alg': 'None', 'typ': 'JWT'})}.{_b64(claims)}.{jwt.encode(claims, secret).split('.')[2]}"
    if kind == "wrong_secret":
        return jwt.encode(claims, "an-attackers-own-secret-" + "k" * 48, algorithm="HS256")
    if kind == "hs512_with_the_server_secret":
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # PyJWT warns that the key is short for SHA-512
            return jwt.encode(claims, secret, algorithm="HS512")
    if kind == "expired":
        return jwt.encode({**claims, "iat": now - 7200, "exp": now - 60}, secret, algorithm="HS256")
    if kind == "no_expiry":
        return jwt.encode({k: v for k, v in claims.items() if k != "exp"}, secret, algorithm="HS256")
    if kind == "stale_token_version":
        return jwt.encode({**claims, "ver": 1}, secret, algorithm="HS256")
    if kind == "unknown_user":
        return jwt.encode({**claims, "sub": str(uuid.uuid4())}, secret, algorithm="HS256")
    if kind == "payload_swapped_under_a_valid_signature":
        header, _, sig = jwt.encode({**claims, "sub": str(uuid.uuid4())}, secret, algorithm="HS256").split(".")
        return f"{header}.{_b64(claims)}.{sig}"
    if kind == "signature_stripped":
        return jwt.encode(claims, secret, algorithm="HS256").rsplit(".", 1)[0] + "."
    raise AssertionError(kind)


FORGED = ["alg_none", "alg_None_with_signature", "wrong_secret", "hs512_with_the_server_secret", "expired",
          "no_expiry", "stale_token_version", "unknown_user", "payload_swapped_under_a_valid_signature",
          "signature_stripped"]


@pytest.mark.parametrize("kind", FORGED)
def test_forged_or_expired_tokens_are_refused_as_bearer_and_as_cookie(api: Api, kind: str) -> None:
    c = api.c
    _, user = _bearer(c)
    token = _token(kind, user["id"])
    assert c.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    _as(c, token)
    assert c.get("/v1/auth/me").status_code == 401
    c.cookies.clear()


def test_the_forging_harness_itself_makes_a_working_token(api: Api) -> None:
    c = api.c
    _, user = _bearer(c)
    token = _token("valid", user["id"])
    assert c.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["id"] == user["id"]
    _as(c, token)
    assert c.get("/v1/auth/me").json()["id"] == user["id"]
    c.cookies.clear()


# ---- A03 injection -------------------------------------------------------------------------------------------------

SQLISH = ["' OR '1'='1", "' OR 1=1 --", "%", "_", "%%_%%", "\\", "'; DROP TABLE users; --", '" OR ""="',
          "admin%' --", "') UNION SELECT password_hash FROM users --", "*"]


@pytest.mark.parametrize("q", SQLISH, ids=[repr(q) for q in SQLISH])
def test_admin_user_search_treats_sql_and_wildcards_as_plain_text(api: Api, q: str) -> None:
    r = api.c.get("/v1/admin/users", headers=api.admin, params={"q": q})
    assert r.status_code == 200, r.text
    assert r.json()["users"] == []  # nobody's email or name contains these: a literal search finds nobody
    assert "$argon2" not in r.text
    assert api.c.get("/v1/admin/users", headers=api.admin).json()["users"]  # the table is still there


def test_admin_user_search_still_finds_by_exact_text(api: Api) -> None:
    _, user = _bearer(api.c, _email("Findable"))
    r = api.c.get("/v1/admin/users", headers=api.admin, params={"q": user["email"].upper()})
    assert [u["id"] for u in r.json()["users"]] == [user["id"]]


@pytest.mark.parametrize(("path", "params"), [
    ("/v1/admin/users", {"only": "all' OR '1'='1"}), ("/v1/admin/users", {"limit": "1; DROP TABLE users"}),
    ("/v1/admin/users", {"limit": "100000"}), ("/v1/admin/users", {"q": "x" * 500}),
    ("/v1/admin/payments", {"only": "submitted' --"}), ("/v1/admin/latency", {"days": "7 OR 1=1"}),
    ("/v1/admin/costs", {"days": "-1"}), ("/v1/admin/feedback", {"days": "1e9"}),
])
def test_list_filters_only_accept_their_declared_values(api: Api, path: str, params: dict[str, str]) -> None:
    r = api.c.get(path, headers=api.admin, params=params)
    assert r.status_code == 422 and r.headers["content-type"].startswith("application/json")


PATH_PAYLOADS = ["1' OR '1'='1", "1 OR 1=1", "'; DROP TABLE documents; --", '" OR ""="',
                 "1 UNION SELECT password_hash FROM users"]


@pytest.mark.parametrize("payload", PATH_PAYLOADS)
@pytest.mark.parametrize("template", ["/v1/documents/{}/text", "/v1/resumes/{}", "/v1/workspaces/{}",
                                      "/v1/sessions/{}", "/v1/sessions/{}/export.md"])
def test_sql_in_path_ids_is_just_an_id_that_doesnt_exist(api: Api, template: str, payload: str) -> None:
    h, _ = _bearer(api.c)
    r = api.c.get(template.format(quote(payload, safe="")), headers=h)
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/json"), r.text


MARKUP = ['<script>alert(document.cookie)</script>', '"><img src=x onerror=alert(1)>', "{{7*7}} ${7*7} <%= 7*7 %>",
          "javascript:alert(1)//"]


@pytest.mark.parametrize("payload", MARKUP)
def test_markup_in_names_and_titles_comes_back_as_inert_json(api: Api, payload: str) -> None:
    c = api.c
    h, user = _bearer(c, name=payload)
    assert user["name"] == payload  # stored and returned verbatim: not rendered, not template-evaluated
    created = {
        "workspace": c.post("/v1/workspaces", headers=h, json={"name": payload, "company": payload}),
        "story": c.post("/v1/stories", headers=h, json={"title": payload, "action": payload}),
        "document": c.post("/v1/documents/text", headers=h, json={"title": payload, "kind": "notes",
                                                                    "text": payload + " " * 20 + "notes"}),
        "session": c.post("/v1/sessions", headers=h, json={"title": payload, "role": payload}),
    }
    for name, r in created.items():
        assert r.status_code == 201, (name, r.text)
        assert r.headers["content-type"] == "application/json" and r.headers["x-content-type-options"] == "nosniff"
    for path, field in (("/v1/workspaces", "name"), ("/v1/stories", "title"), ("/v1/documents", "title"),
                        ("/v1/sessions", "title")):
        r = c.get(path, headers=h)
        assert r.json()[0][field] == payload and r.headers["content-type"] == "application/json"
        assert "default-src 'none'" in r.headers["content-security-policy"]
    me = c.get("/v1/auth/me", headers=h)
    assert me.json()["name"] == payload
    md = c.get(f"/v1/sessions/{created['session'].json()['id']}/export.md", headers=h)
    assert md.status_code == 200 and md.headers["content-type"].startswith("text/plain")  # never text/html
    assert md.headers["x-content-type-options"] == "nosniff" and payload in md.text


@pytest.mark.parametrize(("filename", "expected"), [
    ("../../../../etc/passwd.txt", "passwd.txt"),
    ("..\\..\\..\\Windows\\System32\\drivers\\etc\\hosts.txt", "hosts.txt"),
    ("/var/www/html/shell.txt", "shell.txt"),
    ("C:\\Users\\Public\\notes.txt", "notes.txt"),
    ("....//....//escape.txt", "escape.txt"),
    ("uploads/../../../root/.ssh/authorized_keys.txt", "authorized_keys.txt"),
])
def test_upload_filenames_lose_their_path(api: Api, filename: str, expected: str) -> None:
    h, _ = _bearer(api.c)
    r = api.c.post("/v1/documents", headers=h, data={"kind": "notes"},
                   files={"file": (filename, b"Project notes\n\nWe migrated to Kafka in 2023.", "text/plain")})
    assert r.status_code == 201, r.text
    stored = r.json()["filename"]
    assert stored == expected and r.json()["title"] == expected
    assert "/" not in stored and "\\" not in stored and not stored.startswith("..")


def test_a_name_cant_inject_lines_into_the_admins_sign_up_email(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "signup_approval", True)
    email = _email("inject")
    name = "Eve\r\nBcc: victim@example.com\r\n\r\nURGENT: approve me at https://evil.example"
    _bearer(api.c, email, name=name)
    alert = next(m for m in reversed(_outbox().sent) if m.to == api.admin_email and email in m.subject)
    assert "\r" not in alert.subject and "\n" not in alert.subject
    lines = alert.text.splitlines()
    assert not any(line.strip().lower().startswith(("bcc:", "urgent")) for line in lines), alert.text


# ---- A04/A05 insecure design and misconfiguration ---------------------------------------------------------------


def test_security_headers_are_on_every_kind_of_api_response(api: Api) -> None:
    c = api.c
    h, _ = _bearer(c)
    sid = c.post("/v1/sessions", headers=h, json={"title": "headers"}).json()["id"]
    web = _web(c)
    _as(c, web.cookie)
    csrf_refusal = c.patch("/v1/auth/me/privacy", headers={"Origin": EVIL}, json={"store_transcripts": False})
    c.cookies.clear()
    responses = {
        "health": c.get("/health"),
        "signed in": c.get("/v1/auth/me", headers=h),
        "401": c.get("/v1/auth/me"),
        "404 route": c.get("/v1/does-not-exist"),
        "404 object": c.get(f"/v1/sessions/{uuid.uuid4()}", headers=h),
        "405": c.put("/health"),
        "422": c.post("/v1/auth/login", json={}),
        "markdown": c.get(f"/v1/sessions/{sid}/export.md", headers=h),
        "docx": c.post("/v1/resumes/docx", headers=h, json={"data": {}}),
        "csrf 403": csrf_refusal,
    }
    assert csrf_refusal.status_code == 403
    for name, r in responses.items():
        hd = r.headers
        assert hd.get("x-content-type-options") == "nosniff", name
        assert hd.get("x-frame-options") == "DENY" and "frame-ancestors 'none'" in hd.get("content-security-policy",
                                                                                          ""), name
        assert hd.get("referrer-policy") == "no-referrer" and hd.get("cache-control") == "no-store", name
        if name not in ("markdown", "docx"):
            assert hd["content-type"] == "application/json", (name, hd["content-type"])


@pytest.mark.parametrize("origin", [EVIL, "null", "http://localhost:5173.evil.example", "https://localhost:5173",
                                    "http://evil.localhost:5173", "http://localhost:5174", "tauri://evil"])
def test_cors_never_reflects_a_foreign_origin(api: Api, origin: str) -> None:
    c = api.c
    h, _ = _bearer(c)
    simple = c.get("/v1/auth/me", headers={**h, "Origin": origin})
    # (Starlette always adds Allow-Credentials; without Allow-Origin the browser still hides the response.)
    assert "access-control-allow-origin" not in simple.headers
    pre = c.options("/v1/sessions", headers={"Origin": origin, "Access-Control-Request-Method": "POST",
                                             "Access-Control-Request-Headers": "authorization,content-type"})
    assert pre.headers.get("access-control-allow-origin") in (None, ""), pre.headers
    assert pre.status_code >= 400


def test_cors_allows_the_real_frontend_with_credentials(api: Api) -> None:
    r = api.c.get("/v1/plans", headers={"Origin": WEB})
    assert r.headers["access-control-allow-origin"] == WEB and r.headers["access-control-allow-credentials"] == "true"


# State-changing requests a hostile page could make the browser send with the session cookie attached.
CSRF_TARGETS: list[tuple[str, str, dict[str, Any]]] = [
    ("PATCH", "/v1/auth/me/privacy", {"json": {"store_transcripts": False}}),
    ("POST", "/v1/sessions", {"json": {"title": "forged"}}),
    ("POST", "/v1/documents/text", {"json": {"title": "forged", "kind": "notes", "text": "forged text " * 4}}),
    ("PUT", "/v1/workspaces/{workspace}", {"json": {"name": "forged"}}),
    ("DELETE", "/v1/workspaces/{workspace}", {}),
    ("POST", "/v1/billing/upi/orders", {"json": {"pack": "starter"}}),
    ("POST", "/v1/auth/logout-all", {}),
    ("POST", "/v1/auth/me/password", {"json": {"current_password": PW, "new_password": "a forged new passphrase"}}),
    ("POST", "/v1/auth/me/email", {"json": {"new_email": "thief@example.com", "password": PW}}),
    ("DELETE", "/v1/auth/me", {"json": {"password": PW}}),
]


def _cookie_state(c: TestClient, web: Web, workspace: str) -> dict[str, Any]:
    _as(c, web.cookie)
    me = c.get("/v1/auth/me")
    state = {"me": me.status_code, "transcripts": me.json().get("store_transcripts"),
             "sessions": c.get("/v1/sessions").json(), "documents": c.get("/v1/documents").json(),
             "workspace": c.get(f"/v1/workspaces/{workspace}").json(), "orders": c.get("/v1/billing/upi/orders").json()}
    c.cookies.clear()
    return state


@pytest.mark.parametrize(("method", "path", "kw"), CSRF_TARGETS, ids=[f"{m} {p}" for m, p, _ in CSRF_TARGETS])
def test_cookie_requests_without_the_csrf_token_or_from_a_foreign_site_change_nothing(
        api: Api, method: str, path: str, kw: dict[str, Any]) -> None:
    c = api.c
    web = _web(c)
    _as(c, web.cookie)
    ws = c.post("/v1/workspaces", headers={"Origin": WEB, "X-CSRF-Token": web.csrf}, json={"name": "mine"})
    assert ws.status_code == 201, ws.text  # the real app, with its token, works
    workspace = ws.json()["id"]
    before = _cookie_state(c, web, workspace)
    url = path.replace("{workspace}", workspace)
    for headers, code in (({"Origin": WEB}, "csrf_token"),  # no token
                          ({"Origin": WEB, "X-CSRF-Token": "forged"}, "csrf_token"),
                          ({"Origin": EVIL, "X-CSRF-Token": web.csrf}, "csrf_origin"),  # a token can't be read, but
                          ({"Referer": f"{EVIL}/attack.html", "X-CSRF-Token": web.csrf}, "csrf_origin"),
                          ({"Origin": "null", "X-CSRF-Token": web.csrf}, "csrf_origin"),  # sandboxed iframe
                          ({"X-CSRF-Token": web.csrf}, "csrf_origin")):  # no Origin or Referer at all
        _as(c, web.cookie)
        r = c.request(method, url, headers=headers, **kw)
        assert r.status_code == 403, (headers, r.status_code, r.text)
        assert r.json()["error"]["code"] == code, (headers, r.text)
    assert _cookie_state(c, web, workspace) == before


def test_a_csrf_token_only_works_with_its_own_session(api: Api) -> None:
    c = api.c
    alice, mallory = _web(c), _web(c)
    _as(c, alice.cookie)
    r = c.patch("/v1/auth/me/privacy", headers={"Origin": WEB, "X-CSRF-Token": mallory.csrf},
                json={"store_transcripts": False})
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_token"
    _as(c, alice.cookie)
    assert c.get("/v1/auth/me").json()["store_transcripts"] is True
    c.cookies.clear()


def test_a_junk_bearer_header_doesnt_unlock_the_cookie_without_csrf(api: Api) -> None:
    """Bearer requests skip the CSRF check, so a request carrying the victim's cookie plus any 'Bearer' header must be
    authenticated by that header alone, never fall back to the cookie."""
    c = api.c
    web = _web(c)
    for junk in ("Bearer x", "bearer ", "Bearer " + web.csrf):
        _as(c, web.cookie)
        r = c.patch("/v1/auth/me/privacy", headers={"Authorization": junk, "Origin": EVIL},
                    json={"store_transcripts": False})
        assert r.status_code in (401, 403), (junk, r.status_code, r.text)  # never the cookie's 200
    _as(c, web.cookie)
    assert c.get("/v1/auth/me").json()["store_transcripts"] is True
    c.cookies.clear()


def test_unexpected_errors_dont_leak_internals(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api import entitlements
    from orbit_api.main import create_app

    def boom() -> None:
        raise RuntimeError("SECRET-INTERNAL-DETAIL in C:\\srv\\orbit_api\\billing\\routes.py password=hunter2")

    monkeypatch.setattr(entitlements, "public_plans", boom)
    c = TestClient(create_app(), raise_server_exceptions=False)  # no lifespan: this route touches nothing else
    r = c.get("/v1/plans")
    assert r.status_code == 500
    for leak in ("SECRET", "Traceback", "RuntimeError", "routes.py", "hunter2", 'File "'):
        assert leak not in r.text, r.text
    nf = c.get("/v1/nope")
    assert nf.status_code == 404 and nf.json() == {"detail": "Not Found"}


def test_production_serves_no_api_docs_or_schema_and_sets_hsts(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api import main

    prod = get_settings().model_copy(update={"env": "production"})  # this app only: the module's app stays as it is
    monkeypatch.setattr(main, "get_settings", lambda: prod)
    c = TestClient(main.create_app())  # no lifespan: production would want Postgres
    for path in ("/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"):
        assert c.get(path).status_code == 404, path
    r = c.get("/v1/plans")
    assert r.status_code == 200 and "max-age=" in r.headers["strict-transport-security"]


# ---- A07 identification and authentication failures ---------------------------------------------------------------


def _login(c: TestClient, email: str, password: str, ip: str, **headers: str) -> httpx.Response:
    c.cookies.clear()
    r = c.post("/v1/auth/login", headers={**_via(ip), **headers}, json={"email": email, "password": password})
    c.cookies.clear()
    return r


def test_password_guessing_from_one_network_is_cut_off_without_an_oracle(api: Api, limits: None) -> None:
    email = _email("guess")
    _bearer(api.c, email, headers=_via(_net()))
    attacker = _net()
    codes = [_login(api.c, email, f"wrong guess {i}", attacker).status_code for i in range(10)]
    assert codes == [401] * 10
    wrong, right = _login(api.c, email, "wrong guess 11", attacker), _login(api.c, email, PW, attacker)
    assert wrong.status_code == right.status_code == 429  # the right password, while blocked, looks the same
    assert wrong.json() == right.json() and "access_token" not in right.text


def test_spoofed_forwarded_for_entries_dont_buy_fresh_login_attempts(api: Api, limits: None) -> None:
    """With the proxy secret set, a direct caller is keyed by the right-most X-Forwarded-For hop (the one the host's
    edge appended); whatever it writes to the left is ignored."""
    email = _email("spoof")
    _bearer(api.c, email, headers=_via(_net()))
    edge = _net()
    codes = []
    for i in range(14):
        api.c.cookies.clear()
        r = api.c.post("/v1/auth/login", headers={"X-Forwarded-For": f"{_net()}, 10.{i}.0.1, {edge}"},
                       json={"email": email, "password": f"wrong guess {i}"})
        codes.append(r.status_code)
    api.c.cookies.clear()
    assert 429 in codes[:11], codes


def test_guessing_spread_over_many_networks_hits_the_per_account_cap(api: Api, limits: None) -> None:
    email = _email("spread")
    _bearer(api.c, email, headers=_via(_net()))
    codes = [_login(api.c, email, f"wrong guess {i}", _net()).status_code for i in range(60)]
    assert codes == [401] * 60  # one guess per network: no per-network limit is ever reached
    assert _login(api.c, email, PW, _net()).status_code == 429  # but the account as a whole is now locked


def test_wrong_current_passwords_on_a_signed_in_account_are_throttled(api: Api, limits: None) -> None:
    """A stolen session can't be used to guess the account's password (password change, email change, delete)."""
    h, _ = _bearer(api.c, headers=_via(_net()))
    tries = []
    for i in range(5):
        r = api.c.post("/v1/auth/me/password", headers=_via(_net(), h),
                       json={"current_password": f"guess number {i}", "new_password": "a brand new phrase 7"})
        tries.append(r.status_code)
    assert tries == [403] * 5
    for method, path, body in (("POST", "/v1/auth/me/password",
                                {"current_password": PW, "new_password": "a brand new phrase 7"}),
                               ("POST", "/v1/auth/me/email", {"new_email": _email("new"), "password": PW}),
                               ("DELETE", "/v1/auth/me", {"password": PW})):
        r = api.c.request(method, path, headers=_via(_net(), h), json=body)
        assert r.status_code == 429, (path, r.status_code, r.text)
    assert api.c.get("/v1/auth/me", headers=h).status_code == 200  # nothing changed, still signed in


def test_emailed_tokens_are_single_use_and_bound_to_their_purpose(api: Api) -> None:
    c = api.c
    email = _email("tokens")
    h, _ = _bearer(c, email)
    verify = _last_token(email, "/verify-email")
    assert c.post("/v1/auth/password-reset/request", json={"email": email}).status_code == 202
    reset = _last_token(email, "/reset-password")
    # a link of one kind never works as another
    assert c.post("/v1/auth/password-reset/confirm", json={"token": verify, "password": "brand new phrase 22"}
                  ).status_code == 400
    for path in ("/v1/auth/verify-email/confirm", "/v1/auth/email-change/confirm"):
        assert c.post(path, json={"token": reset}).status_code == 400
    # each works once
    assert c.post("/v1/auth/verify-email/confirm", json={"token": verify}).status_code == 200
    assert c.post("/v1/auth/verify-email/confirm", json={"token": verify}).status_code == 400
    ok = c.post("/v1/auth/password-reset/confirm", json={"token": reset, "password": "brand new phrase 22"})
    assert ok.status_code == 200
    again = c.post("/v1/auth/password-reset/confirm", json={"token": reset, "password": "another phrase 333"})
    assert again.status_code == 400
    c.cookies.clear()
    assert c.get("/v1/auth/me", headers=h).status_code == 401  # the reset signed the old token out
    assert _login(c, email, "brand new phrase 22", "127.0.0.1").status_code == 200


def test_sign_out_everywhere_kills_bearer_cookie_csrf_token_and_reset_links(api: Api) -> None:
    c = api.c
    web = _web(c)
    email = web.user["email"]
    desktop = c.post("/v1/auth/login", json={"email": email, "password": PW}).json()["access_token"]
    c.cookies.clear()
    assert c.post("/v1/auth/password-reset/request", json={"email": email}).status_code == 202
    reset = _last_token(email, "/reset-password")

    _as(c, web.cookie)
    assert c.post("/v1/auth/logout-all", headers={"Origin": WEB, "X-CSRF-Token": web.csrf}).status_code == 204
    _as(c, web.cookie)
    assert c.get("/v1/auth/me").status_code == 401
    c.cookies.clear()
    assert c.get("/v1/auth/me", headers={"Authorization": f"Bearer {desktop}"}).status_code == 401
    assert c.post("/v1/auth/password-reset/confirm", json={"token": reset, "password": "brand new phrase 22"}
                  ).status_code == 400

    again = c.post("/v1/auth/login", headers={"Origin": WEB}, json={"email": email, "password": PW})
    fresh = again.json()["user"]["csrf_token"]
    assert fresh != web.csrf
    r = c.patch("/v1/auth/me/privacy", headers={"Origin": WEB, "X-CSRF-Token": web.csrf},
                json={"store_transcripts": False})
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_token"  # the old token died with the session
    c.cookies.clear()


def test_sign_out_everywhere_revokes_phone_share_codes(api: Api) -> None:
    """A stolen session can mint a phone share code for a session that isn't live yet. After the owner signs out
    everywhere, that code must stop working; otherwise the thief's phone follows the owner's next live interview
    (transcript and answers) for up to 4 hours."""
    c = api.c
    h, _ = _bearer(c)
    sid = c.post("/v1/sessions", headers=h, json={"title": "tomorrow's onsite"}).json()["id"]
    code = c.post(f"/v1/sessions/{sid}/companion", headers=h).json()["code"]
    assert c.post("/v1/auth/logout-all", headers=h).status_code == 204
    c.cookies.clear()
    r = c.post("/v1/companion/redeem", json={"code": code})
    companion.stop_sharing(sid)
    assert r.status_code == 404, f"share code survived sign-out-everywhere: {r.status_code} {r.text}"


@pytest.mark.parametrize("password", ["password123", "PASSWORD123", "Password1234", "1234567890", "qwertyuiop",
                                      "aaaaaaaaaaaa", "abababababab", "{local}2024!!"])
def test_common_or_personal_passwords_are_refused_at_sign_up(api: Api, password: str) -> None:
    local = f"jordan{uuid.uuid4().hex[:6]}"
    api.c.cookies.clear()
    r = api.c.post("/v1/auth/register", json={"email": f"{local}@example.com",
                                              "password": password.replace("{local}", local)})
    api.c.cookies.clear()
    assert r.status_code == 422, r.text
    assert api.c.post("/v1/auth/login", json={"email": f"{local}@example.com",
                                              "password": password.replace("{local}", local)}).status_code == 401
    api.c.cookies.clear()


def test_common_passwords_are_refused_on_reset_and_change_too(api: Api) -> None:
    c = api.c
    email = _email("weak")
    h, _ = _bearer(c, email)
    weak = c.post("/v1/auth/me/password", headers=h, json={"current_password": PW, "new_password": "password1234"})
    assert weak.status_code == 422
    assert c.post("/v1/auth/password-reset/request", json={"email": email}).status_code == 202
    reset = _last_token(email, "/reset-password")
    assert c.post("/v1/auth/password-reset/confirm", json={"token": reset, "password": "qwertyuiop1"}
                  ).status_code == 422
    assert c.get("/v1/auth/me", headers=h).status_code == 200  # the refused attempt changed nothing
    ok = c.post("/v1/auth/password-reset/confirm", json={"token": reset, "password": "a sturdy new phrase 9"})
    assert ok.status_code == 200  # and didn't burn the link
    c.cookies.clear()


# ---- A08 software and data integrity: UPI payments ------------------------------------------------------------------

LOOKALIKES = ["𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗𝟎𝟏𝟐", "１２３４５６７８９０１２", "١٢٣٤٥٦٧٨٩٠١٢", "۱۲۳۴۵۶۷۸۹۰۱۲", "१२३४५६७८९०१२",
             "1２3456789012", "12345678901O", "123456789012345", "1e11", "0x1CBE991A14", "١23456789012"]


def _order(c: TestClient, h: dict[str, str], pack: str = "starter") -> str:
    r = c.post("/v1/billing/upi/orders", headers=h, json={"pack": pack})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


def test_lookalike_or_malformed_utrs_are_refused_over_http(api: Api) -> None:
    c = api.c
    h, _ = _bearer(c)
    order = _order(c, h)
    for utr in LOOKALIKES:
        r = c.post(f"/v1/billing/upi/orders/{order}/utr", headers=h, json={"utr": utr})
        assert r.status_code == 422, (utr, r.status_code, r.text)
    assert c.get("/v1/billing/upi/orders", headers=h).json()[0]["status"] == "awaiting_payment"


def test_a_utr_cant_be_claimed_twice_by_reformatting_it(api: Api) -> None:
    c = api.c
    payer, _ = _bearer(c)
    utr = f"{uuid.uuid4().int % 10**12:012d}"
    assert c.post(f"/v1/billing/upi/orders/{_order(c, payer)}/utr", headers=payer, json={"utr": utr}).status_code == 200
    other, _ = _bearer(c)
    theirs = _order(c, other)
    # the same 12 digits, dressed up: spaces, dashes, invisible characters, a lookalike digit that normalizing drops
    for variant in (f"{utr[:4]} {utr[4:8]} {utr[8:]}", f"{utr[:4]}-{utr[4:8]}-{utr[8:]}", f" {utr} ",
                    f"{utr[:6]}\u200b{utr[6:]}", f"\u2060{utr}", f"𝟏{utr}"):
        r = c.post(f"/v1/billing/upi/orders/{theirs}/utr", headers=other, json={"utr": variant})
        assert r.status_code == 409, (variant, r.status_code, r.text)
    assert c.get("/v1/billing/upi/orders", headers=other).json()[0]["status"] == "awaiting_payment"


# ---- A10 server-side request forgery ---------------------------------------------------------------------------------


def _offline_fetch(monkeypatch: pytest.MonkeyPatch, dns: dict[str, list[str]],
                   page: Callable[[httpx.Request], httpx.Response] | None = None) -> list[httpx.Request]:
    """The import-link route with a fake resolver and transport: nothing leaves the machine, and every connection
    the guard would have allowed is recorded."""
    seen: list[httpx.Request] = []
    real = job_link.fetch_job_posting

    async def resolve(host: str, port: int) -> list[str]:
        if host not in dns:
            raise OSError(f"no such host {host}")
        return dns[host]

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return page(req) if page else httpx.Response(200, text=LD_PAGE, headers={"content-type": "text/html"})

    async def guarded(url: str) -> job_link.JobPosting:
        return await real(url, resolve=resolve, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(job_link, "fetch_job_posting", guarded)
    return seen


INTERNAL_URLS = [
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://localhost/admin",
    "http://[::1]/",
    "http://[64:ff9b::a9fe:a9fe]/latest/meta-data/",
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    "http://[fd00:ec2::254]/latest/meta-data/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://0.0.0.0/",
    "https://rebind.example/job",
]
DNS = {"metadata.google.internal": ["169.254.169.254"], "localhost": ["127.0.0.1", "::1"],
       "rebind.example": ["93.184.216.34", "169.254.169.254"], "jobs.example": ["93.184.216.34"],
       "internal.example": ["10.0.0.7"]}


@pytest.mark.parametrize("url", INTERNAL_URLS)
def test_job_link_import_refuses_internal_and_metadata_addresses(api: Api, monkeypatch: pytest.MonkeyPatch,
                                                                 url: str) -> None:
    seen = _offline_fetch(monkeypatch, DNS)
    h, _ = _bearer(api.c)
    r = api.c.post("/v1/prep/import-link", headers=h, json={"url": url})
    assert r.status_code == 422 and "private address" in r.json()["detail"], r.text
    assert seen == []  # refused before any connection was made


@pytest.mark.parametrize("target", ["http://169.254.169.254/latest/meta-data/", "http://internal.example/admin",
                                    "http://[::1]:80/", "http://127.0.0.1/"])
def test_job_link_import_refuses_a_redirect_into_the_internal_network(api: Api, monkeypatch: pytest.MonkeyPatch,
                                                                      target: str) -> None:
    seen = _offline_fetch(monkeypatch, DNS, lambda req: httpx.Response(302, headers={"location": target}))
    h, _ = _bearer(api.c)
    r = api.c.post("/v1/prep/import-link", headers=h, json={"url": "https://jobs.example/role/42"})
    assert r.status_code == 422 and "private address" in r.json()["detail"], r.text
    assert [req.url.host for req in seen] == ["93.184.216.34"]  # only the public hop was ever contacted


def test_job_link_import_still_reads_a_public_page(api: Api, monkeypatch: pytest.MonkeyPatch) -> None:
    seen = _offline_fetch(monkeypatch, DNS)
    h, _ = _bearer(api.c)
    r = api.c.post("/v1/prep/import-link", headers=h, json={"url": "https://jobs.example/role/42"})
    assert r.status_code == 200 and r.json()["title"] == "Senior Security Engineer", r.text
    assert seen[0].headers["host"] == "jobs.example"  # pinned to the checked address, named in Host


# ---- rate and cost abuse ---------------------------------------------------------------------------------------------

# Routes that spend paid-provider money (LLM, STT) or make outbound fetches, with their per-user burst.
AI_ROUTES: list[tuple[str, str, dict[str, Any], int]] = [
    ("POST", "/v1/prep", {"json": {}}, 5),
    ("POST", "/v1/prep/import-link", {"json": {}}, 8),
    ("POST", "/v1/stories/draft", {"json": {}}, 5),
    ("POST", "/v1/resumes/import", {"json": {}}, 10),
    ("POST", "/v1/resumes/import-file", {}, 10),
    ("POST", "/v1/resumes/suggest", {"json": {}}, 10),
    ("POST", "/v1/resumes/cover-letter", {"json": {}}, 10),
    ("POST", "/v1/sessions", {"json": {}}, 10),
    ("POST", "/v1/sessions/{sid}/drill", {}, 10),
    ("POST", "/v1/sessions/{sid}/review", {}, 3),
    ("POST", "/v1/sessions/{sid}/report/retry", {}, 3),
    ("POST", "/v1/sessions/{sid}/follow-up", {}, 3),
    ("POST", "/v1/sessions/{sid}/screenshots", {}, 10),
    ("POST", "/v1/sessions/{sid}/live-ticket", {}, 20),
]
AI_IDS = [f"{m} {p}" for m, p, _, _ in AI_ROUTES]


@pytest.mark.parametrize(("method", "path", "kw", "burst"), AI_ROUTES, ids=AI_IDS)
def test_ai_routes_require_a_session(api: Api, method: str, path: str, kw: dict[str, Any], burst: int) -> None:
    api.c.cookies.clear()
    r = api.c.request(method, path.replace("{sid}", str(uuid.uuid4())), **kw)
    assert r.status_code == 401, r.text


@pytest.mark.parametrize(("method", "path", "kw", "burst"), AI_ROUTES, ids=AI_IDS)
def test_ai_routes_are_rate_limited_per_user_whatever_the_network(api: Api, limits: None, method: str, path: str,
                                                                  kw: dict[str, Any], burst: int) -> None:
    c = api.c
    h, _ = _bearer(c, headers=_via(_net()))
    url = path.replace("{sid}", str(uuid.uuid4()))  # cheap requests (404/422): the limiter runs before any work
    codes = [c.request(method, url, headers=_via(_net(), h), **kw).status_code for _ in range(burst + 3)]
    assert 429 not in codes[:burst - 1], codes
    assert 429 in codes[: burst + 2], f"one user on {burst + 3} networks was never limited: {codes}"
    fresh, _ = _bearer(c, headers=_via(_net()))
    assert c.request(method, url, headers=_via(_net(), fresh), **kw).status_code != 429  # per user, not global


def test_preflight_refresh_cant_be_used_to_force_unlimited_provider_pings(api: Api, limits: None,
                                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    """`GET /v1/preflight?refresh=true` drops the shared check cache, so each call pings the LLM (a paid request on the
    shared key) and Deepgram again. Only a per-IP limit stands in front of it: one account on many networks can keep
    the provider busy, or trip its rate limits for every live interview."""
    from orbit_api import preflight

    pings: list[int] = []
    real = preflight._llm_check

    async def counted() -> Any:
        pings.append(1)
        return await real()

    monkeypatch.setattr(preflight, "_llm_check", counted)
    h, _ = _bearer(api.c, headers=_via(_net()))
    codes = [api.c.get("/v1/preflight", params={"refresh": "true"}, headers=_via(_net(), h)).status_code
             for _ in range(20)]
    assert len(pings) <= 6, f"one user forced {len(pings)} provider pings in 20 calls ({codes})"
