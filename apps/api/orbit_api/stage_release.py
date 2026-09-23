"""Stage a Windows build (the CI `orbit-windows` artifact) into ORBIT_DESKTOP_UPDATES_DIR.

    uv run python -m orbit_api.stage_release <artifact_dir> <updates_dir> [--notes "What's new"]

Finds Orbit_<version>_x64-setup.exe + its .sig, derives the version from the file name, and copies
both into <updates_dir>/<version>/. Refuses unsigned installers and never overwrites a published
version (a changed binary under an existing version number would confuse every client).
"""

import argparse
import re
import shutil
import sys
from pathlib import Path

_NAME = re.compile(r"^Orbit_(\d+\.\d+\.\d+)_x64-setup\.exe$")


def find_installer(artifact_dir: Path) -> tuple[Path, str]:
    matches = [(p, m[1]) for p in artifact_dir.rglob("*-setup.exe") if (m := _NAME.match(p.name))]
    if len(matches) != 1:
        raise SystemExit(
            f"expected exactly one Orbit_<version>_x64-setup.exe under {artifact_dir}, found {len(matches)}"
        )
    return matches[0]


def stage(artifact_dir: Path, updates_dir: Path, notes: str | None) -> Path:
    exe, version = find_installer(artifact_dir)
    sig = exe.with_name(exe.name + ".sig")
    if not sig.is_file() or not sig.read_text(encoding="utf-8").strip():
        raise SystemExit(f"{sig.name} missing or empty: build with TAURI_SIGNING_PRIVATE_KEY set")
    dest = updates_dir / version
    if dest.exists():
        raise SystemExit(f"{dest} already exists; bump the version instead of replacing a release")
    dest.mkdir(parents=True)
    shutil.copy2(exe, dest / exe.name)
    shutil.copy2(sig, dest / sig.name)
    if notes:
        (dest / "notes.md").write_text(notes.strip() + "\n", encoding="utf-8")
    return dest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("artifact_dir", type=Path)
    ap.add_argument("updates_dir", type=Path)
    ap.add_argument("--notes", default=None)
    args = ap.parse_args(argv)
    dest = stage(args.artifact_dir, args.updates_dir, args.notes)
    print(f"staged {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
