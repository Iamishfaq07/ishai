"""Desktop auto-update server for the Tauri updater (dynamic-server protocol).

Layout under ORBIT_DESKTOP_UPDATES_DIR (one folder per released version):

    0.1.1/Orbit_0.1.1_x64-setup.exe
    0.1.1/Orbit_0.1.1_x64-setup.exe.sig      (minisign signature produced by `tauri build`)
    0.1.1/notes.md                           (optional release notes)

GET /v1/desktop/update/{target}/{arch}/{current_version} → 204 when up to date, else the manifest.

Without an updates dir (e.g. Render's free tier has no persistent disk), releases come from GitHub instead:
ORBIT_UPDATES_GITHUB_REPO + ORBIT_UPDATES_GITHUB_TOKEN. The latest published release's
`*-setup.exe` + `*-setup.exe.sig` assets are offered, and /download redirects to GitHub's short-lived signed
asset URL (the updater can't authenticate to a private repo).
Unauthenticated by design: the updater can't send user credentials, and every installer is verified
on the client against the public key compiled into the app, so serving it openly is safe.
"""

import logging
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, RedirectResponse

from orbit_api.config import get_settings

log = logging.getLogger(__name__)
router = APIRouter(prefix="/v1/desktop", tags=["desktop"])

_VERSION = re.compile(r"^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$")
SUPPORTED = {("windows", "x86_64")}  # Windows-first; macOS/Linux deferred


@dataclass(frozen=True)
class Release:
    version: str
    installer: Path
    signature: str
    notes: str | None
    published: datetime


def parse_version(v: str) -> tuple[int, int, int] | None:
    m = _VERSION.match(v)
    return (int(m[1]), int(m[2]), int(m[3])) if m else None


def _load(folder: Path) -> Release | None:
    if parse_version(folder.name) is None:
        return None
    installers = sorted(p for p in folder.glob("*-setup.exe") if p.with_name(p.name + ".sig").is_file())
    if not installers:
        return None
    exe = installers[0]
    notes = folder / "notes.md"
    return Release(
        version=folder.name,
        installer=exe,
        signature=exe.with_name(exe.name + ".sig").read_text(encoding="utf-8").strip(),
        notes=notes.read_text(encoding="utf-8").strip()[:4000] if notes.is_file() else None,
        published=datetime.fromtimestamp(exe.stat().st_mtime, UTC),
    )


def latest_release(root: Path) -> Release | None:
    if not root.is_dir():
        return None
    releases = [r for d in root.iterdir() if d.is_dir() and (r := _load(d))]
    return max(releases, key=lambda r: parse_version(r.version) or (0, 0, 0), default=None)


def _root() -> Path | None:
    d = get_settings().desktop_updates_dir
    return Path(d).resolve() if d else None


# ---- GitHub Releases source ------------------------------------------------------------------------------

GITHUB_API = "https://api.github.com"
GITHUB_CACHE_S = 300  # every running app polls; don't hit GitHub's API per check
GITHUB_ERROR_CACHE_S = 60


@dataclass(frozen=True)
class GitHubRelease:
    version: str
    installer_name: str
    installer_asset_url: str  # API URL; with Accept: octet-stream it 302s to a signed download URL
    signature: str
    notes: str | None
    published: datetime


_gh_cache: tuple[float, GitHubRelease | None] | None = None


def _http(**kwargs: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(**kwargs)  # seam for tests


def _github_headers(token: str, *, raw: bool = False) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "X-GitHub-Api-Version": "2022-11-28",
            "Accept": "application/octet-stream" if raw else "application/vnd.github+json",
            "User-Agent": "orbit-api-updates"}


def _github_config() -> tuple[str, str] | None:
    s = get_settings()
    if not s.updates_github_repo or not s.updates_github_token:
        return None
    return s.updates_github_repo, s.updates_github_token.get_secret_value()


async def github_latest_release(client: httpx.AsyncClient | None = None) -> GitHubRelease | None:
    """The newest published, signed GitHub release (cached). None if unconfigured or unavailable."""
    global _gh_cache
    cfg = _github_config()
    if cfg is None:
        return None
    if _gh_cache is not None and time.monotonic() < _gh_cache[0]:
        return _gh_cache[1]
    repo, token = cfg
    release: GitHubRelease | None = None
    ttl = GITHUB_ERROR_CACHE_S
    try:
        async with client or _http(base_url=GITHUB_API, timeout=10) as c:
            r = await c.get(f"/repos/{repo}/releases/latest", headers=_github_headers(token))
            if r.status_code == 200:
                release = await _parse_github_release(c, r.json(), token)
                ttl = GITHUB_CACHE_S
            else:
                log.warning("GitHub releases lookup failed: HTTP %s", r.status_code)
    except httpx.HTTPError as e:
        log.warning("GitHub releases lookup failed: %s", type(e).__name__)
    _gh_cache = (time.monotonic() + ttl, release)
    return release


async def _parse_github_release(c: httpx.AsyncClient, rel: dict[str, Any], token: str) -> GitHubRelease | None:
    version = str(rel.get("tag_name", "")).removeprefix("v")
    if parse_version(version) is None or rel.get("draft") or rel.get("prerelease"):
        return None
    assets = {a["name"]: a for a in rel.get("assets", [])}
    exe = next((n for n in sorted(assets) if n.endswith("-setup.exe") and f"{n}.sig" in assets), None)
    if exe is None:
        return None
    sig = await c.get(assets[f"{exe}.sig"]["url"], headers=_github_headers(token, raw=True), follow_redirects=True)
    if sig.status_code != 200:
        log.warning("GitHub signature download failed: HTTP %s", sig.status_code)
        return None
    stamp = rel.get("published_at") or rel["created_at"]
    published = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    return GitHubRelease(version=version, installer_name=exe, installer_asset_url=assets[exe]["url"],
                         signature=sig.text.strip(), notes=(rel.get("body") or "").strip()[:4000] or None,
                         published=published)


async def _github_download_url(release: GitHubRelease) -> str | None:
    cfg = _github_config()
    if cfg is None:
        return None
    async with _http(timeout=10) as c:
        r = await c.get(release.installer_asset_url, headers=_github_headers(cfg[1], raw=True), follow_redirects=False)
    return r.headers.get("location") if r.status_code in (301, 302, 307) else None


# ---- endpoints ------------------------------------------------------------------------------------------


def _public_url(request: Request, **params: str) -> str:
    base = get_settings().api_public_url
    if base:  # never derive a download link from the request's Host header when the real address is known
        path = request.app.url_path_for("download_installer", **params)
        return base.rstrip("/") + str(path)
    url = str(request.url_for("download_installer", **params))
    # Behind Render/Cloudflare the app sees plain http; the updater should get the https URL clients used.
    if request.headers.get("x-forwarded-proto") == "https" and url.startswith("http://"):
        url = "https://" + url.removeprefix("http://")
    return url


@router.get("/update/{target}/{arch}/{current_version}")
async def check_update(target: str, arch: str, current_version: str, request: Request) -> Any:
    current = parse_version(current_version)
    if current is None or (target, arch) not in SUPPORTED:
        return Response(status_code=204)
    root = _root()
    if root is not None:
        local = latest_release(root)
        if local is None or (parse_version(local.version) or (0, 0, 0)) <= current:
            return Response(status_code=204)
        version, name, signature, notes, published = (local.version, local.installer.name, local.signature,
                                                      local.notes, local.published)
    else:
        gh = await github_latest_release()
        if gh is None or (parse_version(gh.version) or (0, 0, 0)) <= current:
            return Response(status_code=204)
        version, name, signature, notes, published = (gh.version, gh.installer_name, gh.signature, gh.notes,
                                                      gh.published)
    return {
        "version": version,
        "notes": notes or f"Orbit {version}",
        "pub_date": published.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "url": _public_url(request, version=version, filename=name),
        "signature": signature,
    }


@router.get("/download/{version}/{filename}", name="download_installer", response_model=None)
async def download_installer(version: str, filename: str) -> FileResponse | RedirectResponse:
    if parse_version(version) is None or not re.fullmatch(r"[\w.-]+-setup\.exe", filename):
        raise HTTPException(404, "Not found")
    root = _root()
    if root is None:
        gh = await github_latest_release()
        if gh is None or gh.version != version or gh.installer_name != filename:
            raise HTTPException(404, "Not found")
        location = await _github_download_url(gh)
        if location is None:
            raise HTTPException(502, "Update download unavailable")
        return RedirectResponse(location, status_code=302)
    path = (root / version / filename).resolve()
    if path.parent != (root / version).resolve() or not path.is_file():  # no traversal outside the release
        raise HTTPException(404, "Not found")
    return FileResponse(path, media_type="application/octet-stream", filename=filename)
