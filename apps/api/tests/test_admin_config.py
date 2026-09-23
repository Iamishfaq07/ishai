"""Advanced settings: admin-only, encrypted in-app API-key editing."""

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient


def _client(monkeypatch: pytest.MonkeyPatch, **env: str) -> Iterator[TestClient]:
    from orbit_api.config import get_settings
    from orbit_api.main import create_app

    for k, v in env.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            yield c
    finally:
        get_settings.cache_clear()


def _register(client: TestClient, email: str) -> dict[str, str]:
    r = client.post("/v1/auth/register", json={"email": email, "password": "correct horse battery"})
    assert r.status_code == 201, r.text
    client.cookies.clear()
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_config_secret_roundtrip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ORBIT_CONFIG_SECRET", "unit-test-secret")
    from orbit_api import runtime_config as rc
    from orbit_api.config import get_settings

    get_settings.cache_clear()
    try:
        assert rc.secrets_editable() is True
        token = rc.encrypt_secret("sk-abc")
        assert token != "sk-abc" and "sk-abc" not in token
        assert rc._decrypt_secret(token) == "sk-abc"
    finally:
        get_settings.cache_clear()


def test_admin_gating_and_nonsecret_edit(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email)  # no config secret → secrets not editable
    client = next(gen)
    try:
        admin = _register(client, admin_email)
        other = _register(client, f"user-{uuid.uuid4().hex[:8]}@example.com")

        assert client.get("/v1/admin/status", headers=admin).json()["is_admin"] is True
        assert client.get("/v1/admin/status", headers=other).json()["is_admin"] is False
        assert client.get("/v1/admin/config", headers=other).status_code == 403
        assert client.put("/v1/admin/config", headers=other, json={"deepseek_model": "x"}).status_code == 403

        cfg = client.get("/v1/admin/config", headers=admin).json()
        assert cfg["secrets_editable"] is False

        # Non-secret edit applies immediately.
        put = client.put("/v1/admin/config", headers=admin, json={"deepseek_model": "deepseek-chat-v2"})
        assert put.status_code == 200 and put.json()["deepseek_model"] == "deepseek-chat-v2"

        # A bad provider choice is rejected.
        assert client.put("/v1/admin/config", headers=admin,
                          json={"llm_provider": "not-a-provider"}).status_code == 422

        # A secret can't be stored without ORBIT_CONFIG_SECRET.
        assert client.put("/v1/admin/config", headers=admin,
                          json={"deepseek_api_key": "sk-live"}).status_code == 400
    finally:
        gen.close()


def test_admin_secret_editing_with_config_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    gen = _client(monkeypatch, ORBIT_ADMIN_EMAIL=admin_email, ORBIT_CONFIG_SECRET="app-config-secret")
    client = next(gen)
    try:
        from orbit_api import runtime_config as rc

        admin = _register(client, admin_email)
        cfg = client.get("/v1/admin/config", headers=admin).json()
        assert cfg["secrets_editable"] is True

        put = client.put("/v1/admin/config", headers=admin, json={"deepseek_api_key": "sk-secret-123"})
        assert put.status_code == 200 and put.json()["deepseek_api_key_set"] is True
        assert "sk-secret-123" not in put.text  # masked: plaintext never returned
        assert rc.get_effective_config().deepseek_api_key == "sk-secret-123"  # override applied to providers

        # An empty string removes the override; the effective key reverts to the environment default.
        cleared = client.put("/v1/admin/config", headers=admin, json={"deepseek_api_key": ""})
        assert cleared.status_code == 200
        assert rc.get_effective_config().deepseek_api_key != "sk-secret-123"
    finally:
        gen.close()
