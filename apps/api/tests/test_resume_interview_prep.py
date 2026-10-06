"""Interview prep from the resume (resumes/interview_prep.py): the questions an interviewer will ask about it, grounded
in it; the skill gap against the job post, starting from the ATS score's keywords; one resume credit each, given back
when the AI fails; hidden sections never reach the AI; and the mock interviewer asks the questions it's given."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.config import get_settings
from orbit_api.live.mock_interviewer import DrillItem
from orbit_api.providers.llm.base import LLMError, LLMRequest, LLMResponse
from orbit_api.providers.llm.mock import MockLLMProvider
from orbit_api.resumes import interview_prep as ip
from orbit_api.resumes import routes
from orbit_api.resumes.ats import score_resume
from orbit_api.resumes.claims import invented_figures
from orbit_api.resumes.schema import Basics, Experience, Project, ResumeData, SkillGroup
from tests.test_api import _register
from tests.test_credits import _new_ip, _signup, enforce  # noqa: F401 (the fixture)
from tests.test_mock_drill import _drill_engine, _say
from tests.test_resumes import JOB, strong_resume


@pytest.fixture
def welcome(enforce: None, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    """Credits enforced, and every new account gets its welcome credit (the suite signs up past the daily cap)."""
    monkeypatch.setattr(get_settings(), "welcome_daily_limit", 10**9)


def resume() -> ResumeData:
    data = strong_resume()
    data.projects = [Project(name="Ledger CLI", description="A command-line ledger in Go for small shops",
                             bullets=["Wrote the double-entry engine and its tests"])]
    return data


class Recording(MockLLMProvider):
    """The mock provider, keeping every prompt it was sent (or answering with `script`)."""

    def __init__(self, script: list[str] | None = None) -> None:
        super().__init__(script=script)
        self.prompts: list[str] = []

    async def generate(self, request: LLMRequest) -> LLMResponse:
        self.prompts.append("\n".join(m.content for m in request.messages))
        return await super().generate(request)


def _use(monkeypatch: pytest.MonkeyPatch, llm: Any) -> Any:
    monkeypatch.setattr(routes, "get_llm_provider", lambda: llm)
    return llm


def _post(client: TestClient, h: dict[str, str], what: str, data: ResumeData, job_text: str = "") -> Any:
    return client.post(f"/v1/resumes/prep/{what}", headers=h,
                       json={"data": data.model_dump(mode="json"), "job_text": job_text})


# ---- questions ----------------------------------------------------------------------------------------------------


def test_questions_come_by_role_and_project_and_from_the_job_post(client: TestClient) -> None:
    h = _register(client)
    data = resume()
    r = _post(client, h, "questions", data, JOB)
    assert r.status_code == 200, r.text
    out = r.json()
    groups = {g["id"]: g for g in out["groups"]}
    assert [g["kind"] for g in out["groups"]] == ["role", "role", "project", "job"]
    assert groups[data.experience[0].id]["label"] == "Senior Engineer at PayCo"
    assert {q["group"] for q in out["questions"]} == set(groups)
    assert out["role"]
    behavioural = next(q for q in out["questions"] if q["type"] == "behavioral")
    # The whole story, in order: what the resume doesn't give is a prompt for the candidate, never a guess.
    assert [p["label"] for p in behavioural["outline"]] == ["Situation", "Task", "Action", "Result"]
    assert [p["ask"] for p in behavioural["outline"]] == [False, True, False, True]
    corpus = ip._corpus(data)
    for q in out["questions"]:
        for p in q["outline"]:
            assert p["ask"] or not invented_figures(p["text"], corpus)

    without = _post(client, h, "questions", data).json()
    assert "job" not in {g["id"] for g in without["groups"]}


def test_a_resume_with_nothing_to_ask_about_is_refused_before_the_ai(client: TestClient,
                                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    llm = _use(monkeypatch, Recording())
    r = _post(client, _register(client), "questions", ResumeData(basics=Basics(name="Sam")))
    assert r.status_code == 422 and not llm.prompts


def _answer(*questions: dict[str, Any], role: str = "Senior Backend Engineer") -> str:
    return json.dumps({"role": role, "questions": list(questions)})


def test_outlines_say_only_what_the_resume_does() -> None:
    data = resume()
    role = data.experience[0].id
    text = _answer(
        {"group": role, "type": "behavioral",
         "question": "You led the migration of the ledger to event sourcing on Kafka. Why event sourcing?",
         "outline": ["Situation: reconciliation was slow at PayCo",
                     "Task: Describe what you were asked to own",
                     "Action: moved the ledger to event sourcing on Kafka, saving the team 45 hours a week",
                     "Result: cut reconciliation time by 60% using Snowflake"],
         "missing": [], "defend": "Be ready to say how you measured the 60% and the 45% too.", "example": ""},
        {"group": role, "type": "technical", "question": "Your 75% latency cut: how did you measure it?",
         "outline": ["Redis caching"], "missing": [], "defend": "", "example": ""},  # misquotes the resume
        {"group": role, "type": "technical", "question": "How would you run the ledger on Snowflake instead?",
         "outline": ["Snowflake"], "missing": [], "defend": "", "example": ""},  # a tool in neither
        {"group": "job", "type": "role", "question": "The post asks for Datadog. How did you monitor the services?",
         "outline": ["Built 12 Python microservices on Kubernetes", "[how you were alerted]"], "missing": [],
         "defend": "", "example": ""},
        {"group": "nope", "type": "role", "question": "Why are you leaving PayCo after six years?",
         "outline": ["Looking for a senior backend role on a platform team"], "missing": [], "defend": "",
         "example": ""},
    )
    out = ip.parse_questions(text, data.visible(), JOB)
    first, other, job = out.questions
    star = {p.label: p for p in first.outline}
    assert star["Situation"].text == "reconciliation was slow at PayCo" and not star["Situation"].ask
    assert star["Task"].ask and star["Task"].text.startswith("Describe what you were asked")  # an instruction
    assert "45" not in star["Action"].text and "event sourcing on Kafka" in star["Action"].text
    assert star["Result"].ask and star["Result"].text == ip.STAR_ASK["Result"]  # it named a tool the resume lacks
    assert "45%" not in first.defend and "60%" in first.defend
    assert job.group == "job" and job.missing == ["Add how you were alerted"]
    assert other.group == "general"
    assert [g.id for g in out.groups] == [data.experience[0].id, "general", "job"]


def test_garbage_or_an_empty_answer_is_an_error() -> None:
    with pytest.raises(ValueError):
        ip.parse_questions(_answer(), resume(), "")
    with pytest.raises(ValueError):
        ip.parse_questions(_answer({"group": "general", "question": "Hi?"}), resume(), "")  # too short to be one


def test_probe_points_find_what_interviewers_push_on() -> None:
    data = ResumeData(
        experience=[
            Experience(title="Team Lead", company="Acme", start="Mar 2023", end="Dec 2023",
                       bullets=["Led a team of 6 engineers", "Wrote the docs"]),
            Experience(title="Engineer", company="Beta", start="Jan 2019", end="Jun 2022",
                       bullets=["Cut costs by 30%"]),
            Experience(title="Intern", company="Gamma", start="Sep 2018", end="Dec 2018"),
        ],
        projects=[Project(name="Bot", description="A chat bot in Python")],
        skills=[SkillGroup(items=["Python", "Kubernetes"])])
    probes = ip.probe_points(data, today=(2024, 6))
    kinds = {(p["group"], p["kind"]) for p in probes}
    lead, beta = data.experience[0].id, data.experience[1].id
    assert (lead, "number, team_size, ownership") in kinds and (beta, "number") in kinds
    assert (lead, "short_stint") in kinds and (data.experience[2].id, "short_stint") not in kinds  # an internship
    lines = {p["kind"]: p["line"] for p in probes if p["group"] == "general"}
    assert "Jun 2022" in lines["gap"] and "Mar 2023" in lines["gap"] and "about 8 months" in lines["gap"]
    assert "Dec 2023" in lines["not_working"]
    assert lines["unbacked_skill"].startswith("Kubernetes")  # Python is in the project; Kubernetes nowhere


def test_hidden_sections_never_reach_the_ai(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    llm = _use(monkeypatch, Recording())
    h = _register(client)
    data = resume()
    data.skills.append(SkillGroup(name="Secret", items=["Snowflake"]))
    data = ResumeData.model_validate({**data.model_dump(), "hidden": ["projects", "skills"]})
    out = _post(client, h, "questions", data, JOB).json()
    gaps = _post(client, h, "skill-gap", data, JOB).json()
    assert len(llm.prompts) == 2
    for prompt in llm.prompts:
        assert "Ledger CLI" not in prompt and "double-entry" not in prompt and "Snowflake" not in prompt
    assert "project" not in {g["kind"] for g in out["groups"]}
    # The hidden skills don't count as shown either: the gap starts from the same keywords as the ATS score.
    assert [g["skill"] for g in gaps["gaps"] if g["keyword"]] == score_resume(data, job_text=JOB).keywords.missing


# ---- skill gap ----------------------------------------------------------------------------------------------------


def test_skill_gap_needs_a_job_post_and_starts_from_the_score_tabs_keywords(client: TestClient,
                                                                            monkeypatch: pytest.MonkeyPatch) -> None:
    llm = _use(monkeypatch, Recording())
    h = _register(client)
    data = resume()
    data.skills = [SkillGroup(name="Languages", items=["Python", "SQL"])]
    r = _post(client, h, "skill-gap", data)
    assert r.status_code == 422 and "job post" in r.json()["detail"] and not llm.prompts
    r = _post(client, h, "skill-gap", data, JOB)
    assert r.status_code == 200, r.text
    report = score_resume(data, job_text=JOB)
    assert report.keywords is not None and report.keywords.missing
    assert [g["skill"] for g in r.json()["gaps"]] == report.keywords.missing
    assert r.json()["matched"] == report.keywords.matched
    assert {g["verdict"] for g in r.json()["gaps"]} == {"dont_claim", "prepare"}


def test_related_experience_must_be_on_the_resume() -> None:
    data = resume().visible()
    line = "Built 12 Python microservices on Kubernetes and Docker"  # the start of a real bullet
    gaps = ip.parse_gaps(json.dumps({"gaps": [
        {"skill": "Terraform", "verdict": "related", "evidence": line,
         "say": "I haven't used Terraform, but I built 12 services on Kubernetes and Docker.", "prepare": ""},
        {"skill": "Kafka Streams", "verdict": "related", "evidence": "Ran Kafka Streams jobs for fraud scoring",
         "say": "I ran Kafka Streams jobs.", "prepare": "Read the Kafka Streams docs."},  # not on the resume
        {"skill": "Spark", "verdict": "related", "evidence": line,
         "say": "I used Airflow to schedule them.", "prepare": ""},  # a tool the resume doesn't name
        {"skill": "Brightline", "verdict": "skip"},
        {"skill": "Python", "verdict": "skip"},  # a skill can't be skipped
        {"skill": "5+ years of backend experience", "verdict": "related"},  # the resume shows 7
        {"skill": "Rust or Python", "verdict": "prepare"},  # Python again
        {"skill": "A pilot's licence", "verdict": "dont_claim"},  # not in the post
        {"skill": "Payments domain knowledge", "verdict": "dont_claim", "note": ""},
    ]}), data, JOB + "\nPayments domain knowledge is a plus. 5+ years of backend experience.",
        ["Terraform", "Kafka Streams", "Spark", "Brightline", "Python"])
    by = {g.skill: g for g in gaps}
    assert list(by) == ["Terraform", "Kafka Streams", "Spark", "Python", "Payments domain knowledge"]
    assert by["Terraform"].verdict == "related" and by["Terraform"].evidence == data.experience[0].bullets[1]
    assert by["Terraform"].say.startswith("I haven't used Terraform")
    assert by["Kafka Streams"].verdict == "prepare" and not by["Kafka Streams"].evidence
    assert by["Spark"].verdict == "dont_claim" and by["Spark"].note == ip.DONT_CLAIM_NOTE
    assert by["Python"].verdict == "prepare" and by["Python"].prepare  # a fallback, not nothing
    assert not by["Payments domain knowledge"].keyword


def test_each_prep_action_spends_one_credit_and_a_failure_gives_it_back(client: TestClient, welcome: None,
                                                                        monkeypatch: pytest.MonkeyPatch) -> None:
    def left(h: dict[str, str]) -> int:
        return int(client.get("/v1/resumes/allowance", headers=h).json()["credits_left"])

    h = _signup(client, _new_ip())
    assert left(h) == 1
    assert _post(client, h, "skill-gap", resume()).status_code == 422 and left(h) == 1  # no job post: no AI
    assert _post(client, h, "questions", resume(), JOB).status_code == 200 and left(h) == 0
    r = _post(client, h, "skill-gap", resume(), JOB)
    assert r.status_code == 402 and r.json()["detail"]["code"] == "upgrade_required"

    class Down:
        name = "down"

        def supports_structured_output(self) -> bool:
            return True

        async def generate(self, req: Any) -> Any:
            raise LLMError("http_503", "down", retryable=True)

    other = _signup(client, _new_ip())
    _use(monkeypatch, Down())
    assert _post(client, other, "questions", resume(), JOB).status_code == 503 and left(other) == 1
    _use(monkeypatch, MockLLMProvider(script=["not json at all"]))
    assert _post(client, other, "questions", resume(), JOB).status_code == 502 and left(other) == 1
    _use(monkeypatch, MockLLMProvider(script=['{"gaps": "nope"']))
    assert _post(client, other, "skill-gap", resume(), JOB).status_code == 502 and left(other) == 1
    # The resume shows everything the post asks for: nothing to prepare, so the credit isn't spent either.
    _use(monkeypatch, MockLLMProvider(script=['{"gaps": []}']))
    r = _post(client, other, "skill-gap", resume(), "Senior engineer: Python, Kafka and Redis.")
    assert r.status_code == 200 and r.json()["gaps"] == [] and left(other) == 1


def test_a_year_before_a_comma_is_a_date_not_a_figure() -> None:
    assert not invented_figures("Left Infosys in Aug 2020, then joined Acme", "Infosys Jul 2018 Aug 2020")
    assert ip._grounded("Left Infosys in Aug 2020, joined QuickKart in Jan 2021", "Infosys QuickKart") == (
        "Left Infosys in Aug 2020, joined QuickKart in Jan 2021")


# ---- practising them in a mock interview ----------------------------------------------------------------------


async def test_the_mock_interviewer_asks_the_resume_questions_and_probes_what_to_defend() -> None:
    plan = [DrillItem(question="You cut reconciliation time by 60%. How did you measure it?", kind="prep",
                      follow_up=True, feedback="Have the baseline and the measurement window ready."),
            DrillItem(question="Why event sourcing for the ledger?", kind="prep")]
    eng, sink, now, llm = await _drill_engine(plan)
    await sink.wait_for("mock.question")
    first = sink.of("mock.question")[0]
    assert first["text"] == "Let's practise the questions from your prep. " + plan[0].question
    assert first["drill_kind"] == "prep" and first["total"] == 2 and not llm.prompts  # asked as written

    await _say(eng, now, "We compared the nightly reconciliation runs before and after the change")
    await sink.wait_for("mock.question", 2)
    follow = sink.of("mock.question")[1]
    assert follow["is_follow_up"] and follow["drill_kind"] == "follow_up"
    assert 'source="what_to_probe"' in llm.prompts[0] and "measurement window" in llm.prompts[0]
    assert "previous_feedback" not in llm.prompts[0]  # it's a resume claim to check, not a weak answer from before

    await _say(eng, now, "The nightly run went from five hours to two, measured over a month")
    await sink.wait_for("mock.question", 3)
    assert sink.of("mock.question")[2]["text"] == plan[1].question
    await eng.end()


def test_a_practice_session_keeps_the_questions_and_what_to_probe(client: TestClient) -> None:
    from orbit_api.db import sessionmaker
    from orbit_api.models import LiveSessionRow

    h = _register(client)
    qs = _post(client, h, "questions", resume(), JOB).json()["questions"][:8]
    r = client.post("/v1/sessions", headers=h, json={
        "title": "Resume practice", "type": "mock", "role": "Senior Backend Engineer",
        "mock": {"duration_minutes": 30, "drill": [
            {"question": q["question"], "kind": "prep", "follow_up": bool(q["defend"]), "feedback": q["defend"] or None}
            for q in qs]}})
    assert r.status_code == 201, r.text

    async def stored() -> dict[str, Any]:
        async with sessionmaker()() as db:
            row = await db.get(LiveSessionRow, r.json()["id"])
            assert row is not None and row.mock_config is not None
            return dict(row.mock_config)

    config = client.portal.call(stored)  # type: ignore[union-attr]
    assert [d["question"] for d in config["drill"]] == [q["question"] for q in qs]
    assert config["drill"][0]["feedback"] == qs[0]["defend"] and config["drill"][0]["kind"] == "prep"
