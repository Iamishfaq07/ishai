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
    assert r.status_code in (400, 413)


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


def test_production_refuses_wildcard_cors_and_weak_proxy_secret() -> None:
    _prod()  # the baseline is valid
    with pytest.raises(ValueError, match="CORS"):
        _prod(ORBIT_CORS_ORIGINS='["*"]')
    with pytest.raises(ValueError, match="PROXY_SECRET"):
        _prod(ORBIT_PROXY_SECRET="short")


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
