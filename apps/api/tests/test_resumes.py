"""Resume maker: the ATS score, CRUD and ownership, AI import and one-change-at-a-time suggestions."""

import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from orbit_api.providers.llm.base import LLMResponse, Usage
from orbit_api.resumes import ai
from orbit_api.resumes.ats import date_style, extract_keywords, match_keywords, score_resume
from orbit_api.resumes.schema import (
    Basics,
    Education,
    Experience,
    Link,
    ResumeData,
    ResumeDesign,
    SkillGroup,
)
from tests.test_api import _register

JOB = """Senior Backend Engineer. We're looking for an engineer with strong Python and PostgreSQL experience to build
scalable microservices on AWS. You will design REST and GraphQL APIs, run services on Kubernetes and Docker, and own
CI/CD with GitHub Actions. Experience with Kafka, Redis and observability (Datadog) is a plus."""


def strong_resume() -> ResumeData:
    return ResumeData(
        basics=Basics(name="Sam Lee", email="sam@example.com", phone="+1 555 123 4567", location="Austin, TX",
                      links=[Link(label="LinkedIn", url="linkedin.com/in/samlee")],
                      summary="Backend engineer with 7 years building payment systems in Python and PostgreSQL on "
                              "AWS. Designs scalable microservices and REST APIs and leads teams through large "
                              "migrations. Looking for a senior backend role on a platform team."),
        experience=[
            Experience(title="Senior Engineer", company="PayCo", start="Jan 2020", end="", current=True, bullets=[
                "Led the migration of the ledger to event sourcing on Kafka, cutting reconciliation time by 60%",
                "Built 12 Python microservices on Kubernetes and Docker serving 3M transactions a day",
                "Designed GraphQL and REST APIs used by 40 internal teams with 99.99% uptime",
                "Reduced p95 latency from 800 ms to 120 ms with Redis caching and PostgreSQL query tuning"]),
            Experience(title="Engineer", company="Shop Inc", start="Jun 2016", end="Dec 2019", bullets=[
                "Shipped CI/CD with GitHub Actions, cutting release time from 2 days to 30 minutes",
                "Mentored 4 junior engineers and ran the team's system design reviews every quarter"]),
        ],
        education=[Education(school="UT Austin", degree="BSc", field="Computer Science", start="2012", end="2016")],
        skills=[SkillGroup(name="Languages", items=["Python", "SQL", "Go"]),
                SkillGroup(name="Infrastructure", items=["AWS", "Kubernetes", "Docker", "Terraform", "Kafka",
                                                         "Redis", "PostgreSQL", "Datadog"])],
    )


# ---- ATS score ---------------------------------------------------------------------------------------------


def test_weak_resume_scores_low_with_a_fix_for_every_missed_point() -> None:
    weak = ResumeData(basics=Basics(name="Sam"),
                      experience=[Experience(title="Engineer", company="Acme", bullets=["I worked on the backend"])])
    report = score_resume(weak, job_text=JOB)
    assert report.score < 30 and report.verdict == "Weak" and report.has_job
    missed = [c for c in report.checks if not c.passed]
    assert missed and all(c.fix for c in missed if c.id != "keywords" or report.keywords)
    by_id = {c.id: c for c in report.checks}
    assert by_id["email"].target == "basics.email"
    assert by_id["action_verbs"].target == f"experience.{weak.experience[0].id}.bullets.0"
    assert by_id["no_pronouns"].ai_fixable and not by_id["no_pronouns"].passed
    assert sum(c.max_points for c in report.checks) == 100


def test_strong_resume_scores_high_and_matches_the_job() -> None:
    report = score_resume(strong_resume(), job_text=JOB)
    assert report.score >= 85 and report.verdict == "Strong"
    assert report.keywords is not None and "Datadog" in report.keywords.matched
    assert not report.keywords.missing or report.keywords.missing == ["observability"]


def test_without_a_job_post_keywords_are_left_out_and_the_rest_scaled_to_100() -> None:
    report = score_resume(strong_resume())
    assert not report.has_job and report.keywords is None
    assert "keywords" not in {c.category for c in report.checks}
    assert sum(c.max_points for c in report.checks) == 75 and report.score >= 85


def test_layout_photo_and_two_columns_cost_points() -> None:
    plain = score_resume(strong_resume()).score
    styled = score_resume(strong_resume(), ResumeDesign(template="sidebar", show_photo=True,
                                                        photo="data:image/png;base64,iVBORw0KGgo="))
    assert styled.score < plain
    assert {c.id for c in styled.checks if not c.passed} >= {"single_column", "no_photo"}


def test_dates_and_keywords_helpers() -> None:
    assert [date_style(d) for d in ("Jan 2021", "01/2021", "2021", "Present", "", "spring")] == [
        "month_year", "numeric", "year", None, None, "other"]
    mixed = strong_resume()
    mixed.experience[1].start = "06/2016"
    assert not {c.id: c for c in score_resume(mixed).checks}["dates"].passed
    kws = extract_keywords(JOB)
    assert {"python", "kubernetes", "ci/cd", "Datadog"} <= set(kws)
    assert not {"CI", "GitHub", "Backend", "APIs"} & set(kws)  # parts of longer terms, titles, generic words
    got = match_keywords(["node.js", "a/b testing", "c++", "microservice"], ResumeData(
        basics=Basics(summary="Nodejs services, A/B testing, C++ and microservices")))
    assert got.missing == [] and len(got.matched) == 4


def test_design_is_validated() -> None:
    with pytest.raises(ValueError):
        ResumeDesign(accent="red")
    with pytest.raises(ValueError):
        ResumeDesign(photo="javascript:alert(1)")
    assert ResumeDesign(accent="#ABCDEF").accent == "#abcdef"
    assert ResumeData(section_order=["skills"]).section_order[0] == "skills"  # the rest keep their places


# ---- CRUD & ownership --------------------------------------------------------------------------------------


def test_crud_is_scoped_to_the_owner(client: TestClient) -> None:
    h = _register(client)
    other = _register(client)
    body = {"title": "Backend", "data": strong_resume().model_dump(mode="json"), "job_text": JOB,
            "design": {"template": "modern", "accent": "#0f766e", "font": "georgia"}}
    created = client.post("/v1/resumes", headers=h, json=body)
    assert created.status_code == 201, created.text
    rid = created.json()["id"]
    assert created.json()["design"]["template"] == "modern"

    listed = client.get("/v1/resumes", headers=h).json()
    assert listed[0]["id"] == rid and listed[0]["score"] >= 85 and listed[0]["has_job"]
    assert listed[0]["name"] == "Sam Lee"

    for method in ("GET", "PUT", "DELETE"):
        r = client.request(method, f"/v1/resumes/{rid}", headers=other, json=body if method == "PUT" else None)
        assert r.status_code == 404, method
    assert client.get("/v1/resumes", headers=other).json() == []

    body["title"] = "Backend v2"
    assert client.put(f"/v1/resumes/{rid}", headers=h, json=body).json()["title"] == "Backend v2"
    assert client.post("/v1/resumes", headers=h, json={**body, "design": {"accent": "blue"}}).status_code == 422
    assert client.delete(f"/v1/resumes/{rid}", headers=h).status_code == 204
    assert client.get(f"/v1/resumes/{rid}", headers=h).status_code == 404


def test_score_endpoint_scores_a_draft(client: TestClient) -> None:
    h = _register(client)
    r = client.post("/v1/resumes/score", headers=h, json={"data": strong_resume().model_dump(mode="json"),
                                                          "job_text": JOB})
    assert r.status_code == 200 and r.json()["score"] >= 85 and r.json()["keywords"]["matched"]
    assert client.post("/v1/resumes/score", json={"data": {}}).status_code == 401


def test_export_includes_resumes(client: TestClient) -> None:
    h = _register(client)
    client.post("/v1/resumes", headers=h, json={"title": "Mine"})
    assert [r["title"] for r in client.get("/v1/auth/me/export", headers=h).json()["resumes"]] == ["Mine"]


# ---- Word export -------------------------------------------------------------------------------------------


def test_word_export_reads_back_in_order(client: TestClient) -> None:
    import docx

    from orbit_api.documents.parsing import extract_text

    h = _register(client)
    data = strong_resume()
    data.section_order = ["experience", "skills", "education", "summary", "projects", "certifications"]
    r = client.post("/v1/resumes/docx", headers=h, json={
        "data": data.model_dump(mode="json"), "design": {"font": "georgia", "accent": "#0f766e", "page": "letter"}})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.wordprocessingml")
    text = extract_text(r.content, "docx")
    lines = text.split("\n")
    assert lines[0] == "Sam Lee" and "sam@example.com" in lines[1]
    # The chosen section order, empty sections left out, the job line with its dates after a tab.
    heads = [line for line in lines if line in ("EXPERIENCE", "SKILLS", "EDUCATION", "SUMMARY", "PROJECTS")]
    assert heads == ["EXPERIENCE", "SKILLS", "EDUCATION", "SUMMARY"]
    assert "Senior Engineer, PayCo\tJan 2020 – Present" in lines
    assert "Infrastructure: AWS, Kubernetes, Docker, Terraform, Kafka, Redis, PostgreSQL, Datadog" in lines
    d = docx.Document(__import__("io").BytesIO(r.content))
    assert d.styles["Normal"].font.name == "Georgia"
    assert round(d.sections[0].page_width.mm) == 216
    assert sum(p.style.name == "List Bullet" for p in d.paragraphs) == 6
    assert sum(p.style.name == "Heading 1" for p in d.paragraphs) == 4
    assert client.post("/v1/resumes/docx", json={"data": {}}).status_code == 401


# ---- AI import ---------------------------------------------------------------------------------------------

PASTED = """Priya Raman
priya@example.com | +44 20 7946 0958
- Led a team of 5 building the checkout redesign
- Cut page load time by 35% across the storefront
- Ran weekly experiments with the growth team"""


def test_import_from_pasted_text_file_and_document(client: TestClient) -> None:
    h = _register(client)
    r = client.post("/v1/resumes/import", headers=h, json={"source": "text", "text": PASTED})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["basics"]["name"] == "Priya Raman" and data["basics"]["email"] == "priya@example.com"
    assert r.json()["title"] == "Priya Raman's resume"
    assert data["experience"][0]["bullets"][0].startswith("Led a team")

    too_short = client.post("/v1/resumes/import", headers=h, json={"source": "linkedin", "text": "hi"})
    assert too_short.status_code == 422

    f = client.post("/v1/resumes/import-file", headers=h, files={"file": ("cv.txt", PASTED.encode(), "text/plain")})
    assert f.status_code == 200 and f.json()["data"]["basics"]["name"] == "Priya Raman"
    bad = client.post("/v1/resumes/import-file", headers=h, files={"file": ("cv.exe", b"MZ\x90\x00", "x/y")})
    assert bad.status_code == 422

    doc = client.post("/v1/documents/text", headers=h, json={"kind": "resume", "title": "CV", "text": PASTED}).json()
    from_doc = client.post("/v1/resumes/import", headers=h, json={"source": "document", "document_id": doc["id"]})
    assert from_doc.status_code == 200
    other = _register(client)
    assert client.post("/v1/resumes/import", headers=other,
                       json={"source": "document", "document_id": doc["id"]}).status_code == 404


def test_parse_structured_clips_and_drops_malformed_items() -> None:
    raw = {"basics": {"name": "A" * 500, "email": "a@b.co", "links": [{"url": "x.com"}, "junk", {"url": ""}]},
           "experience": [{"title": "Dev", "company": "Co", "bullets": ["one", "", 3, "x" * 900]}, "junk", {}],
           "skills": [{"name": "Tools", "items": ["Git"] * 60}, {"name": "Empty", "items": []}],
           "education": "nope"}
    data = ai.parse_structured("Here you go: " + json.dumps(raw))
    assert len(data.basics.name) == 120 and [link.url for link in data.basics.links] == ["x.com"]
    assert len(data.experience) == 1 and data.experience[0].bullets[:3] == ["one", "3", "x" * 400]
    assert len(data.skills) == 1 and len(data.skills[0].items) == 40 and data.education == []
    with pytest.raises(ValueError):
        ai.parse_structured(json.dumps({"basics": {}}))


# ---- AI suggestions ----------------------------------------------------------------------------------------


def test_suggestions_name_the_exact_text_they_replace(client: TestClient) -> None:
    h = _register(client)
    data = strong_resume().model_dump(mode="json")
    r = client.post("/v1/resumes/suggest", headers=h, json={"data": data, "mode": "improve"})
    assert r.status_code == 200, r.text
    fields = ai.editable_fields(strong_resume().model_validate(data))
    for s in r.json()["suggestions"]:
        assert s["path"] in fields and s["before"] == fields[s["path"]][1] and s["after"] != s["before"]

    first_bullet = f"experience.{data['experience'][0]['id']}.bullets.0"
    focused = client.post("/v1/resumes/suggest", headers=h, json={"data": data, "focus": first_bullet}).json()
    assert [s["path"] for s in focused["suggestions"]] == [first_bullet]

    assert client.post("/v1/resumes/suggest", headers=h, json={"data": data, "mode": "tailor"}).status_code == 422
    assert client.post("/v1/resumes/suggest", headers=h,
                       json={"data": data, "focus": "basics.email"}).status_code == 422
    assert client.post("/v1/resumes/suggest", headers=h, json={"data": {}}).status_code == 422  # nothing to rewrite


def test_parse_suggestions_rejects_unknown_paths_no_ops_and_duplicates() -> None:
    data = strong_resume()
    path = f"experience.{data.experience[0].id}.bullets.0"
    same = data.experience[0].bullets[0]

    def resp(items: list[dict[str, Any]]) -> LLMResponse:
        return LLMResponse(text=json.dumps({"suggestions": items}), model="m", usage=Usage())

    got = ai.parse_suggestions(resp([
        {"path": "experience.nope.bullets.0", "after": "x"},
        {"path": path, "after": same},  # no change
        {"path": path, "after": "• Led the ledger migration to event sourcing, cutting reconciliation by [X%]",
         "reason": "Leads with the result."},
        {"path": path, "after": "duplicate"},
        {"path": "basics.summary", "after": "S" * 3000},
    ]), data)
    assert [s.path for s in got] == [path, "basics.summary"]
    assert got[0].after.startswith("Led ") and got[0].before == same  # bullet character stripped
    assert len(got[1].after) == 1_500
