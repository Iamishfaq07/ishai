"""The month's screenshot answers: uploads at the same moment can't all take the last one left (the charge only lands
when the answer is delivered, so the check alone let them through), and a Free account counts only the screenshots
it took on Free, not the ones of a paid plan that has run out."""

import asyncio
import io
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from orbit_api.db import sessionmaker
from orbit_api.entitlements import plans
from orbit_api.models import UsageEvent, User
from orbit_api.sessions import routes as sessions
from tests.test_api import _register
from tests.test_scrolling_screenshots import _png

PNG = _png(400, 300)


class _Engine:
    """Stands in for a live session's engine: the answer takes a moment to start, as a real one does."""

    ended = False

    async def answer_screenshot(self, parts: Any) -> str:
        await asyncio.sleep(0.2)
        return str(uuid.uuid4())


def _setup(client: TestClient) -> tuple[str, str]:
    _register(client)  # the first account stands in as the admin (no limits) when this runs alone
    h = _register(client)
    uid = client.get("/v1/auth/me", headers=h).json()["id"]
    sid = client.post("/v1/sessions", headers=h, json={"title": "shots"}).json()["id"]
    return uid, sid


def _taken(client: TestClient, uid: str, sid: str, n: int, pool: str | None) -> None:
    async def go() -> None:
        async with sessionmaker()() as db:
            for _ in range(n):
                db.add(UsageEvent(user_id=uid, session_id=sid, metric="screenshots", quantity=1, pool=pool,
                                  idempotency_key=f"shot:{uuid.uuid4()}", created_at=datetime.now(UTC)))
            await db.commit()

    client.portal.call(go)  # type: ignore[union-attr]


def _upload(client: TestClient, uid: str, sid: str, count: int) -> list[int]:
    async def one() -> int:
        async with sessionmaker()() as db:
            user = await db.get(User, uid)
            assert user is not None
            image = UploadFile(io.BytesIO(PNG), filename="s.png", headers=Headers({"content-type": "image/png"}))
            try:
                await sessions.upload_screenshot(sid, image, user, db)
            except HTTPException as e:
                return e.status_code
            return 202

    async def all_at_once() -> list[int]:
        return sorted(await asyncio.gather(*(one() for _ in range(count))))

    return list(client.portal.call(all_at_once))  # type: ignore[union-attr]


@pytest.fixture
def engine(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Any:
    monkeypatch.setattr(sessions, "_live_engines", _Engines())
    return client


class _Engines(dict[str, Any]):
    def get(self, key: str, default: Any = None) -> Any:  # every session has a running engine
        return _Engine()


def test_uploads_at_once_cant_all_take_the_last_screenshot(engine: TestClient) -> None:
    limit = plans()["free"].screenshots
    assert limit is not None
    uid, sid = _setup(engine)
    _taken(engine, uid, sid, limit - 1, "credits")
    assert _upload(engine, uid, sid, 3) == [202, 402, 402]


def test_a_free_account_counts_only_its_free_screenshots(engine: TestClient) -> None:
    """A paid plan's screenshots (its own pool) came out of the Free allowance once the plan ran out."""
    limit = plans()["free"].screenshots
    assert limit is not None
    uid, sid = _setup(engine)
    _taken(engine, uid, sid, limit, "premium")  # taken this month on a Premium week that has ended
    assert _upload(engine, uid, sid, 1) == [202]
    _taken(engine, uid, sid, limit, None)  # rows from before pools were recorded still count
    assert _upload(engine, uid, sid, 1) == [402]


def test_a_delivered_screenshot_is_charged_on_the_plan_it_was_taken_on(client: TestClient) -> None:
    from orbit_api.sessions.recorder import DbRecorder, InterviewTime

    async def charged() -> Any:
        rec = DbRecorder("s", "u", store_transcripts=False, minutes=InterviewTime("live:x", pool="credits"))
        seen: list[Any] = []
        rec._put = seen.append  # type: ignore[method-assign]
        await rec.usage("screenshots", 1, "shot:q")
        await rec.usage("stt_seconds", 3.0, "stt:x")
        rec._worker.cancel()
        return [(e.metric, e.pool) for e in seen]

    assert client.portal.call(charged) == [("screenshots", "credits"), ("stt_seconds", None)]  # type: ignore[union-attr]
