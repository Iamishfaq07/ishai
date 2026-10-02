"""The ATS score shouldn't punish correct resumes: everyday words and job-post boilerplate aren't keywords, present
tense on a current role is fine, "S3" isn't a number and "I/O" isn't "I"."""

import pytest

from orbit_api.resumes import ats
from orbit_api.resumes.ats import extract_keywords, is_action_verb, is_quantified

POST = """Brightline is hiring a Senior Backend Engineer reporting to our VP of Engineering and CTO.
You will excel in a lean team and own the rest of our go-to-market tooling. Start date: Spring 2025.
You'll build services in Go, React and REST APIs on AWS with PostgreSQL and Kubernetes.
Brightline offers remote work (PST or EST hours). Brightline is an EEO employer. Brightline values ownership.
"""


def test_job_keywords_skip_everyday_words_boilerplate_and_the_company() -> None:
    kws = extract_keywords(POST)
    lowered = {k.lower() for k in kws}
    for junk in ("excel", "lean", "spring", "vp", "cto", "eeo", "pst", "est", "brightline"):
        assert junk not in lowered, (junk, kws)
    # The real skills, written the way the post writes them (so the chip adds "PostgreSQL", not "postgresql").
    for skill in ("Go", "React", "REST", "AWS", "PostgreSQL", "Kubernetes"):
        assert skill in kws, (skill, kws)


def test_an_ambiguous_skill_counts_when_the_post_means_the_product() -> None:
    assert "Excel" in extract_keywords("Strong Excel and Tableau skills. You report in Excel weekly.")
    assert all(k.lower() != "go" for k in extract_keywords("Go above and beyond. Ready to go live fast."))


@pytest.mark.parametrize("word", ["Led", "Lead", "Leads", "Manage", "Manages", "Build", "Builds", "Built", "Owned",
                                  "Co-founded", "Hired", "Exceeded", "Sold", "Onboarded", "Ship", "Plan", "Tests",
                                  "Steered", "Shaped", "Trimmed"])
def test_action_verbs_in_past_and_present(word: str) -> None:
    assert is_action_verb(word)


@pytest.mark.parametrize("word", ["Responsible", "Worked", "Helped", "Was", "The", "Duties", ""])
def test_weak_openers_are_not_action_verbs(word: str) -> None:
    assert not is_action_verb(word)


def test_every_suggested_alternative_verb_passes_the_check() -> None:
    for alternatives in ats.VERB_ALTERNATIVES.values():
        for verb in alternatives.split(", "):
            assert is_action_verb(verb.split()[0]), verb


@pytest.mark.parametrize(("text", "expected"), [
    ("Cut page load time by 35% across the storefront", True),
    ("Grew revenue to $2M in a year", True),
    ("Doubled weekly sign-ups after the redesign", True),
    ("Saved hundreds of hours of manual review", True),
    ("Raised ₹5 lakh in pre-orders", True),
    ("Moved file storage to AWS EC2 and S3", False),
    ("Owned the Q3 roadmap for payments", False),
    ("Ran 24/7 support rotations", False),
    ("Joined in 2021 to lead onboarding", False),
])
def test_quantified_means_a_real_figure(text: str, expected: bool) -> None:
    assert is_quantified(text) is expected


def test_io_is_not_first_person() -> None:
    assert not ats._PRONOUN.search("Cut disk I/O latency on the CI/CD runners")
    assert ats._PRONOUN.search("I led the migration")
    assert ats._PRONOUN.search("Led my team through the migration")


def test_word_files_name_the_candidate_not_the_library() -> None:
    import io

    from docx import Document

    from orbit_api.resumes.docx_export import letter_docx, resume_docx
    from orbit_api.resumes.schema import ResumeDesign
    from tests.test_resumes import strong_resume

    data = strong_resume()
    name = data.basics.name
    for kind, raw in (("Resume", resume_docx(data, ResumeDesign())),
                      ("Cover letter", letter_docx("Dear team,\n\nHello.", data, ResumeDesign()))):
        props = Document(io.BytesIO(raw)).core_properties
        assert props.title == f"{name} - {kind}" and props.author == name
        assert "python-docx" not in f"{props.comments} {props.author} {props.last_modified_by}"
