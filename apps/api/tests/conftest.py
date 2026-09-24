import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

_tmp = Path(tempfile.mkdtemp(prefix="orbit-test-"))
os.environ.update(
    ORBIT_ENV="test",
    ORBIT_DATABASE_URL=f"sqlite+aiosqlite:///{(_tmp / 'test.db').as_posix()}",
    ORBIT_LLM_PROVIDER="mock",
    ORBIT_STT_PROVIDER="mock",
    ORBIT_JWT_SECRET="test-secret-" + "x" * 32,
    ORBIT_JOB_POLL_S="0.05",
    ORBIT_SPOOL_DIR=str(_tmp),
)
if os.environ.get("RUN_PROVIDER_SMOKE", "").lower() != "true":  # tests/smoke needs the real keys
    for key in ("DEEPSEEK_API_KEY", "DEEPGRAM_API_KEY"):
        os.environ.pop(key, None)


@pytest.fixture
def client() -> Iterator["TestClient"]:  # type: ignore[name-defined]  # noqa: F821
    from fastapi.testclient import TestClient

    from orbit_api.main import create_app

    with TestClient(create_app()) as c:
        yield c

