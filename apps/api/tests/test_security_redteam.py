"""Red-team findings of 18 Oct 2026 (docs/SECURITY_REVIEW.md, "Red team"), each pinned by the attack that worked:

- RT-01: a password reset signed straight in, skipping two-step sign-in (the inbox alone was enough);
- RT-02: pre-account takeover: whoever registered someone's address first (never verifying it) could add a passkey
  that still opened the account after the real owner proved the inbox and took it over;
- RT-03: the wrong-password and wrong-code throttles were check-then-count, so guesses sent at once all got checked.
"""

import itertools
import time
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from orbit_api import ratelimit
from orbit_api.auth.two_factor import CHALLENGE_COOKIE, code_at
from orbit_api.config import get_settings
from tests.test_email_flows import _last_token
from tests.test_google_auth import _sign_in_with_google, google_client  # noqa: F401  (fixture)
from tests.test_passkeys import Authenticator, _sign_in

PW = "correct horse battery"


def _account(client: TestClient) -> tuple[str, dict[str, str]]:
    email = f"rt-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": PW})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


def _verify(client: TestClient, email: str, h: dict[str, str]) -> None:
    client.post("/v1/auth/verify-email/request", headers=h)
    assert client.post("/v1/auth/verify-email/confirm",
                       json={"token": _last_token(email, "/verify-email")}).status_code == 200
    client.cookies.clear()


def _code(secret: str, offset: int = 0) -> str:
    return code_at(secret, int(time.time() // 30) + offset)


def _two_factor_on(client: TestClient, h: dict[str, str]) -> str:
    secret: str = client.post("/v1/auth/2fa/setup", headers=h, json={"password": PW}).json()["secret"]
    assert client.post("/v1/auth/2fa/enable", headers=h, json={"code": _code(secret)}).status_code == 200
    return secret


def _passkey(client: TestClient, h: dict[str, str]) -> Authenticator:
    device = Authenticator()
    opts = client.post("/v1/auth/passkeys/options", headers=h, json={"password": PW})
    assert opts.status_code == 200, opts.text
    added = client.post("/v1/auth/passkeys", headers=h, json={"credential": device.create(opts.json()["options"])})
    assert added.status_code == 201, added.text
    return device


def _reset(client: TestClient, email: str, password: str = "the real owner's new one 1") -> dict:
    client.cookies.clear()
    assert client.post("/v1/auth/password-reset/request", json={"email": email}).status_code == 202
    r = client.post("/v1/auth/password-reset/confirm",
                    json={"token": _last_token(email, "/reset-password"), "password": password})
    assert r.status_code == 200, r.text
    out: dict = r.json()
    return out


# ---- RT-01: a reset link proves the inbox, not the second factor ---------------------------------------------------


def test_a_password_reset_still_asks_for_the_authenticator_code(client: TestClient) -> None:
    email, h = _account(client)
    _verify(client, email, h)
    secret = _two_factor_on(client, h)

    out = _reset(client, email)
    assert out.get("two_factor_required") is True and "access_token" not in out and "user" not in out
    assert "orbit_session" not in client.cookies  # no session from the link alone
    assert client.cookies.get(CHALLENGE_COOKIE)  # the code step can pick it up, as after Google
    assert client.get("/v1/auth/me").status_code == 401
    # The new password is set: signing in with it asks for the code too.
    client.cookies.clear()
    assert client.post("/v1/auth/login", json={"email": email, "password": "the real owner's new one 1"}
                       ).json()["two_factor_required"] is True
    # And the code turns the reset's challenge into a session.
    # (the next step's code: enabling spent this one)
    done = client.post("/v1/auth/login/2fa", json={"challenge": out["challenge"], "code": _code(secret, 1)})
    assert done.status_code == 200, done.text
    assert done.json()["user"]["email"] == email


def test_a_password_reset_without_two_step_sign_in_still_signs_in(client: TestClient) -> None:
    email, h = _account(client)
    _verify(client, email, h)
    out = _reset(client, email)
    assert out["user"]["email"] == email and out["access_token"]


# ---- RT-02: pre-account takeover -------------------------------------------------------------------------------------


@pytest.fixture
def verifying_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("ORBIT_EMAIL_VERIFICATION", "required")
    get_settings.cache_clear()
    from orbit_api.main import create_app

    with TestClient(create_app()) as c:
        yield c
    get_settings.cache_clear()


def test_an_unproven_inbox_cannot_add_a_passkey_or_an_authenticator(verifying_client: TestClient) -> None:
    client = verifying_client
    victim = f"victim-{uuid.uuid4().hex[:8]}@example.com"
    assert client.post("/v1/auth/register", json={"email": victim, "password": PW}).status_code == 202
    client.cookies.clear()
    login = client.post("/v1/auth/login", json={"email": victim, "password": PW})  # signing in still works
    h = {"Authorization": f"Bearer {login.json()['access_token']}"}
    client.cookies.clear()
    for path in ("/v1/auth/passkeys/options", "/v1/auth/2fa/setup"):
        r = client.post(path, headers=h, json={"password": PW})
        assert r.status_code == 403 and r.json()["detail"]["code"] == "email_unverified", (path, r.text)
    assert client.post("/v1/auth/2fa/enable", headers=h, json={"code": "123456"}).status_code == 403
    assert client.get("/v1/auth/passkeys", headers=h).json() == []


def test_proving_the_inbox_by_reset_drops_sign_ins_set_up_before_it(client: TestClient) -> None:
    # Verification off (or a passkey from before it was required): the address's first registrant adds a passkey
    # and an authenticator without ever proving the inbox.
    victim, attacker = _account(client)
    device = _passkey(client, attacker)
    _two_factor_on(client, attacker)
    # The real owner: "Forgot password", the link in their inbox, their own password. Straight in (no authenticator
    # of the attacker's to get past), and the attacker's passkey no longer opens the account.
    out = _reset(client, victim)
    assert out["user"]["email_verified"] is True and out["access_token"]
    owner = {"Authorization": f"Bearer {out['access_token']}"}
    client.cookies.clear()
    assert client.get("/v1/auth/passkeys", headers=owner).json() == []
    assert client.get("/v1/auth/2fa", headers=owner).json()["enabled"] is False
    assert _sign_in(client, device).status_code == 401


def test_a_proven_inbox_keeps_its_passkeys_after_a_reset(client: TestClient) -> None:
    email, h = _account(client)
    _verify(client, email, h)
    device = _passkey(client, h)
    _reset(client, email)
    assert _sign_in(client, device).status_code == 200  # the owner's own passkey is the owner's


def test_google_claiming_an_unproven_address_drops_its_passkeys(google_client: TestClient,  # noqa: F811
                                                                monkeypatch: pytest.MonkeyPatch) -> None:
    client = google_client
    victim, attacker = _account(client)
    device = _passkey(client, attacker)
    _sign_in_with_google(client, monkeypatch, victim, f"sub-{uuid.uuid4().hex[:6]}")
    client.cookies.clear()
    assert _sign_in(client, device).status_code == 401


# ---- RT-03: failure-only throttles hold under concurrent guesses ------------------------------------------------


def test_attempt_takes_the_token_before_the_check_and_a_right_guess_gives_it_back() -> None:
    bucket = ratelimit.TokenBucket(rate_per_s=1e-9, burst=3)
    ratelimit.ENFORCE_IN_TESTS, before = True, ratelimit.ENFORCE_IN_TESTS
    try:
        assert [ratelimit.attempt(bucket, "k") for _ in range(4)] == [True, True, True, False]
        ratelimit.succeeded(bucket, "k")
        assert ratelimit.attempt(bucket, "k") is True and ratelimit.attempt(bucket, "k") is False
        window = ratelimit.SlidingWindow(rate_per_s=1e-6, burst=2)
        assert [ratelimit.attempt(window, "k") for _ in range(3)] == [True, True, False]
        ratelimit.succeeded(window, "k")
        assert ratelimit.attempt(window, "k") is True
    finally:
        ratelimit.ENFORCE_IN_TESTS = before


def test_wrong_codes_sent_at_once_are_checked_no_more_than_the_limit(client: TestClient,
                                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    email, h = _account(client)
    _verify(client, email, h)
    _two_factor_on(client, h)
    challenge = client.post("/v1/auth/login", json={"email": email, "password": PW}).json()["challenge"]
    client.cookies.clear()
    monkeypatch.setattr(ratelimit, "ENFORCE_IN_TESTS", True)
    # Each guess from its own network, so only the per-account throttle stands in the way.
    networks = itertools.count()
    monkeypatch.setattr(ratelimit, "client_network", lambda request: f"198.51.100.{next(networks)}")
    ratelimit.reset_all()
    try:
        def guess(i: int) -> int:
            return client.post("/v1/auth/login/2fa", json={"challenge": challenge, "code": f"{i:06d}"}).status_code

        with ThreadPoolExecutor(max_workers=30) as pool:
            statuses = list(pool.map(guess, range(1, 31)))
    finally:
        ratelimit.reset_all()
    checked = sum(1 for s in statuses if s in (200, 401))
    assert checked <= 5, f"{checked} codes were checked (limit 5): {sorted(statuses)}"
    assert statuses.count(429) >= 25


# ---- RT-04: the paid natural voice needs a proven inbox, like every other provider-cost route ------------------------


def test_an_unproven_inbox_cannot_spend_the_natural_voice(verifying_client: TestClient,
                                                          monkeypatch: pytest.MonkeyPatch) -> None:
    from tests.test_voice import _deepgram

    client = verifying_client
    seen: list[object] = []
    _deepgram(monkeypatch, seen=seen)
    email = f"tts-{uuid.uuid4().hex[:8]}@example.com"
    assert client.post("/v1/auth/register", json={"email": email, "password": PW}).status_code == 202
    client.cookies.clear()
    token = client.post("/v1/auth/login", json={"email": email, "password": PW}).json()["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    client.cookies.clear()
    r = client.post("/v1/voice/speak", headers=h, json={"text": "Read anything I like, on Orbit's account."})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "email_unverified"
    assert seen == []  # the provider was never called
