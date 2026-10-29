"""Sign in from the iOS app: Google and Apple identity tokens are checked (signature, audience, nonce) and give the
same Bearer session as a password sign-in."""

import hashlib
import time
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from orbit_api.auth import google, native_sign_in
from orbit_api.config import get_settings

BUNDLE = "com.orbitanswer.ios"
NONCE = "n" * 32


@pytest.fixture(scope="module")
def rsa_key() -> Any:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def native_client(monkeypatch: pytest.MonkeyPatch, rsa_key: Any) -> Iterator[TestClient]:
    monkeypatch.setenv("ORBIT_APPLE_BUNDLE_ID", BUNDLE)
    monkeypatch.setenv("ORBIT_GOOGLE_IOS_CLIENT_ID", "ios-client")
    get_settings.cache_clear()
    keyring = SimpleNamespace(get_signing_key_from_jwt=lambda _t: SimpleNamespace(key=rsa_key.public_key()))
    monkeypatch.setattr(native_sign_in, "_apple_jwks", keyring)
    monkeypatch.setattr(google, "_jwks", keyring)
    from orbit_api.main import create_app

    with TestClient(create_app()) as client:
        yield client
    get_settings.cache_clear()


def _token(key: Any, *, iss: str, aud: str, sub: str, nonce: str = NONCE, **extra: Any) -> str:
    claims = {"iss": iss, "aud": aud, "sub": sub, "exp": int(time.time()) + 300,
              "nonce": hashlib.sha256(nonce.encode()).hexdigest(), **extra}
    return jwt.encode(claims, key, algorithm="RS256")


def _apple(key: Any, sub: str = "apple-1", aud: str = BUNDLE, **extra: Any) -> str:
    return _token(key, iss="https://appleid.apple.com", aud=aud, sub=sub, **extra)


def _google(key: Any, sub: str = "g-1", aud: str = "ios-client", **extra: Any) -> str:
    return _token(key, iss="https://accounts.google.com", aud=aud, sub=sub, **extra)


def test_apple_and_native_google_are_off_until_configured(client: TestClient) -> None:
    assert client.get("/v1/auth/config").json()["apple"] is False
    body = {"identity_token": "x" * 30, "nonce": NONCE}
    assert client.post("/v1/auth/apple", json=body).status_code == 404
    assert client.post("/v1/auth/google/native", json={"id_token": "x" * 30, "nonce": NONCE}).status_code == 404


def test_apple_signs_up_then_in_again_with_a_bearer_token(native_client: TestClient, rsa_key: Any) -> None:
    assert native_client.get("/v1/auth/config").json()["apple"] is True
    first = native_client.post("/v1/auth/apple", json={
        "identity_token": _apple(rsa_key, email="native-grace@example.com", email_verified="true"),
        "nonce": NONCE, "name": "Grace Hopper"})
    assert first.status_code == 200, first.text
    token = first.json()["access_token"]
    assert token and first.json()["user"]["email"] == "native-grace@example.com"
    me = native_client.get("/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.json()["name"] == "Grace Hopper" and me.json()["email_verified"] is True

    # Apple leaves the email out of later tokens: the account is found by its Apple id alone.
    again = native_client.post("/v1/auth/apple", json={"identity_token": _apple(rsa_key), "nonce": NONCE})
    assert again.status_code == 200, again.text
    assert again.json()["user"]["id"] == first.json()["user"]["id"]


def test_apple_refuses_a_wrong_nonce_audience_or_unverified_email(native_client: TestClient, rsa_key: Any) -> None:
    ok = {"email": "native-eve@example.com", "email_verified": True}
    cases = {
        "nonce": ({"identity_token": _apple(rsa_key, nonce="o" * 32, **ok), "nonce": NONCE}, 401),
        "audience": ({"identity_token": _apple(rsa_key, aud="com.someone.else", **ok), "nonce": NONCE}, 401),
        "unverified": ({"identity_token": _apple(rsa_key, email="native-eve@example.com", email_verified="false"),
                        "nonce": NONCE}, 400),
        "unknown id, no email": ({"identity_token": _apple(rsa_key, sub="nobody"), "nonce": NONCE}, 400),
    }
    for name, (body, code) in cases.items():
        assert native_client.post("/v1/auth/apple", json=body).status_code == code, name


def test_apple_token_signed_by_another_key_is_refused(native_client: TestClient) -> None:
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    body = {"identity_token": _apple(other, email="native-x@example.com", email_verified=True), "nonce": NONCE}
    assert native_client.post("/v1/auth/apple", json=body).status_code == 401


def test_google_native_signs_up_and_links_a_confirmed_account(native_client: TestClient, rsa_key: Any) -> None:
    made = native_client.post("/v1/auth/google/native", json={
        "id_token": _google(rsa_key, email="native-ada@example.com", email_verified=True, name="Ada"), "nonce": NONCE})
    assert made.status_code == 200, made.text
    assert made.json()["access_token"] and made.json()["user"]["email"] == "native-ada@example.com"

    bad = native_client.post("/v1/auth/google/native", json={
        "id_token": _google(rsa_key, aud="not-ours", email="native-ada@example.com", email_verified=True),
        "nonce": NONCE})
    assert bad.status_code == 401

    # Someone else's Google account must not open this one.
    other = native_client.post("/v1/auth/google/native", json={
        "id_token": _google(rsa_key, sub="g-2", email="native-ada@example.com", email_verified=True), "nonce": NONCE})
    assert other.status_code == 401
