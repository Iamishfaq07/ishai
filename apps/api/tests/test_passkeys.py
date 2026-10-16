"""Passkeys: adding one (password again, single-use challenge, the right origin), signing in with it (no email, no
second step), refusing replays, other sites and other accounts' passkeys, and managing them. A small software
authenticator below makes real P-256 signatures, so the whole WebAuthn check runs."""

import base64
import hashlib
import json
import os
import struct
import uuid
from typing import Any

import cbor2
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient

from orbit_api.auth.passkeys import relying_party

PW = "correct horse battery"


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class Authenticator:
    """One passkey on a pretend device: a P-256 key, a credential id, a counter."""

    def __init__(self, sign_count: int = 0) -> None:
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(32)
        self.count = sign_count
        self.user_handle = b""

    def _auth_data(self, rp_id: str, attested: bytes = b"", flags: int = 0x05) -> bytes:
        return hashlib.sha256(rp_id.encode()).digest() + bytes([flags]) + struct.pack(">I", self.count) + attested

    def create(self, options: dict[str, Any], origin: str | None = None) -> dict[str, Any]:
        rp_id, real_origin = relying_party()
        self.user_handle = unb64u(options["user"]["id"])
        client = json.dumps({"type": "webauthn.create", "challenge": options["challenge"],
                             "origin": origin or real_origin, "crossOrigin": False}).encode()
        nums = self.key.public_key().public_numbers()
        cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: nums.x.to_bytes(32, "big"), -3: nums.y.to_bytes(32, "big")})
        attested = bytes(16) + struct.pack(">H", len(self.cred_id)) + self.cred_id + cose
        auth = self._auth_data(rp_id, attested, flags=0x45)  # user present + verified + attested data
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth})
        return {"id": b64u(self.cred_id), "rawId": b64u(self.cred_id), "type": "public-key",
                "response": {"clientDataJSON": b64u(client), "attestationObject": b64u(attestation),
                             "transports": ["internal", "made-up"]},
                "clientExtensionResults": {}}

    def get(self, options: dict[str, Any], origin: str | None = None, flags: int = 0x05) -> dict[str, Any]:
        rp_id, real_origin = relying_party()
        if self.count:
            self.count += 1
        client = json.dumps({"type": "webauthn.get", "challenge": options["challenge"],
                             "origin": origin or real_origin, "crossOrigin": False}).encode()
        auth = self._auth_data(rp_id, flags=flags)
        signature = self.key.sign(auth + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": b64u(self.cred_id), "rawId": b64u(self.cred_id), "type": "public-key",
                "response": {"clientDataJSON": b64u(client), "authenticatorData": b64u(auth),
                             "signature": b64u(signature), "userHandle": b64u(self.user_handle)},
                "clientExtensionResults": {}}


def _account(client: TestClient) -> tuple[str, dict[str, str]]:
    email = f"pk-{uuid.uuid4().hex[:8]}@example.com"
    r = client.post("/v1/auth/register", json={"email": email, "password": PW})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return email, {"Authorization": f"Bearer {r.json()['access_token']}"}


def _add(client: TestClient, h: dict[str, str], device: Authenticator, name: str = "") -> dict[str, Any]:
    opts = client.post("/v1/auth/passkeys/options", headers=h, json={"password": PW})
    assert opts.status_code == 200, opts.text
    r = client.post("/v1/auth/passkeys", headers=h, json={"credential": device.create(opts.json()["options"]),
                                                          "name": name})
    assert r.status_code == 201, r.text
    out: dict[str, Any] = r.json()
    return out


def _sign_in(client: TestClient, device: Authenticator, **kw: Any) -> Any:
    opts = client.post("/v1/auth/login/passkey/options")
    assert opts.status_code == 200, opts.text
    assert opts.json()["options"]["userVerification"] == "required"
    assert "allowCredentials" not in opts.json()["options"] or not opts.json()["options"]["allowCredentials"]
    r = client.post("/v1/auth/login/passkey", json={"credential": device.get(opts.json()["options"], **kw)})
    client.cookies.clear()
    return r


def test_add_a_passkey_and_sign_in_with_it(client: TestClient) -> None:
    email, h = _account(client)
    assert client.post("/v1/auth/passkeys/options", headers=h, json={"password": "wrong"}).status_code == 403
    opts = client.post("/v1/auth/passkeys/options", headers=h, json={"password": PW}).json()["options"]
    rp_id, _ = relying_party()
    assert opts["rp"]["id"] == rp_id and opts["authenticatorSelection"]["residentKey"] == "required"
    device = Authenticator()
    added = client.post("/v1/auth/passkeys", headers=h, json={"credential": device.create(opts), "name": "My phone"})
    assert added.status_code == 201, added.text
    assert added.json()["name"] == "My phone" and added.json()["last_used_at"] is None
    # The same challenge can't add a second passkey.
    again = client.post("/v1/auth/passkeys", headers=h, json={"credential": Authenticator().create(opts)})
    assert again.status_code == 400

    signed_in = _sign_in(client, device)
    assert signed_in.status_code == 200, signed_in.text
    body = signed_in.json()
    assert body["user"]["email"] == email and body["access_token"]
    me = client.get("/v1/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.status_code == 200
    listed = client.get("/v1/auth/passkeys", headers=h).json()
    assert len(listed) == 1 and listed[0]["last_used_at"] is not None

    # The next registration excludes the passkey already added.
    nxt = client.post("/v1/auth/passkeys/options", headers=h, json={"password": PW}).json()["options"]
    assert [c["id"] for c in nxt["excludeCredentials"]] == [b64u(device.cred_id)]


def test_a_signed_answer_works_once(client: TestClient) -> None:
    _, h = _account(client)
    device = Authenticator()
    _add(client, h, device)
    opts = client.post("/v1/auth/login/passkey/options").json()["options"]
    answer = device.get(opts)
    assert client.post("/v1/auth/login/passkey", json={"credential": answer}).status_code == 200
    client.cookies.clear()
    replay = client.post("/v1/auth/login/passkey", json={"credential": answer})
    assert replay.status_code == 401 and "timed out" in replay.json()["detail"]


def test_another_site_or_an_unknown_passkey_gets_nowhere(client: TestClient) -> None:
    _, h = _account(client)
    device = Authenticator()
    # Made on a look-alike site: the browser stamps that origin into what's signed.
    opts = client.post("/v1/auth/passkeys/options", headers=h, json={"password": PW}).json()["options"]
    bad = client.post("/v1/auth/passkeys", headers=h,
                      json={"credential": device.create(opts, origin="https://orbit-login.example")})
    assert bad.status_code == 400
    _add(client, h, device)
    assert _sign_in(client, device, origin="https://orbit-login.example").status_code == 401
    stranger = Authenticator()
    stranger.user_handle = b"someone"
    r = _sign_in(client, stranger)
    assert r.status_code == 401 and "isn't one Orbit knows" in r.json()["detail"]
    # Without the device unlock (user verification) it isn't accepted.
    assert _sign_in(client, device, flags=0x01).status_code == 401
    # A forged signature from another key.
    forged = Authenticator()
    forged.cred_id, forged.user_handle = device.cred_id, device.user_handle
    assert _sign_in(client, forged).status_code == 401
    assert _sign_in(client, device).status_code == 200


def test_a_cloned_passkey_counter_going_backwards_is_refused(client: TestClient) -> None:
    _, h = _account(client)
    device = Authenticator(sign_count=5)
    _add(client, h, device)
    assert _sign_in(client, device).status_code == 200  # count 6
    device.count = 3  # a copy of the key, behind the real one
    assert _sign_in(client, device).status_code == 401


def test_passkey_sign_in_skips_the_code_but_respects_suspension(client: TestClient) -> None:
    from tests.test_two_factor import _turn_on

    email, h = _account(client)
    _turn_on(client, h)
    device = Authenticator()
    _add(client, h, device)
    assert "challenge" in client.post("/v1/auth/login", json={"email": email, "password": PW}).json()
    client.cookies.clear()
    r = _sign_in(client, device)
    assert r.status_code == 200 and r.json()["access_token"]  # the passkey is both steps at once

    from datetime import UTC, datetime

    from sqlalchemy import update

    from orbit_api.db import sessionmaker
    from orbit_api.models import User

    async def suspend() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(User).where(User.email == email).values(suspended_at=datetime.now(UTC)))
            await db.commit()

    client.portal.call(suspend)  # type: ignore[union-attr]
    assert _sign_in(client, device).status_code == 403


def test_managing_passkeys(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _, h = _account(client)
    _, other = _account(client)
    first = _add(client, h, Authenticator(), name="Laptop")
    device = Authenticator()
    second = _add(client, h, device)
    assert second["name"]  # named from the browser when left blank
    renamed = client.patch(f"/v1/auth/passkeys/{first['id']}", headers=h, json={"name": "Work laptop"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Work laptop"
    # Someone else's passkey isn't theirs to see, rename or remove.
    assert client.get("/v1/auth/passkeys", headers=other).json() == []
    assert client.patch(f"/v1/auth/passkeys/{first['id']}", headers=other, json={"name": "x"}).status_code == 404
    assert client.delete(f"/v1/auth/passkeys/{first['id']}", headers=other).status_code == 404
    assert client.delete(f"/v1/auth/passkeys/{second['id']}", headers=h).status_code == 204
    assert [p["name"] for p in client.get("/v1/auth/passkeys", headers=h).json()] == ["Work laptop"]
    assert _sign_in(client, device).status_code == 401  # removed: it no longer signs in

    export = client.get("/v1/auth/me/export", headers=h)
    assert export.status_code == 200, export.text
    assert [p["name"] for p in export.json()["passkeys"]] == ["Work laptop"]
    assert "public_key" not in json.dumps(export.json()["passkeys"])

    from orbit_api.auth import passkeys

    monkeypatch.setattr(passkeys, "MAX_PASSKEYS", 1)
    full = client.post("/v1/auth/passkeys/options", headers=h, json={"password": PW})
    assert full.status_code == 409
