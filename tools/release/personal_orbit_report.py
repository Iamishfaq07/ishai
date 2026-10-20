"""Repeatable source/tool/public-health observations. No secrets, writes or release certification."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def command(*args: str) -> str:
    try:
        if args[0] == "cargo" and not shutil.which("cargo"):
            installed = Path.home() / ".cargo" / "bin" / "cargo.exe"
            if installed.is_file():
                args = (str(installed), *args[1:])
        result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=20, check=False)
        return result.stdout.strip() if result.returncode == 0 else f"UNVERIFIED (exit {result.returncode})"
    except (OSError, subprocess.TimeoutExpired) as exc:
        return f"BLOCKED ({type(exc).__name__})"


def probe(url: str) -> dict[str, object]:
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            body = json.loads(response.read(4096))
            # Only the documented public readiness/commit fields; never an arbitrary response/header dump.
            return {"status": response.status, "body": {key: body[key] for key in ("status", "commit", "checks")
                                                       if key in body}}
    except urllib.error.HTTPError as exc:
        return {"status": exc.code, "verification": "UNVERIFIED"}
    except (OSError, ValueError) as exc:
        return {"verification": "BLOCKED", "error": type(exc).__name__}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-read-only", action="store_true", help="Make one GET each to production health/ready")
    parser.add_argument("--output", type=Path, help="Save the observations as JSON")
    args = parser.parse_args()
    report: dict[str, object] = {
        "captured_at": datetime.now(UTC).isoformat(), "commit": command("git", "rev-parse", "HEAD"),
        "branch": command("git", "branch", "--show-current"), "working_changes": command("git", "status", "--short"),
        "tools": {name: command(name, "--version") for name in ("node", "uv", "cargo", "docker", "gh")},
        "test_results": "NOT RUN by this script; attach exact fresh command logs separately",
        "staging_provider_billing_backup_windows": "NOT VERIFIED by source/tool/health observations",
    }
    if args.public_read_only:
        report["public_health"] = {path: probe(f"https://api.orbitanswer.com/{path}") for path in ("health", "ready")}
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
