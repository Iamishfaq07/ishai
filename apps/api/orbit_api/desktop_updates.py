"""Desktop auto-update server for the Tauri updater (dynamic-server protocol).

Layout under ORBIT_DESKTOP_UPDATES_DIR (one folder per released version):

    0.1.1/Orbit_0.1.1_x64-setup.exe
    0.1.1/Orbit_0.1.1_x64-setup.exe.sig      (minisign signature produced by `tauri build`)
    0.1.1/notes.md                           (optional release notes)

GET /v1/desktop/update/{target}/{arch}/{current_version} → 204 when up to date, else the manifest.
Unauthenticated by design: the updater can't send user credentials, and every installer is verified
on the client against the public key compiled into the app, so serving it openly is safe.
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from orbit_api.config import get_settings

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


@router.get("/update/{target}/{arch}/{current_version}")
async def check_update(target: str, arch: str, current_version: str, request: Request) -> Any:
    current = parse_version(current_version)
    root = _root()
    if current is None or (target, arch) not in SUPPORTED or root is None:
        return Response(status_code=204)
    release = latest_release(root)
    if release is None or (parse_version(release.version) or (0, 0, 0)) <= current:
        return Response(status_code=204)
    return {
        "version": release.version,
        "notes": release.notes or f"Orbit {release.version}",
        "pub_date": release.published.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "url": str(request.url_for("download_installer", version=release.version, filename=release.installer.name)),
        "signature": release.signature,
    }


@router.get("/download/{version}/{filename}", name="download_installer")
async def download_installer(version: str, filename: str) -> FileResponse:
    root = _root()
    if root is None or parse_version(version) is None or not re.fullmatch(r"[\w.-]+-setup\.exe", filename):
        raise HTTPException(404, "Not found")
    path = (root / version / filename).resolve()
    if path.parent != (root / version).resolve() or not path.is_file():  # no traversal outside the release
        raise HTTPException(404, "Not found")
    return FileResponse(path, media_type="application/octet-stream", filename=filename)
