import os
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

_tmp = Path(tempfile.mkdtemp(prefix="orbit-test-"))
_sqlite = f"sqlite+aiosqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ.update(
    ORBIT_ENV="test",
    ORBIT_PROXY_SECRET="test-fixture-Q8f2LmZr7Tq1VbN4xKc9WsYe3HpJd6Ug",
    # SQLite by default. ORBIT_TEST_DATABASE_URL points a run at a disposable Postgres instead, for the tests whose
    # point is locking and constraints (tests/test_support_lifecycle.py and the other race tests run there in CI).
    ORBIT_DATABASE_URL=os.environ.get("ORBIT_TEST_DATABASE_URL") or _sqlite,
    ORBIT_LLM_PROVIDER="mock",
    ORBIT_STT_PROVIDER="mock",
    ORBIT_JWT_SECRET="test-secret-" + "x" * 32,
    ORBIT_JOB_POLL_S="0.05",
    ORBIT_SPOOL_DIR=str(_tmp),
    ORBIT_DEV_OUTBOX=str(_tmp / "outbox.txt"),
    # Prices in the suites are list prices; tests/test_first_purchase.py switches the first-purchase offer on.
    ORBIT_FIRST_PURCHASE_PERCENT="0",
)
if os.environ.get("RUN_PROVIDER_SMOKE", "").lower() != "true":  # tests/smoke needs the real keys
    for key in ("DEEPSEEK_API_KEY", "DEEPGRAM_API_KEY"):
        os.environ.pop(key, None)
    # A developer's own apps/api/.env (Razorpay or provider keys) never reaches the suite: tests set what they need.
    from orbit_api.config import Settings

    Settings.model_config["env_file"] = None


@pytest.fixture
def client() -> Iterator["TestClient"]:  # type: ignore[name-defined]  # noqa: F821
    from fastapi.testclient import TestClient

    from orbit_api.main import create_app

    with TestClient(create_app()) as c:
        yield c

