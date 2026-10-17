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


def test_stage_release_copies_signed_installer_once(tmp_path: Path) -> None:
    from orbit_api.stage_release import stage

    art = tmp_path / "artifact" / "bundle" / "nsis"
    art.mkdir(parents=True)
    (art / "Orbit_0.1.1_x64-setup.exe").write_bytes(b"MZ")
    updates = tmp_path / "updates"
    with pytest.raises(SystemExit, match="missing or empty"):
        stage(tmp_path / "artifact", updates, None)  # unsigned → refused
    (art / "Orbit_0.1.1_x64-setup.exe.sig").write_text("sig")
    dest = stage(tmp_path / "artifact", updates, "Fixes")
    assert sorted(p.name for p in dest.iterdir()) == ["Orbit_0.1.1_x64-setup.exe", "Orbit_0.1.1_x64-setup.exe.sig",
                                                      "notes.md"]
    with pytest.raises(SystemExit, match="already exists"):
        stage(tmp_path / "artifact", updates, None)  # never overwrite a published version


# ---- GitHub Releases source (hosts without a disk, e.g. Render free) ----------------------------------

def _github(monkeypatch: pytest.MonkeyPatch, releases_latest: dict | None, *, status: int = 200,
            location: str = "https://objects.githubusercontent.com/orbit.exe?sig=abc") -> list[str]:
    import httpx

    from orbit_api import desktop_updates

    calls: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        calls.append(f"{req.method} {req.url.path} {req.headers.get('accept')}")
        assert req.headers["authorization"] == "Bearer ghp-test"
        if req.url.path == "/repos/me/orbit/releases/latest":
            return httpx.Response(status, json=releases_latest or {})
        if req.url.path.endswith("/assets/2"):  # the .sig
            return httpx.Response(200, text="sig-from-github\n")
        if req.url.path.endswith("/assets/1"):  # the installer → signed CDN URL
            return httpx.Response(302, headers={"location": location})
        return httpx.Response(404)

    monkeypatch.setattr(desktop_updates, "_http",
                        lambda **kw: httpx.AsyncClient(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(desktop_updates, "_gh_cache", None)
    desktop_updates._download_cache.clear()
    s = get_settings()
    monkeypatch.setattr(s, "desktop_updates_dir", None)
    monkeypatch.setattr(s, "updates_github_repo", "me/orbit")
    from pydantic import SecretStr
    monkeypatch.setattr(s, "updates_github_token", SecretStr("ghp-test"))
    return calls


_REL = {
    "tag_name": "v0.1.4", "draft": False, "prerelease": False, "body": "Better listening",
    "published_at": "2026-09-25T10:00:00Z",
    "assets": [
        {"name": "Orbit_0.1.4_x64-setup.exe", "url": "https://api.github.com/repos/me/orbit/releases/assets/1"},
        {"name": "Orbit_0.1.4_x64-setup.exe.sig", "url": "https://api.github.com/repos/me/orbit/releases/assets/2"},
    ],
}


def test_github_release_is_offered_and_download_redirects(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _github(monkeypatch, _REL)
    r = client.get("/v1/desktop/update/windows/x86_64/0.1.3", headers={"x-forwarded-proto": "https"})
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "0.1.4" and body["signature"] == "sig-from-github" and body["notes"] == "Better listening"
    assert body["url"].startswith("https://")
    assert body["url"].endswith("/v1/desktop/download/0.1.4/Orbit_0.1.4_x64-setup.exe")
    assert client.get("/v1/desktop/update/windows/x86_64/0.1.4").status_code == 204  # already current
    assert client.get("/v1/desktop/update/windows/x86_64/0.2.0").status_code == 204
    assert sum("releases/latest" in c for c in calls) == 1  # cached, not one GitHub call per check

    d = client.get("/v1/desktop/download/0.1.4/Orbit_0.1.4_x64-setup.exe", follow_redirects=False)
    assert d.status_code == 302 and d.headers["location"] == "https://objects.githubusercontent.com/orbit.exe?sig=abc"
    assert client.get("/v1/desktop/download/0.1.3/Orbit_0.1.3_x64-setup.exe", follow_redirects=False).status_code == 404
    assert client.get("/v1/desktop/download/0.1.4/other-setup.exe", follow_redirects=False).status_code == 404


def test_a_download_link_off_githubs_cdn_is_refused(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _github(monkeypatch, _REL, location="https://evil.example/orbit.exe")
    refused = client.get("/v1/desktop/download/0.1.4/Orbit_0.1.4_x64-setup.exe", follow_redirects=False)
    assert refused.status_code == 502
    _github(monkeypatch, _REL, location="http://objects.githubusercontent.com/orbit.exe")
    plain = client.get("/v1/desktop/download/0.1.4/Orbit_0.1.4_x64-setup.exe", follow_redirects=False)
    assert plain.status_code == 502


def test_github_unsigned_draft_or_failing_release_is_never_offered(client: TestClient,
                                                                   monkeypatch: pytest.MonkeyPatch) -> None:
    unsigned = {**_REL, "assets": _REL["assets"][:1]}
    _github(monkeypatch, unsigned)
    assert client.get("/v1/desktop/update/windows/x86_64/0.1.3").status_code == 204
    _github(monkeypatch, {**_REL, "prerelease": True})
    assert client.get("/v1/desktop/update/windows/x86_64/0.1.3").status_code == 204
    _github(monkeypatch, None, status=401)  # bad/expired token → quietly "up to date", never a crash
    assert client.get("/v1/desktop/update/windows/x86_64/0.1.3").status_code == 204


def test_health_reports_the_running_commit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    for var in ("ORBIT_GIT_COMMIT", "RAILWAY_GIT_COMMIT_SHA"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("RENDER_GIT_COMMIT", "1ba8f00c0ffee1234567890")
    assert client.get("/health").json()["commit"] == "1ba8f00"
    monkeypatch.delenv("RENDER_GIT_COMMIT")
    assert client.get("/health").json()["commit"] is None
    monkeypatch.setenv("RAILWAY_GIT_COMMIT_SHA", "538fab8b1d0e02734b96df9e615452fd1cffc2ca")  # Railway's deploys
    assert client.get("/health").json()["commit"] == "538fab8"


def test_the_public_url_comes_from_the_setting_else_from_the_host(monkeypatch: pytest.MonkeyPatch) -> None:
    from orbit_api.config import Settings

    for var in ("ORBIT_API_PUBLIC_URL", "RENDER_EXTERNAL_URL", "RAILWAY_PUBLIC_DOMAIN"):
        monkeypatch.delenv(var, raising=False)
    railway = "orbit-api-sg-production.up.railway.app"
    assert Settings(ORBIT_API_PUBLIC_URL="https://api.orbitanswer.com", RENDER_EXTERNAL_URL="https://x.onrender.com",
                    RAILWAY_PUBLIC_DOMAIN=railway).api_public_url == "https://api.orbitanswer.com"  # the setting wins
    assert Settings(RENDER_EXTERNAL_URL="https://orbit-api-sg.onrender.com",
                    RAILWAY_PUBLIC_DOMAIN=railway).api_public_url == "https://orbit-api-sg.onrender.com"
    assert Settings(RAILWAY_PUBLIC_DOMAIN=railway).api_public_url == f"https://{railway}"  # named bare
    assert Settings().api_public_url is None
