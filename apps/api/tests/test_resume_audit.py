"""Resume maker fixes from an audit: hidden sections never reach the AI, the cost log names the provider that answered
(with the latency, and failures), and import keeps every project bullet the editor allows."""

import json
from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from orbit_api.db import sessionmaker
from orbit_api.models import ProviderRequest
from orbit_api.providers.llm.base import LLMChunk, LLMError, LLMRequest
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.resumes import ai, routes
from orbit_api.resumes.schema import Project, ResumeData
from tests.test_api import _register
from tests.test_resumes import JOB, strong_resume

HIDDEN = "Zebrafish"  # a word only the hidden sections have


def with_hidden() -> ResumeData:
    """The strong resume plus a summary sentence and a project that are hidden from it."""
    data = strong_resume()
    data.basics.summary += f" Volunteers at the {HIDDEN} rescue on weekends."
    data.projects = [Project(name=f"{HIDDEN} tracker", description=f"Counts {HIDDEN} sightings for the lab",
                             bullets=[f"Logged 300 {HIDDEN} sightings a season with a small Python script"])]
    data.hidden = ["summary", "projects"]
    # Long enough that "Shorten with AI" has a line to work on.
    data.experience[0].bullets[0] += " across the whole ledger and every one of the reconciliation jobs it fed"
    return data


def mock_llm(monkeypatch: pytest.MonkeyPatch, *script: str) -> MockLLMProvider:
    """A mock that records what it was sent (and answers `script`, in order, when given)."""
    llm = MockLLMProvider(script=list(script) or None)
    monkeypatch.setattr(routes, "get_llm_provider", lambda: llm)
    return llm


def sent(llm: MockLLMProvider) -> str:
    return "\n".join(m.content for r in llm.requests for m in r.messages)


def check_hidden(client: TestClient, monkeypatch: pytest.MonkeyPatch, path: str, extra: dict[str, Any], *,
                 used_when_shown: bool = True) -> None:
    """`path` sends nothing of a hidden section to the AI, and (`used_when_shown`) does once it's shown again."""
    h = _register(client)
    data = with_hidden()
    llm = mock_llm(monkeypatch)
    r = client.post(path, headers=h, json={"data": data.model_dump(mode="json"), "job_text": JOB, **extra})
    assert r.status_code == 200, r.text
    assert llm.requests and HIDDEN not in sent(llm) and HIDDEN not in r.text
    assert "event sourcing" in sent(llm)  # the visible resume was sent
    if used_when_shown:
        seen = mock_llm(monkeypatch)
        client.post(path, headers=h, json={"data": data.model_copy(update={"hidden": []}).model_dump(mode="json"),
                                           "job_text": JOB, **extra})
        assert HIDDEN in sent(seen)


@pytest.mark.parametrize(("path", "extra"), [
    ("/v1/resumes/suggest", {"mode": "improve"}),
    ("/v1/resumes/suggest", {"mode": "tailor"}),
    ("/v1/resumes/fix", {}),
    ("/v1/resumes/cover-letter", {}),
], ids=lambda v: v if isinstance(v, str) else json.dumps(v))
def test_hidden_sections_never_reach_the_ai(client: TestClient, monkeypatch: pytest.MonkeyPatch, path: str,
                                            extra: dict[str, Any]) -> None:
    check_hidden(client, monkeypatch, path, extra)


# ---- the cost log ---------------------------------------------------------------------------------------------


class _Backup(MockLLMProvider):
    """Answers as the backup provider would after the primary failed over."""

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        first = True
        async for chunk in super().stream(request):
            if first:
                chunk.provider, chunk.model, first = "backup", "backup-model", False
            yield chunk


def _logged(client: TestClient, h: dict[str, str]) -> list[ProviderRequest]:
    user_id = client.get("/v1/auth/me", headers=h).json()["id"]

    async def go() -> list[ProviderRequest]:
        async with sessionmaker()() as db:
            return list((await db.scalars(select(ProviderRequest).where(ProviderRequest.user_id == user_id)
                                          .order_by(ProviderRequest.created_at))).all())

    assert client.portal is not None
    return client.portal.call(go)


def test_the_cost_log_names_who_answered_how_long_it_took_and_failures(client: TestClient,
                                                                        monkeypatch: pytest.MonkeyPatch) -> None:
    class Down(MockLLMProvider):
        name = "deepseek"

        async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
            raise LLMError("http_503", "down", retryable=True)
            yield LLMChunk()  # pragma: no cover

    h = _register(client)
    body = {"data": strong_resume().model_dump(mode="json"), "job_text": JOB}
    monkeypatch.setattr(routes, "get_llm_provider", lambda: _Backup())
    assert client.post("/v1/resumes/cover-letter", headers=h, json=body).status_code == 200
    monkeypatch.setattr(routes, "get_llm_provider", lambda: Down())
    assert client.post("/v1/resumes/cover-letter", headers=h, json=body).status_code == 503
    served, failed = _logged(client, h)
    assert (served.provider, served.model, served.ok, served.request_type) == ("backup", "backup-model", True,
                                                                               "cover_letter")
    assert served.latency_ms >= 0 and served.output_tokens > 0
    assert (failed.provider, failed.model, failed.ok, failed.output_tokens) == ("deepseek", "mock", False, 0)


# ---- import ---------------------------------------------------------------------------------------------------


def test_import_keeps_up_to_twelve_project_bullets() -> None:
    raw = {"basics": {"name": "Asha Rao"},
           "projects": [{"name": "Ledger", "bullets": [f"Built part {i} of the ledger" for i in range(15)]}]}
    assert len(ai.parse_structured(json.dumps(raw)).projects[0].bullets) == 12
