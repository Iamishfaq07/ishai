"""Resume maker: "Shorten with AI to fit one page" (resumes/shorten.py, `mode: "shorten"` on /v1/resumes/suggest)."""

import json

import pytest
from fastapi.testclient import TestClient

from orbit_api.resumes import ai, shorten
from orbit_api.resumes.ats import score_resume
from orbit_api.resumes.schema import ResumeData
from tests.test_api import _register
from tests.test_credits import _new_ip, _signup, enforce  # noqa: F401  (the fixture)
from tests.test_resume_audit import check_hidden, mock_llm, sent
from tests.test_resume_kit import credits_left, welcome  # noqa: F401  (the fixture)
from tests.test_resumes import strong_resume


def test_hidden_sections_never_reach_the_ai(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    check_hidden(client, monkeypatch, "/v1/resumes/suggest", {"mode": "shorten", "lines_over": 3},
                 used_when_shown=False)  # it picks the long lines only: the hidden ones aren't long


def _long() -> ResumeData:
    data = strong_resume()
    data.experience[0].bullets = [
        "Led the migration of the whole ledger to event sourcing on Kafka, which was successfully completed and cut "
        "reconciliation time by 60%",
        "Responsible for building and running 12 Python microservices on Kubernetes and Docker that were serving 3M "
        "transactions a day for the business",
        "Designed GraphQL and REST APIs that were used by 40 internal teams across the company with 99.99% uptime",
        "Reduced p95 latency from 800 ms to 120 ms",
    ]
    return data


def test_shorten_picks_the_lines_that_give_a_printed_line_back() -> None:
    data = _long()
    lines = shorten.pick_lines(data, score_resume(data), 1)
    ids = data.experience[0].id
    assert f"experience.{ids}.bullets.3" not in lines  # one line already
    assert lines and all(n < len(ai.editable_fields(data)[p][1].split()) for p, n in lines.items())
    assert len(shorten.pick_lines(data, score_resume(data), 40)) > len(lines)  # further over: more lines
    # Safe to apply in bulk: only filler or the last ", ..." clause went.
    assert shorten.only_cut("Successfully led the whole migration on Kafka", "Led the migration on Kafka")
    assert shorten.only_cut("Led the migration on Kafka, working with the data team", "Led the migration on Kafka")
    assert not shorten.only_cut("Responsible for building the API", "Built the API")  # reworded
    assert not shorten.only_cut("Focused calls on the merchants most likely to leave", "Focused calls")  # meaning cut
    assert not shorten.keeps_facts("Cut costs by 30% on AWS", "Cut costs on AWS")
    assert not shorten.keeps_facts("Cut costs by 30% on AWS", "Cut costs by 30%")
    assert not shorten.keeps_facts("Shipped it without downtime", "Shipped it with downtime")


def test_shorten_with_ai_keeps_every_figure_and_tool_and_marks_pure_cuts_safe(
        client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    h = _register(client)
    data = _long()
    role = data.experience[0].id
    b = [f"experience.{role}.bullets.{i}" for i in range(3)]
    llm = mock_llm(monkeypatch, json.dumps({"suggestions": [
        {"path": b[0], "after": "Led the migration of the ledger to event sourcing on Kafka and cut reconciliation "
                                "time by 60%", "reason": "Dropped the filler."},
        {"path": b[1], "after": "Built and ran 12 Python microservices on Kubernetes and Docker serving 3M "
                                "transactions a day", "reason": "Stronger opener."},
        {"path": b[2], "after": "Designed REST APIs used by 40 internal teams", "reason": "Shorter."},  # lost facts
    ]}))
    r = client.post("/v1/resumes/suggest", headers=h,
                    json={"data": data.model_dump(mode="json"), "mode": "shorten", "lines_over": 2})
    assert r.status_code == 200, r.text
    assert "lines_to_shorten" in sent(llm) and "max_words" in sent(llm)
    got = {s["path"]: s for s in r.json()["suggestions"]}
    assert set(got) == {b[0], b[1]}  # the one that dropped GraphQL and 99.99% is gone
    assert got[b[0]]["kind"] == "set" and "Only words taken out" in got[b[0]]["reason"]  # safe to apply in bulk
    assert got[b[1]]["kind"] == "rewrite"  # reworded: read it first
    assert " → " in got[b[0]]["label"] and got[b[0]]["before"] == data.experience[0].bullets[0]


def test_shorten_gives_the_credit_back_when_nothing_survives_and_refuses_short_resumes(
        client: TestClient, welcome: None, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    h = _signup(client, _new_ip())
    data = _long()
    path = f"experience.{data.experience[0].id}.bullets.0"
    mock_llm(monkeypatch, json.dumps({"suggestions": [{"path": path, "after": "Led the ledger migration"}]}))
    r = client.post("/v1/resumes/suggest", headers=h, json={"data": data.model_dump(mode="json"), "mode": "shorten"})
    assert r.status_code == 200 and r.json()["suggestions"] == [] and credits_left(client, h) == 1
    short = strong_resume()
    short.basics.summary = "Backend engineer."
    short.experience[0].bullets = ["Led the ledger migration"]
    short.experience = short.experience[:1]
    r = client.post("/v1/resumes/suggest", headers=h, json={"data": short.model_dump(mode="json"), "mode": "shorten"})
    assert r.status_code == 422 and "already as short" in r.json()["detail"] and credits_left(client, h) == 1
