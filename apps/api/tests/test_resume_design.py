"""Resume design and editing options: the new templates, fonts, line spacing and skill tags are accepted; hidden
sections leave the score and the Word file; custom headings print."""

import io

import pytest
from docx import Document
from fastapi.testclient import TestClient
from pydantic import ValidationError

from orbit_api.resumes.ats import score_resume
from orbit_api.resumes.docx_export import WORD_FONT, resume_docx
from orbit_api.resumes.schema import ResumeData, ResumeDesign
from tests.test_api import _register
from tests.test_resumes import strong_resume


@pytest.mark.parametrize("template", ["elegant", "minimal", "bold", "executive"])
def test_new_templates_are_single_column_and_cost_nothing(template: str) -> None:
    design = ResumeDesign(template=template)  # type: ignore[arg-type]
    checks = {c.id: c for c in score_resume(strong_resume(), design).checks}
    assert checks["single_column"].passed


def test_every_font_has_a_word_font_and_bad_values_are_refused() -> None:
    for font in ("calibri", "cambria", "helvetica", "times", "trebuchet"):
        assert WORD_FONT[font]
        ResumeDesign(font=font, line_height="airy", skills_style="tags")  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        ResumeDesign(line_height="huge")  # type: ignore[arg-type]
    with pytest.raises(ValidationError):
        ResumeDesign(template="comic")  # type: ignore[arg-type]


def test_hidden_sections_and_headings_are_cleaned_up() -> None:
    data = ResumeData(hidden=["education", "education", "nope", "extra:missing"],
                      titles={"experience": "  Work   experience ", "nope": "x", "skills": "  ", "summary": "S" * 80})
    assert data.hidden == ["education"]
    assert data.titles == {"experience": "Work experience", "summary": "S" * 40}


def test_a_hidden_section_is_off_the_score_and_the_word_file() -> None:
    data = strong_resume()
    shown = {c.id: c for c in score_resume(data).checks}
    assert shown["has_education"].passed
    hidden = data.model_copy(update={"hidden": ["education"], "titles": {"experience": "Work experience"}})
    hidden = ResumeData.model_validate(hidden.model_dump())
    assert not {c.id: c for c in score_resume(hidden).checks}["has_education"].passed
    text = "\n".join(p.text for p in Document(io.BytesIO(resume_docx(hidden, ResumeDesign()))).paragraphs).lower()
    assert "work experience" in text and "education" not in text
    assert data.education[0].school.lower() not in text
    assert hidden.education  # still there to edit


def test_the_api_keeps_the_new_options(client: TestClient) -> None:
    h = _register(client)
    data = strong_resume().model_dump(mode="json") | {"hidden": ["projects"], "titles": {"skills": "Toolkit"}}
    design = ResumeDesign(template="bold", font="cambria", line_height="tight", skills_style="tags")
    body = {"title": "R", "data": data, "design": design.model_dump(mode="json")}
    r = client.post("/v1/resumes", headers=h, json=body)
    assert r.status_code == 201, r.text
    got = client.get(f"/v1/resumes/{r.json()['id']}", headers=h).json()
    assert got["data"]["hidden"] == ["projects"] and got["data"]["titles"] == {"skills": "Toolkit"}
    assert got["design"]["template"] == "bold" and got["design"]["skills_style"] == "tags"
