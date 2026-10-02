"""Line-by-line writing checks (lint.py), mechanical tech-name fixes, keyword synonyms, rewrite drafts, and the
"quantified" check counting how often as well as how much."""

import json

from orbit_api.providers.llm.base import LLMResponse, Usage
from orbit_api.resumes import ai, fixes
from orbit_api.resumes.ats import is_quantified, match_keywords, score_resume
from orbit_api.resumes.lint import fix_casing, line_issues
from orbit_api.resumes.schema import Basics, Experience, ResumeData
from tests.test_resumes import strong_resume


def _resume() -> ResumeData:
    return ResumeData(basics=Basics(name="Asha", summary="Backend dev using github and postgresql."), experience=[
        Experience(title="Engineer", company="Old Co", start="2019", end="2022", bullets=[
            "Responsible for handling customer tickets",
            "Manage the release process for 4 teams",
            "The API was implemented using fastapi",
            "Successfully migrated the billing service to kubernetes",
            "Built a GitHub Actions pipeline for every repo",
            "Built a GitHub Actions pipeline for every repo"]),
        Experience(title="Lead", company="New Co", start="2023", current=True, bullets=[
            "Lead a team of 5 engineers", "Owned the on-call rota"])])


def test_each_line_is_flagged_where_it_is() -> None:
    data = _resume()
    old, new = data.experience[0].id, data.experience[1].id
    by_line = {(i.path, i.kind) for i in line_issues(data)}
    assert (f"experience.{old}.bullets.0", "weak_opener") in by_line
    assert (f"experience.{old}.bullets.1", "tense") in by_line  # a role they've left, in the present
    assert (f"experience.{old}.bullets.2", "passive") in by_line
    assert (f"experience.{old}.bullets.3", "filler") in by_line
    assert (f"experience.{old}.bullets.5", "duplicate") in by_line
    assert {k for p, k in by_line if p == "basics.summary"} == {"casing"}
    # A current role may use the present tense; strong bullets get nothing.
    assert not {k for p, k in by_line if p.startswith(f"experience.{new}")}
    assert line_issues(strong_resume()) == []


def test_the_checks_feed_the_score_and_point_at_the_first_line() -> None:
    checks = {c.id: c for c in score_resume(_resume()).checks}
    assert not checks["clear_writing"].passed and checks["clear_writing"].ai_fixable
    assert "Responsible for" in (checks["clear_writing"].fix or "")
    assert not checks["tech_names"].passed and "FastAPI" in (checks["tech_names"].fix or "")
    report = score_resume(strong_resume())
    assert report.issues == [] and sum(c.max_points for c in score_resume(strong_resume(), job_text="x").checks) == 100


def test_tech_names_are_fixed_mechanically_and_safely() -> None:
    assert fix_casing("Shipped on kubernetes with github actions and node.js") == (
        "Shipped on Kubernetes with GitHub actions and Node.js")
    assert fix_casing("I react quickly and excel at go-live") == "I react quickly and excel at go-live"  # words too
    got = fixes.casing_suggestions(_resume())
    assert {s.after for s in got} >= {"Backend dev using GitHub and PostgreSQL.",
                                      "The API was implemented using FastAPI"}
    assert all(s.kind == "set" and s.confirm is None for s in got)  # applies in bulk with the other safe fixes


def test_synonyms_and_abbreviations_count_as_a_match() -> None:
    data = ResumeData(skills=[], experience=[Experience(title="Engineer", company="X", start="2020", bullets=[
        "Ran k8s clusters and wrote JS and Postgres code"])])
    got = match_keywords(["Kubernetes", "JavaScript", "PostgreSQL", "Rust"], data)
    assert got.matched == ["Kubernetes", "JavaScript", "PostgreSQL"] and got.missing == ["Rust"]


def test_how_often_counts_as_sizing_a_result() -> None:
    assert is_quantified("Ran a weekly security review for the platform team")
    assert is_quantified("Shipped a release every sprint")
    assert not is_quantified("Ran security reviews for the platform team")


def _resp(items: list[dict[str, str]]) -> LLMResponse:
    return LLMResponse(text=json.dumps({"suggestions": items}), model="m", usage=Usage())


def test_a_one_line_rewrite_offers_up_to_three_drafts_of_that_line() -> None:
    data = strong_resume()
    first = f"experience.{data.experience[0].id}.bullets.0"  # "...cutting reconciliation time by 60%"
    got = ai.parse_suggestions(_resp([
        {"path": first, "after": "Cut reconciliation time by 60% by moving the ledger to event sourcing on Kafka",
         "reason": "Impact first: the result leads."},
        {"path": first, "after": "Moved the ledger to Kafka event sourcing, cutting reconciliation time by 60%",
         "reason": "Shorter: plainer."},
        {"path": first, "after": "Led the ledger's move to event sourcing on Kafka, cutting reconciliation by 60%",
         "reason": "More specific: names the move."},
        {"path": first, "after": "A fourth draft cutting reconciliation by 60%"},
        {"path": f"experience.{data.experience[0].id}.bullets.1", "after": "Another field entirely"},
    ]), data, focus=first)
    assert [s.path for s in got] == [first] * 3
    assert [s.label.rsplit(" · ", 1)[-1] for s in got] == ["draft 1 of 3", "draft 2 of 3", "draft 3 of 3"]


def test_the_rewrite_prompt_asks_for_drafts_and_names_the_lines_problem() -> None:
    data = _resume()
    path = f"experience.{data.experience[0].id}.bullets.0"
    req = ai.suggest_request(data, score_resume(data), _NoLLM(), mode="improve", job_text="", focus=path)
    user = req.messages[-1].content
    assert "3 different drafts" in user and "Responsible for" in user


class _NoLLM:
    name = "none"

    def supports_structured_output(self) -> bool:
        return True
