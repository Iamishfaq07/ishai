"""Fixes for every resume problem: add skills, add bullets, add numbers, write dates one way, all honest."""

import json
from typing import Any

from fastapi.testclient import TestClient

from orbit_api.providers.llm.base import LLMResponse, Usage
from orbit_api.resumes import ai, fixes
from orbit_api.resumes.ats import score_resume
from orbit_api.resumes.schema import Basics, Experience, ResumeData, SkillGroup
from tests.test_api import _register
from tests.test_resumes import JOB, strong_resume


def _resume(**kw: Any) -> ResumeData:
    return ResumeData(basics=Basics(name="Sam Lee"), **kw)


def _resp(payload: dict[str, Any]) -> LLMResponse:
    return LLMResponse(text=json.dumps(payload), model="m", usage=Usage())


def test_skills_the_bullets_prove_are_suggested_without_a_warning() -> None:
    data = _resume(
        experience=[Experience(title="Engineer", company="Acme", start="Jan 2020", current=True, bullets=[
            "Built ingestion on Kafka and Docker, cutting load time by 40%",
            "Led a PostgreSQL migration for the billing team"])],
        skills=[SkillGroup(name="Languages", items=["Python"])])
    got = fixes.skill_suggestions(data, score_resume(data))
    assert len(got) == 1 and got[0].kind == "add_skill" and got[0].confirm is None
    added = [s.strip() for s in got[0].after.split(",")]
    assert {"Kafka", "Docker", "PostgreSQL"} <= set(added)
    assert "Python" not in added and "Built" not in added and "Led" not in added


def test_skills_from_the_job_post_must_be_confirmed() -> None:
    data = _resume(experience=[Experience(title="Engineer", company="Acme", bullets=["Built internal tools"])],
                   skills=[SkillGroup(name="Languages", items=["Python"])])
    got = fixes.skill_suggestions(data, score_resume(data, job_text=JOB), JOB)
    job = [s for s in got if s.confirm]
    assert job and job[0].confirm == fixes.JOB_CONFIRM
    assert "Kubernetes" in job[0].after and "GraphQL" in job[0].after
    have = fixes.current_skills(data)
    assert not any(fixes.has_skill(have, x.strip()) for x in job[0].after.split(","))


def test_dates_are_normalised_without_inventing_a_month() -> None:
    mixed = _resume(experience=[
        Experience(title="A", company="X", start="01/2021", end="03/2023"),
        Experience(title="B", company="Y", start="Jun 2018", end="Dec 2020")])
    got = fixes.date_suggestions(mixed)
    assert {(s.before, s.after) for s in got} == {("01/2021", "Jan 2021"), ("03/2023", "Mar 2023")}
    assert all(s.kind == "set" and s.confirm is None for s in got)

    with_year = _resume(experience=[
        Experience(title="A", company="X", start="2021", end="2023"),
        Experience(title="B", company="Y", start="Jun 2018", end="Dec 2020")])
    assert {(s.before, s.after) for s in fixes.date_suggestions(with_year)} == {("Jun 2018", "2018"),
                                                                              ("Dec 2020", "2020")}
    assert fixes.date_suggestions(strong_resume()) == []


def test_new_bullets_are_drafted_for_thin_roles_with_placeholders_and_a_warning() -> None:
    data = _resume(experience=[Experience(title="Support Engineer", company="Acme", start="Jan 2020", bullets=[])])
    path = f"experience.{data.experience[0].id}.bullets.+"
    assert list(ai.addable_roles(data)) == [path]
    got = ai.parse_suggestions(_resp({"suggestions": [
        {"path": path, "after": "Resolved 300 tickets a month with a 98% satisfaction score", "reason": "r"},
        {"path": path, "after": "Resolved 300 tickets a month with a 98% satisfaction score"},  # duplicate
        {"path": path, "after": "Automated triage with Zendesk and Terraform"},  # tools it never said
        {"path": path, "after": "Wrote runbooks the whole team used"},
        {"path": path, "after": "Trained new hires on the escalation process"},
        {"path": path, "after": "A fourth bullet over the cap"},
    ]}), data)
    assert [s.kind for s in got] == ["add_bullet"] * 3
    assert got[0].after == "Resolved [N] tickets a month with a [X%] satisfaction score"
    assert all(s.confirm == ai.NEW_BULLET_CONFIRM and s.before == "" for s in got)


def test_roles_with_enough_bullets_get_no_new_bullets() -> None:
    assert ai.addable_roles(strong_resume()) == {}
    got = ai.parse_suggestions(_resp({"suggestions": [
        {"path": f"experience.{strong_resume().experience[0].id}.bullets.+", "after": "x"}]}), strong_resume())
    assert got == []


def test_headline_and_summary_can_be_written_when_empty() -> None:
    data = _resume(experience=[Experience(title="Engineer", company="Acme", bullets=["Built the billing API"])])
    got = ai.parse_suggestions(_resp({"suggestions": [
        {"path": "basics.headline", "after": "Backend Engineer"},
        {"path": "basics.summary", "after": "Engineer who builds billing APIs."}]}), data)
    assert [(s.path, s.before, s.kind) for s in got] == [("basics.headline", "", "rewrite"),
                                                         ("basics.summary", "", "rewrite")]


def test_every_fixable_problem_is_marked_ai_fixable() -> None:
    weak = _resume(experience=[Experience(title="Engineer", company="Acme", start="01/2021", end="2022",
                                          bullets=["Built the API"])])
    fixable = {c.id for c in score_resume(weak).checks if c.ai_fixable}
    assert {"has_skills", "skills_count", "bullets_per_role", "dates", "quantified", "summary"} <= fixable
    bare = _resume(experience=[Experience(title="Engineer", company="Acme")])
    assert {"action_verbs", "quantified"} <= {c.id for c in score_resume(bare).checks if c.ai_fixable}


# ---- the route -------------------------------------------------------------------------------------------------


def _suggest(client: TestClient, h: dict[str, str], data: ResumeData, **extra: Any) -> Any:
    return client.post("/v1/resumes/suggest", headers=h, json={"data": data.model_dump(mode="json"), **extra})


def test_skills_check_adds_what_the_resume_proves_then_what_the_role_usually_needs(client: TestClient) -> None:
    h = _register(client)
    data = _resume(
        experience=[Experience(title="Engineer", company="Acme", start="Jan 2020", current=True,
                               bullets=["Built services on Kafka", "Cut cloud costs by 20% on AWS"])],
        skills=[SkillGroup(name="Languages", items=["Python"])])
    r = _suggest(client, h, data, check="skills_count")
    assert r.status_code == 200, r.text
    got = r.json()["suggestions"]
    assert [s["kind"] for s in got] == ["add_skill", "add_skill"]
    assert got[0]["confirm"] is None and "Kafka" in got[0]["after"] and "AWS" in got[0]["after"]
    assert got[1]["confirm"] and "Git" in got[1]["after"]
    assert "Python" not in got[1]["after"]


def test_dates_check_is_instant_and_needs_no_ai(client: TestClient) -> None:
    h = _register(client)
    data = _resume(experience=[Experience(title="A", company="X", start="01/2021", end="Present"),
                               Experience(title="B", company="Y", start="Jun 2018", end="Dec 2020")])
    r = _suggest(client, h, data, check="dates")
    assert r.status_code == 200 and [s["after"] for s in r.json()["suggestions"]] == ["Jan 2021"]
    assert _suggest(client, h, strong_resume(), check="dates").status_code == 422  # nothing to fix


def test_improve_drafts_bullets_for_a_role_that_has_none(client: TestClient) -> None:
    h = _register(client)
    data = _resume(experience=[Experience(title="Support Engineer", company="Acme", start="Jan 2020", end="2022")])
    r = _suggest(client, h, data, check="bullets_per_role")
    assert r.status_code == 200, r.text
    kinds = {s["kind"] for s in r.json()["suggestions"]}
    assert "add_bullet" in kinds
    assert all(s["confirm"] for s in r.json()["suggestions"] if s["kind"] == "add_bullet")


def test_unknown_check_is_rejected(client: TestClient) -> None:
    h = _register(client)
    assert _suggest(client, h, strong_resume(), check="nope").status_code == 422
