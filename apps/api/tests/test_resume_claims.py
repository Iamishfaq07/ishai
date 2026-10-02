"""AI rewrites may reword the candidate's text but never add facts: invented figures become placeholders, invented
tools drop the suggestion."""

import json
from typing import Any

from orbit_api.providers.llm.base import LLMResponse, Usage
from orbit_api.resumes import ai
from orbit_api.resumes.claims import fill_invented_figures, invented_terms
from tests.test_resumes import strong_resume

CORPUS = json.dumps({"summary": "Backend engineer, 7 years, Python, Go, Kubernetes",
                     "bullets": ["Built payment services handling 10k TPS on Kubernetes with Kafka",
                                 "Cut deploy time from 2 hours to 10 minutes", "Reduced chargebacks by 30%"]})


def test_figures_the_resume_never_stated_become_placeholders() -> None:
    text, n = fill_invented_figures("Cut deploy time by 40% across 12 teams, saving $2M and 3.5x latency", CORPUS)
    assert text == "Cut deploy time by [X%] across [N] teams, saving [$X] and [N]x latency" and n == 4


def test_figures_the_resume_does_state_are_kept_in_any_spelling() -> None:
    for same in ("Reduced chargebacks by 30% for a 10K TPS platform", "Cut deploys from 2 hours to 10 minutes"):
        assert fill_invented_figures(same, CORPUS) == (same, 0)


def test_years_and_digits_inside_names_are_not_figures() -> None:
    same = "Ran 24/7 on-call for the S3 and EC2 estate in 2023 on Python3"
    assert fill_invented_figures(same, CORPUS) == (same, 0)


def test_tools_the_resume_never_mentions_are_caught_and_ones_it_does_are_not() -> None:
    assert invented_terms("Led the move to GraphQL and Rust, still on Kubernetes and Kafka", CORPUS) == [
        "GraphQL", "Rust"]
    assert invented_terms("Improved KPIs and ROI across the Python and Go stack", CORPUS) == []


def _resp(items: list[dict[str, Any]]) -> LLMResponse:
    return LLMResponse(text=json.dumps({"suggestions": items}), model="m", usage=Usage())


def test_suggestions_with_invented_facts_are_fixed_or_dropped() -> None:
    data = strong_resume()
    first, second = (f"experience.{data.experience[0].id}.bullets.0", f"experience.{data.experience[0].id}.bullets.1")
    corpus_has = json.dumps(data.model_dump(mode="json"))
    assert "35%" not in corpus_has and "Pulumi" not in corpus_has  # the fixture says neither
    got = ai.parse_suggestions(_resp([
        {"path": first, "after": "Led the ledger migration, cutting reconciliation time by 35%", "reason": "Result."},
        {"path": second, "after": "Automated releases with Pulumi for every team", "reason": "Tooling."},
    ]), data)
    assert [s.path for s in got] == [first]  # the invented tool dropped its suggestion
    assert got[0].after == "Led the ledger migration, cutting reconciliation time by [X%]"
    assert got[0].reason == "Result. Replace the bracketed figure with your real number."


def test_a_cover_letter_figure_from_neither_the_resume_nor_the_job_post_becomes_a_placeholder() -> None:
    data = strong_resume()
    paragraph = ("I led the ledger migration to event sourcing on Kafka, cutting reconciliation time by 60%, and I "
                 "cut cloud spend by 45% while serving 3M transactions a day. Your post mentions scaling to 500 "
                 "services, which is the kind of problem I enjoy. ")
    body = "Dear Hiring Manager,\n\n" + paragraph * 2 + "\n\nSincerely,\nSam Lee"
    letter = ai.parse_cover_letter(body, data, "We are scaling to 500 services and need a senior backend engineer.")
    assert "by 60%" in letter and "3M transactions" in letter and "500 services" in letter  # all stated somewhere
    assert "by [X%] while" in letter and "45%" not in letter  # the one invented figure
