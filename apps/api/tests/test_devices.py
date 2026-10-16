"""Signed-in devices: each sign-in is listed, one can be signed out (its token stops working at once), logout ends
the device on the server, older tokens without a device id keep working, and nothing crosses accounts."""

import uuid

from fastapi.testclient import TestClient

from orbit_api.auth.devices import device_label
from orbit_api.auth.security import create_access_token, decode_claims

PW = "correct horse battery"
CHROME_WIN = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 "
              "Safari/537.36")
SAFARI_IOS = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile "
              "Safari/604.1")


def test_device_labels_are_coarse_and_readable() -> None:
    assert device_label(CHROME_WIN) == ("web", "Chrome on Windows")
    assert device_label(SAFARI_IOS) == ("web", "Safari on iOS")
    assert device_label("Mozilla/5.0 Tauri/2.0") == ("desktop", "Orbit for Windows")
    assert device_label("") == ("other", "Another app")


def _account(client: TestClient) -> tuple[str, dict[str, str]]:
    email = f"dev-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": PW}, headers={"user-agent": CHROME_WIN})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


def _login(client: TestClient, email: str, ua: str) -> dict[str, str]:
    r = client.post("/v1/auth/login", json={"email": email, "password": PW}, headers={"user-agent": ua})
    assert r.status_code == 200, r.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_sign_out_one_device_from_another(client: TestClient) -> None:
    email, laptop = _account(client)
    phone = _login(client, email, SAFARI_IOS)
    devices = client.get("/v1/auth/sessions", headers=laptop).json()
    assert sorted(d["label"] for d in devices) == ["Chrome on Windows", "Safari on iOS"]
    assert [d["current"] for d in devices if d["label"] == "Chrome on Windows"] == [True]
    phone_id = next(d["id"] for d in devices if d["label"] == "Safari on iOS")

    assert client.delete(f"/v1/auth/sessions/{phone_id}", headers=laptop).status_code == 204
    assert client.get("/v1/auth/me", headers=phone).status_code == 401  # at once, not at expiry
    assert client.get("/v1/auth/me", headers=laptop).status_code == 200
    assert [d["label"] for d in client.get("/v1/auth/sessions", headers=laptop).json()] == ["Chrome on Windows"]
    assert client.delete(f"/v1/auth/sessions/{phone_id}", headers=laptop).status_code == 404  # already out


def test_logout_ends_the_device_on_the_server(client: TestClient) -> None:
    email, laptop = _account(client)
    other = _login(client, email, SAFARI_IOS)
    assert client.post("/v1/auth/logout", headers=other).status_code == 204
    assert client.get("/v1/auth/me", headers=other).status_code == 401  # a copied token is dead too
    assert client.get("/v1/auth/me", headers=laptop).status_code == 200


def test_older_tokens_without_a_device_still_work(client: TestClient) -> None:
    _, laptop = _account(client)
    sub = decode_claims(laptop["Authorization"][7:])
    assert sub is not None and isinstance(sub.get("sid"), str)
    legacy = create_access_token(sub["sub"], sub["ver"])  # as minted before devices existed
    assert client.get("/v1/auth/me", headers={"Authorization": f"Bearer {legacy}"}).status_code == 200


def test_devices_are_private_and_exported(client: TestClient) -> None:
    _, a = _account(client)
    _, b = _account(client)
    a_id = client.get("/v1/auth/sessions", headers=a).json()[0]["id"]
    assert client.delete(f"/v1/auth/sessions/{a_id}", headers=b).status_code == 404
    assert client.get("/v1/auth/me", headers=a).status_code == 200
    assert all(d["id"] != a_id for d in client.get("/v1/auth/sessions", headers=b).json())
    exported = client.get("/v1/auth/me/export", headers=a).json()["signed_in_devices"]
    assert [d["id"] for d in exported] == [a_id]


def test_sign_out_everywhere_still_ends_every_device(client: TestClient) -> None:
    email, laptop = _account(client)
    phone = _login(client, email, SAFARI_IOS)
    assert client.post("/v1/auth/logout-all", headers=laptop).status_code == 204
    assert client.get("/v1/auth/me", headers=phone).status_code == 401
    assert client.get("/v1/auth/me", headers=laptop).status_code == 401
