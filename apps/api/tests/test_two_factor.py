"""Two-step sign-in: TOTP maths (RFC 6238 vectors), turning it on, signing in with the second step, no replays,
single-use recovery codes, throttled wrong codes, turning it off, and that a challenge is no session."""

import time
import uuid

import pytest
from fastapi.testclient import TestClient

from orbit_api import ratelimit
from orbit_api.auth import two_factor
from orbit_api.auth.two_factor import code_at, matching_step
from tests.test_google_auth import _sign_in_with_google, google_client  # noqa: F401  (fixture)

PW = "correct horse battery"
RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  # "12345678901234567890" in base32 (RFC 6238 appendix B)


def test_totp_matches_the_rfc_vectors() -> None:
    assert code_at(RFC_SECRET, 59 // 30) == "287082"  # RFC's 94287082, last 6 digits
    assert code_at(RFC_SECRET, 1111111109 // 30) == "081804"
    assert code_at(RFC_SECRET, 1234567890 // 30) == "005924"
    now = 1234567890.0
    assert matching_step(RFC_SECRET, "005924", now) == 1234567890 // 30
    assert matching_step(RFC_SECRET, "005 924", now) == 1234567890 // 30  # spaces are fine
    assert matching_step(RFC_SECRET, "005924", now, after_step=1234567890 // 30) is None  # never twice
    assert matching_step(RFC_SECRET, "005924", now + 300) is None  # long expired


def _account(client: TestClient) -> tuple[str, dict[str, str]]:
    email = f"tf-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": PW})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


def _now_code(secret: str, offset: int = 0) -> str:
    return code_at(secret, int(time.time() // 30) + offset)


def _turn_on(client: TestClient, h: dict[str, str]) -> tuple[str, list[str]]:
    setup = client.post("/v1/auth/2fa/setup", headers=h, json={"password": PW})
    assert setup.status_code == 200, setup.text
    secret = setup.json()["secret"]
    assert setup.json()["otpauth_uri"].startswith("otpauth://totp/Orbit%3A")
    assert client.post("/v1/auth/2fa/enable", headers=h, json={"code": "000000"}).status_code in (400, 200)
    on = client.post("/v1/auth/2fa/enable", headers=h, json={"code": _now_code(secret, -1)})
    if on.status_code == 409:  # "000000" happened to be right: astronomically unlikely, but don't flake
        pytest.skip("random code matched")
    assert on.status_code == 200, on.text
    codes = on.json()["recovery_codes"]
    assert len(codes) == 10 and len(set(codes)) == 10
    return secret, codes


def test_signing_in_takes_the_second_step(client: TestClient) -> None:
    email, h = _account(client)
    assert client.get("/v1/auth/2fa", headers=h).json()["enabled"] is False
    assert client.post("/v1/auth/2fa/setup", headers=h, json={"password": "wrong password!"}).status_code == 403
    secret, _ = _turn_on(client, h)
    assert client.get("/v1/auth/2fa", headers=h).json() | {"enabled_at": None} == {
        "enabled": True, "recovery_left": 10, "enabled_at": None}

    first = client.post("/v1/auth/login", json={"email": email, "password": PW})
    client.cookies.clear()
    assert first.status_code == 200 and first.json()["two_factor_required"] is True
    assert "access_token" not in first.json() and "orbit_session" not in first.headers.get("set-cookie", "")
    challenge = first.json()["challenge"]
    # The challenge isn't a session.
    assert client.get("/v1/auth/me", headers={"Authorization": f"Bearer {challenge}"}).status_code == 401

    code = _now_code(secret)
    done = client.post("/v1/auth/login/2fa", json={"challenge": challenge, "code": code})
    assert done.status_code == 200, done.text
    token = done.json()["access_token"]
    client.cookies.clear()
    assert client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    # The same code again (a replay) doesn't work.
    again = client.post("/v1/auth/login", json={"email": email, "password": PW}).json()["challenge"]
    client.cookies.clear()
    assert client.post("/v1/auth/login/2fa", json={"challenge": again, "code": code}).status_code == 401


def test_recovery_codes_work_once(client: TestClient) -> None:
    email, h = _account(client)
    _, codes = _turn_on(client, h)
    ch = client.post("/v1/auth/login", json={"email": email, "password": PW}).json()["challenge"]
    client.cookies.clear()
    assert client.post("/v1/auth/login/2fa", json={"challenge": ch, "code": codes[0].upper()}).status_code == 200
    client.cookies.clear()
    ch = client.post("/v1/auth/login", json={"email": email, "password": PW}).json()["challenge"]
    client.cookies.clear()
    assert client.post("/v1/auth/login/2fa", json={"challenge": ch, "code": codes[0]}).status_code == 401
    assert client.get("/v1/auth/2fa", headers=h).json()["recovery_left"] == 9


def test_wrong_codes_are_throttled(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
    ratelimit.reset_all()
    email, h = _account(client)
    _turn_on(client, h)
    ch = client.post("/v1/auth/login", json={"email": email, "password": PW}).json()["challenge"]
    client.cookies.clear()
    statuses = [client.post("/v1/auth/login/2fa", json={"challenge": ch, "code": "123456"}).status_code
                for _ in range(7)]
    assert statuses[:5] == [401] * 5 and statuses[-1] == 429
    ratelimit.reset_all()


def test_turning_it_off_needs_a_code(client: TestClient) -> None:
    email, h = _account(client)
    _, codes = _turn_on(client, h)
    assert client.post("/v1/auth/2fa/disable", headers=h, json={"code": "111111"}).status_code == 400
    assert client.post("/v1/auth/2fa/disable", headers=h, json={"code": codes[3]}).status_code == 204
    r = client.post("/v1/auth/login", json={"email": email, "password": PW})
    assert r.status_code == 200 and r.json().get("access_token")  # straight in again
    assert "secret" not in str(client.get("/v1/auth/me/export", headers=h).json().get("two_factor"))


def test_a_challenge_from_before_a_sign_out_everywhere_is_dead(client: TestClient) -> None:
    email, h = _account(client)
    secret, _ = _turn_on(client, h)
    ch = client.post("/v1/auth/login", json={"email": email, "password": PW}).json()["challenge"]
    client.cookies.clear()
    assert client.post("/v1/auth/logout-all", headers=h).status_code == 204
    assert client.post("/v1/auth/login/2fa", json={"challenge": ch, "code": _now_code(secret)}).status_code == 401
    assert two_factor.read_challenge("not a token") is None


def test_a_google_only_account_can_turn_it_on_and_add_a_passkey(google_client: TestClient,  # noqa: F811
                                                                 monkeypatch: pytest.MonkeyPatch) -> None:
    """An account made with Google has no password to type (the web app asks for none), so none is checked: its
    stored hash is a random one nobody knows, which used to refuse every attempt with "That password isn't right"."""
    email = f"tf-google-{uuid.uuid4().hex[:8]}@gmail.com"
    _sign_in_with_google(google_client, monkeypatch, email, f"sub-{email}")
    me = google_client.get("/v1/auth/me").json()
    assert me["has_password"] is False
    h = {"X-CSRF-Token": me["csrf_token"]}
    setup = google_client.post("/v1/auth/2fa/setup", headers=h, json={"password": ""})
    assert setup.status_code == 200, setup.text
    on = google_client.post("/v1/auth/2fa/enable", headers=h, json={"code": _now_code(setup.json()["secret"])})
    assert on.status_code == 200, on.text
    options = google_client.post("/v1/auth/passkeys/options", headers=h, json={"password": ""})
    assert options.status_code == 200, options.text


def test_an_account_with_a_password_still_needs_it(client: TestClient) -> None:
    _, h = _account(client)
    assert client.post("/v1/auth/2fa/setup", headers=h, json={"password": ""}).status_code == 403
    assert client.post("/v1/auth/2fa/setup", headers=h, json={"password": "wrong password 1"}).status_code == 403
    assert client.post("/v1/auth/passkeys/options", headers=h, json={"password": ""}).status_code == 403
    assert client.post("/v1/auth/2fa/setup", headers=h, json={"password": PW}).status_code == 200


def test_a_google_only_account_needs_a_recent_sign_in_instead(google_client: TestClient,  # noqa: F811
                                                              monkeypatch: pytest.MonkeyPatch) -> None:
    """With no password to ask for, a sign-in in the last 15 minutes stands in for it: a session left open (or
    stolen) can't add a passkey (which skips this step and outlives "sign out everywhere") or lock the owner out."""
    from orbit_api.auth.security import create_access_token

    email = f"tf-old-{uuid.uuid4().hex[:8]}@gmail.com"
    _sign_in_with_google(google_client, monkeypatch, email, f"sub-{email}")
    me = google_client.get("/v1/auth/me").json()
    google_client.cookies.clear()

    async def version() -> int:
        from orbit_api.db import sessionmaker
        from orbit_api.models import User

        async with sessionmaker()() as db:
            user = await db.get(User, me["id"])
            assert user is not None
            return user.token_version

    ver = google_client.portal.call(version)  # type: ignore[union-attr]
    old = {"Authorization": "Bearer " + create_access_token(me["id"], ver, signed_in_at=int(time.time()) - 3600)}
    for path in ("/v1/auth/2fa/setup", "/v1/auth/passkeys/options"):
        r = google_client.post(path, headers=old, json={"password": ""})
        assert r.status_code == 403 and "sign in with Google again" in r.json()["detail"], path
    fresh = {"Authorization": "Bearer " + create_access_token(me["id"], ver)}
    assert google_client.post("/v1/auth/passkeys/options", headers=fresh, json={"password": ""}).status_code == 200


def test_wrong_codes_to_turn_it_off_are_throttled_too(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """Turning it off (or new recovery codes) takes a code too. Only the settings limit (1 a second) applied there,
    so a session left open could guess its way through the 6 digits; now 5 wrong codes per 15 minutes, as at
    sign-in (counted apart, so a session can't use them up to block its owner's sign-in)."""
    monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
    ratelimit.reset_all()
    email, h = _account(client)
    secret, _ = _turn_on(client, h)
    statuses = [client.post("/v1/auth/2fa/disable", headers=h, json={"code": "123456"}).status_code
                for _ in range(5)]
    blocked = client.post("/v1/auth/2fa/recovery-codes", headers=h, json={"code": _now_code(secret)})
    assert statuses == [400] * 5 and blocked.status_code == 429
    ch = client.post("/v1/auth/login", json={"email": email, "password": PW}).json()["challenge"]
    client.cookies.clear()
    assert client.post("/v1/auth/login/2fa", json={"challenge": ch, "code": _now_code(secret)}).status_code == 200
    ratelimit.reset_all()
