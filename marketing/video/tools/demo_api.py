"""The local API for recording the launch videos' fixtures: the real orbit_api app, with its mock AI answering from
written demo content (marketing/video/fixtures/demo_llm.py) where there is some, and its own mock words otherwise.

Dev only. It refuses to start unless the AI provider is the mock and the database is a SQLite file in a temp folder,
so it can't touch real data or call a real model. Run from apps/api:

    ORBIT_DATABASE_URL=sqlite+aiosqlite:///C:/.../Temp/orbit-video/stack/db.sqlite ORBIT_LLM_PROVIDER=mock \\
      ORBIT_STT_PROVIDER=mock uv run python ../../marketing/video/tools/demo_api.py --port 8034
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

db = os.environ.get("ORBIT_DATABASE_URL", "")
db_file = db.split("///", 1)[-1].lower()
if not db.startswith("sqlite") or not any(t in db_file for t in ("/temp/", "\\temp\\", "/tmp/")):
    sys.exit(f"refusing: ORBIT_DATABASE_URL must be a SQLite file in a temp folder, not {db!r}")
if os.environ.get("ORBIT_LLM_PROVIDER") != "mock" or os.environ.get("ORBIT_STT_PROVIDER") != "mock":
    sys.exit("refusing: ORBIT_LLM_PROVIDER and ORBIT_STT_PROVIDER must be mock")

sys.path.insert(0, str(HERE.parent / "fixtures"))
import demo_llm  # noqa: E402

from orbit_api.providers.llm import mock  # noqa: E402

_own = mock.MockLLMProvider._response_for
LOG = os.environ.get("DEMO_LLM_LOG")  # one line per AI request: its type and whose words answered


def _scripted(self: mock.MockLLMProvider, request: mock.LLMRequest) -> str:
    body = request.messages[-1].content if request.messages else ""
    said = demo_llm.respond(request.request_type, body)
    if LOG:
        with open(LOG, "a", encoding="utf-8") as fh:
            fh.write(f"{request.request_type}\t{'demo' if said is not None else 'mock'}\t{len(body)}\n")
    return said if said is not None else _own(self, request)


mock.MockLLMProvider._response_for = _scripted  # type: ignore[method-assign]

if __name__ == "__main__":
    import uvicorn

    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=8034)
    a = p.parse_args()
    uvicorn.run("orbit_api.main:app", host="127.0.0.1", port=a.port, log_level="warning")
