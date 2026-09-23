from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import get_settings


def _release(root: Path, version: str, *, signed: bool = True, notes: str | None = None) -> None:
    d = root / version
    d.mkdir(parents=True)
    exe = d / f"Orbit_{version}_x64-setup.exe"
    exe.write_bytes(b"MZ fake installer " + version.encode())
    if signed:
        (d / f"{exe.name}.sig").write_text(f"sig-for-{version}\n", encoding="utf-8")
    if notes:
        (d / "notes.md").write_text(notes, encoding="utf-8")


@pytest.fixture
def updates(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(get_settings(), "desktop_updates_dir", str(tmp_path))
    return tmp_path


def test_no_updates_dir_means_up_to_date(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "desktop_updates_dir", None)
    assert client.get("/v1/desktop/update/windows/x86_64/0.1.0").status_code == 204


def test_serves_newest_signed_release_by_semver(client: TestClient, updates: Path) -> None:
    _release(updates, "0.1.1")
    _release(updates, "0.10.0", notes="Faster answers")  # semver, not string order
    _release(updates, "0.9.0")
    _release(updates, "0.11.0", signed=False)  # unsigned → never offered
    (updates / "not-a-version").mkdir()

    r = client.get("/v1/desktop/update/windows/x86_64/0.1.0")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "0.10.0" and body["notes"] == "Faster answers"
    assert body["signature"] == "sig-for-0.10.0"
    assert body["url"].endswith("/v1/desktop/download/0.10.0/Orbit_0.10.0_x64-setup.exe")
    assert body["pub_date"].endswith("Z")

    dl = client.get(body["url"].replace("http://testserver", ""))
    assert dl.status_code == 200 and dl.content == b"MZ fake installer 0.10.0"


def test_up_to_date_or_unsupported_returns_204(client: TestClient, updates: Path) -> None:
    _release(updates, "0.2.0")
    assert client.get("/v1/desktop/update/windows/x86_64/0.2.0").status_code == 204
    assert client.get("/v1/desktop/update/windows/x86_64/0.3.0").status_code == 204
    assert client.get("/v1/desktop/update/darwin/aarch64/0.1.0").status_code == 204  # macOS deferred
    assert client.get("/v1/desktop/update/windows/x86_64/garbage").status_code == 204


def test_download_rejects_traversal_and_other_files(client: TestClient, updates: Path) -> None:
    _release(updates, "0.2.0")
    (updates / "secret.txt").write_text("nope")
    for bad in ("/v1/desktop/download/0.2.0/..%2F..%2Fsecret.txt", "/v1/desktop/download/0.2.0/notes.md",
                "/v1/desktop/download/..%2F0.2.0/Orbit_0.2.0_x64-setup.exe",
                "/v1/desktop/download/0.2.0/Orbit_0.2.0_x64-setup.exe.sig",
                "/v1/desktop/download/0.2.0/Missing_x64-setup.exe"):
        assert client.get(bad).status_code == 404, bad
