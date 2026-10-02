"""The free resume maker: every tool works with no account, costs are capped, and nothing is stored."""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api import ratelimit
from orbit_api.config import get_settings
from orbit_api.db import sessionmaker
from orbit_api.models import ProviderRequest, Resume
from tests.test_api import _register
from tests.test_resumes import JOB, PASTED, strong_resume

BASE = "/v1/resume-maker"


def _body(**extra: Any) -> dict[str, Any]:
    return {"data": strong_resume().model_dump(mode="json"), **extra}


@pytest.fixture
def enforce_limits() -> Iterator[None]:
    ratelimit.reset_all()
    ratelimit.ENFORCE_IN_TESTS = True
    yield
    ratelimit.ENFORCE_IN_TESTS = False
    ratelimit.reset_all()


def test_everything_works_without_signing_in(client: TestClient) -> None:
    client.cookies.clear()
    score = client.post(f"{BASE}/score", json=_body(job_text=JOB))
    assert score.status_code == 200 and score.json()["has_job"] and score.json()["score"] > 50

    docx = client.post(f"{BASE}/docx", json=_body())
    assert docx.status_code == 200 and docx.content[:2] == b"PK"

    suggest = client.post(f"{BASE}/suggest", json=_body())
    assert suggest.status_code == 200 and suggest.json()["suggestions"]
    assert client.post(f"{BASE}/suggest", json=_body(check="skills_count")).status_code in (200, 422)

    letter = client.post(f"{BASE}/cover-letter", json={"data": strong_resume().model_dump(mode="json"),
                                                       "job_text": JOB})
    assert letter.status_code == 200 and letter.json()["text"].startswith("Dear")
    assert client.post(f"{BASE}/cover-letter/docx", json={"text": letter.json()["text"],
                                                          "data": strong_resume().model_dump(mode="json")}
                       ).content[:2] == b"PK"

    imported = client.post(f"{BASE}/import", json={"source": "text", "text": PASTED})
    assert imported.status_code == 200 and imported.json()["data"]["basics"]["name"] == "Priya Raman"
    file = client.post(f"{BASE}/import-file", files={"file": ("cv.txt", PASTED.encode(), "text/plain")})
    assert file.status_code == 200 and file.json()["data"]["basics"]["name"] == "Priya Raman"


def test_documents_belong_to_an_account_so_guests_cannot_import_them(client: TestClient) -> None:
    r = client.post(f"{BASE}/import", json={"source": "document", "document_id": "x"})
    assert r.status_code == 422


def test_nothing_is_saved_on_the_server_and_ai_calls_are_not_tied_to_a_user(client: TestClient) -> None:
    import asyncio

    from sqlalchemy import func

    async def counts() -> tuple[int, int]:
        async with sessionmaker()() as db:
            guest = await db.scalar(select(func.count()).select_from(ProviderRequest).where(
                ProviderRequest.user_id.is_(None), ProviderRequest.request_type == "resume_suggest"))
            return int(guest or 0), int(await db.scalar(select(func.count()).select_from(Resume)) or 0)

    h = _register(client)
    client.cookies.clear()
    guest_before, resumes_before = asyncio.run(counts())
    assert client.post(f"{BASE}/suggest", json=_body()).status_code == 200
    guest_after, resumes_after = asyncio.run(counts())
    assert guest_after == guest_before + 1 and resumes_after == resumes_before  # logged without a user; nothing stored

    assert client.get("/v1/resumes").status_code == 401  # the account endpoints still need a sign-in
    assert client.post("/v1/resumes", json={"title": "x"}).status_code == 401
    assert client.get("/v1/resumes", headers=h).json() == []


def test_signed_out_ai_is_limited_per_address(client: TestClient, enforce_limits: None) -> None:
    codes = [client.post(f"{BASE}/suggest", json=_body()).status_code for _ in range(9)]
    assert codes[:6] == [200] * 6 and codes[-1] == 429
    # Scoring is cheap and stays available.
    assert client.post(f"{BASE}/score", json=_body()).status_code == 200


def test_signed_out_ai_stops_at_the_daily_cap(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from sqlalchemy import func

    async def used() -> int:
        async with sessionmaker()() as db:
            return int(await db.scalar(select(func.count()).select_from(ProviderRequest).where(
                ProviderRequest.user_id.is_(None))) or 0)

    already = asyncio.run(used())  # other tests in this run have made signed-out calls too
    monkeypatch.setattr(get_settings(), "guest_resume_ai_daily_limit", already + 2)
    assert client.post(f"{BASE}/suggest", json=_body()).status_code == 200
    assert client.post(f"{BASE}/suggest", json=_body()).status_code == 200
    r = client.post(f"{BASE}/suggest", json=_body())
    assert r.status_code == 503 and "tomorrow" in r.json()["detail"]
    assert client.post(f"{BASE}/score", json=_body()).status_code == 200  # only the AI is capped
    monkeypatch.setattr(get_settings(), "guest_resume_ai_daily_limit", 0)
    assert client.post(f"{BASE}/suggest", json=_body()).status_code == 503  # 0 turns signed-out AI off
