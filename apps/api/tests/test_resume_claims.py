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


SOURCE = """Jane Doe
Senior Backend Engineer
jane.doe@example.com | +44 7700 900123 | linkedin.com/in/janedoe
SKILLS
Python, Go, Kubernetes, PostgreSQL
EXPERIENCE
Acme Corp - Senior Engineer 2021-Present
- Built payment services handling 10k TPS and cut deploy time from 2 hours to 10 minutes
"""


def _imported() -> Any:
    from orbit_api.resumes.schema import Basics, Experience, Link, ResumeData, SkillGroup

    return ResumeData(
        basics=Basics(name="Jane Doe", email="jane.doe@example.com", phone="+44 7700 900123",
                      summary="Engineer who cut costs by 40% last year.",
                      links=[Link(label="LinkedIn", url="https://www.linkedin.com/in/janedoe"),
                             Link(label="GitHub", url="github.com/janedoe")]),
        experience=[Experience(title="Senior Engineer", company="Acme Corp", start="2021", current=True, bullets=[
            "Built payment services handling 10k TPS and cut deploy time from 2 hours to 10 minutes",
            "Reduced chargebacks by 30%"])],
        skills=[SkillGroup(name="Languages", items=["Python", "Go", "Rust"]),
                SkillGroup(name="Infra", items=["Kubernetes", "python", "PostgreSQL", "Terraform"]),
                SkillGroup(name="Invented", items=["Scrum"])])


def test_an_import_keeps_what_the_source_backs() -> None:
    from orbit_api.resumes.claims import ground_import

    out, notes = ground_import(_imported(), SOURCE)
    assert out.basics.email == "jane.doe@example.com" and out.basics.phone == "+44 7700 900123"
    assert [link.url for link in out.basics.links] == ["https://www.linkedin.com/in/janedoe"]  # scheme/www don't matter
    assert out.experience[0].bullets[0].endswith("2 hours to 10 minutes")
    assert notes  # the invented parts below are reported


def test_an_import_drops_skills_links_and_figures_the_source_never_had() -> None:
    from orbit_api.resumes.claims import ground_import

    out, notes = ground_import(_imported(), SOURCE)
    assert [g.items for g in out.skills] == [["Python", "Go"], ["Kubernetes", "PostgreSQL"]]  # no Rust/Terraform/Scrum,
    assert [g.name for g in out.skills] == ["Languages", "Infra"]  # no repeated "python", and the empty group is gone
    assert [link.label for link in out.basics.links] == ["LinkedIn"]  # the GitHub link wasn't in the source
    assert out.basics.summary == "Engineer who cut costs by [X%] last year."
    assert out.experience[0].bullets[1] == "Reduced chargebacks by [X%]"
    assert any("skill" in n for n in notes) and any("link" in n for n in notes) and any("figure" in n for n in notes)


def test_an_import_blanks_contact_details_the_source_never_had() -> None:
    from orbit_api.resumes.claims import ground_import

    data = _imported()
    data.basics.email, data.basics.phone = "jane@made-up.example", "+1 555 010 9999"
    out, notes = ground_import(data, SOURCE)
    assert out.basics.email == "" and out.basics.phone == ""
    assert any("email" in n for n in notes) and any("phone" in n for n in notes)
    # A phone number written differently in the source is still the same number.
    data.basics.phone = "07700 900123"
    assert ground_import(data, SOURCE)[0].basics.phone == "07700 900123"
