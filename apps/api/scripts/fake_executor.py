"""A stand-in for the extension's executor, for the end-to-end run: leases packets from `GET /v1/apply/next` with an
extension-scoped token and reports each result from a scenario, like "submitted,needs_you:captcha". It never opens a
browser or touches a real site. It only speaks the contract (docs/PROTOCOL.md "Orbit Apply").

    uv run python scripts/fake_executor.py --api http://127.0.0.1:8039 --token <extension token> \
        --scenario submitted,needs_you:captcha
"""

from __future__ import annotations

import argparse
import base64
import json
import struct
import sys
import zlib

import httpx


def png(width: int = 320, height: int = 180) -> str:
    """A confirmation "screenshot": a plain green PNG, made here."""
    row = b"\x00" + b"\x22\xaa\x55" * width
    raw = row * height

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    body = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return base64.b64encode(body).decode()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--scenario", default="submitted")
    args = ap.parse_args()
    h = {"Authorization": f"Bearer {args.token}"}
    out = []
    with httpx.Client(base_url=args.api, headers=h, timeout=20) as c:
        for step in args.scenario.split(","):
            status, _, reason = step.partition(":")
            r = c.get("/v1/apply/next")
            if r.status_code == 204:
                out.append({"step": step, "next": 204, "why": r.headers.get("X-Orbit-Apply-Why")})
                continue
            r.raise_for_status()
            p = r.json()
            pdf = httpx.get(p["resume"]["download_url"], timeout=20)
            filled = {k: v for k, v in p["fields"].items() if v}
            body = {"status": status, "reason": reason or None, "screenshot_png_b64": png(),
                    "submitted": {"fields": filled, "answers": [{"label": a["label"], "value": a["value"]}
                                                                for a in p["answers"]]}}
            if status == "submitted":
                body["confirmation_text"] = f"Thank you for applying to {p['job']['company']}."
                body["final_url"] = p["job"]["apply_url"] + "?submitted=1"
            res = c.post(f"/v1/apply/{p['id']}/result", json=body)
            res.raise_for_status()
            out.append({"step": step, "packet": p["id"], "company": p["job"]["company"], "ats": p["job"]["ats"],
                        "pdf": pdf.status_code, "pdf_is_pdf": pdf.content.startswith(b"%PDF"),
                        "answers": len(p["answers"]), "result": res.json()})
        out.append({"status": c.get("/v1/apply/status").json()})
    json.dump(out, sys.stdout, indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
