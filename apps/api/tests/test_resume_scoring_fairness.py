"""The ATS score shouldn't punish correct resumes: everyday words and job-post boilerplate aren't keywords, present
tense on a current role is fine, "S3" isn't a number and "I/O" isn't "I", and a student with projects and no job yet
isn't scored as if the resume were empty."""

import pytest

from orbit_api.resumes import ats
from orbit_api.resumes.ats import extract_keywords, is_action_verb, is_quantified
from orbit_api.resumes.schema import (
    Basics,
    Education,
    Experience,
    ExtraSection,
    Link,
    Project,
    ResumeData,
    SkillGroup,
)

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


# ---- students and freshers: no job yet isn't an empty resume -------------------------------------------------


def _fresher(*, internship: bool = True, projects: int = 2) -> ResumeData:
    """A B.Tech fresher: CGPA, Class 12 and 10, two projects, an internship, a position of responsibility and an
    achievement."""
    work = [
        Project(name="CampusCart: student marketplace", link="github.com/aarav/campuscart", bullets=[
            "Built a buy-and-sell web app for 1,200 students with React, Node.js and MongoDB",
            "Cut search time from 3 seconds to 400 ms with MongoDB text indexes and Redis caching",
            "Deployed on AWS EC2 with GitHub Actions, shipping 40 releases over two semesters"]),
        Project(name="LeafScan: crop disease detector", bullets=[
            "Trained a CNN in PyTorch on 54,000 leaf images to detect 38 crop diseases with 96% accuracy",
            "Served the model through a FastAPI endpoint and an Android app used by 150 farmers"]),
    ][:projects]
    return ResumeData(
        basics=Basics(name="Aarav Sharma", email="aarav@example.com", phone="+91 98765 43210",
                      location="Bengaluru, India", links=[Link(label="GitHub", url="github.com/aarav")]),
        education=[
            Education(school="Vellore Institute of Technology", degree="B.Tech", field="Computer Science",
                      start="2021", end="2025", grade="8.62 / 10 CGPA"),
            Education(school="Delhi Public School (CBSE)", degree="Class 12 (PCM)", end="2021", grade="94.2%"),
            Education(school="Delhi Public School (CBSE)", degree="Class 10", end="2019", grade="96.4%"),
        ],
        projects=work,
        experience=[Experience(title="Software Engineering Intern", company="Razorpay", start="May 2024",
                               end="Jul 2024", bullets=[
                                   "Built an internal dashboard in React and Go that tracks failed payouts for 3 teams",
                                   "Wrote 120 unit tests for the settlements service, raising coverage to 84%"])]
        if internship else [],
        skills=[SkillGroup(name="Languages", items=["C++", "Python", "Java", "JavaScript", "SQL"]),
                SkillGroup(name="Tools", items=["React", "Node.js", "Git", "Docker", "AWS", "MongoDB"])],
        extras=[ExtraSection(title="Positions of Responsibility", items=[
                    "General Secretary, Computer Society of India: led a team of 25 and ran a 400-person hackathon"]),
                ExtraSection(title="Achievements", items=["Winner, Smart India Hackathon 2023, out of 120 teams"])],
        section_order=["education", "projects", "skills", "experience"],
    )


def _by_id(data: ResumeData) -> dict[str, ats.AtsCheck]:
    return {c.id: c for c in ats.score_resume(data).checks}


def test_a_typical_btech_fresher_scores_well() -> None:
    report = ats.score_resume(_fresher())
    checks = {c.id: c for c in report.checks}
    assert report.score >= 80, [(c.id, c.points) for c in report.checks if not c.passed]
    for id_ in ("has_experience", "has_education", "roles_complete", "bullets_per_role", "quantified",
                "action_verbs", "single_column"):
        assert checks[id_].passed, id_
    assert checks["roles_complete"].label == "Every role has a title, company and dates"  # judged on the internship


def test_two_projects_with_bullets_count_as_experience_and_are_judged_like_roles() -> None:
    report = ats.score_resume(_fresher(internship=False))
    checks = {c.id: c for c in report.checks}
    assert checks["has_experience"].passed and "2+ projects" in checks["has_experience"].label
    assert checks["roles_complete"].passed and checks["roles_complete"].label.startswith("Every project")
    assert checks["bullets_per_role"].passed and checks["bullets_per_role"].label == "2-6 bullets per project"
    for id_ in ("quantified", "action_verbs", "bullet_length", "no_pronouns", "varied_verbs"):
        assert checks[id_].passed and checks[id_].points == checks[id_].max_points, id_
    assert report.score >= 80
    # The experience category is earned in full from the projects (with nothing judged, it scored zero).
    experience = next(c for c in report.categories if c.id == "experience")
    assert experience.points == experience.max_points


def test_project_bullets_are_flagged_where_they_are_and_fixable_with_ai() -> None:
    from orbit_api.resumes.ai import editable_fields

    data = _fresher(internship=False)
    data.projects[1].bullets = ["Responsible for the model", "Worked on the app"]
    checks = _by_id(data)
    weak = checks["action_verbs"]
    assert not weak.passed and weak.ai_fixable
    assert weak.paths == [f"projects.{data.projects[1].id}.bullets.0", f"projects.{data.projects[1].id}.bullets.1"]
    assert set(weak.paths) <= set(editable_fields(data))  # "Fix with AI" can rewrite exactly these lines
    assert checks["bullet_length"].target == f"projects.{data.projects[1].id}.bullets.0"  # 4 words


def test_one_project_is_judged_but_isnt_yet_experience() -> None:
    data = _fresher(internship=False, projects=1)
    checks = _by_id(data)
    assert not checks["has_experience"].passed
    assert "two projects with bullets" in (checks["has_experience"].fix or "")
    assert checks["action_verbs"].passed and checks["quantified"].passed  # its bullets are good ones
    data.projects[0].bullets = ["Made a website"]
    checks = _by_id(data)
    thin = checks["bullets_per_role"]
    assert not thin.passed and thin.target == f"projects.{data.projects[0].id}"
    assert thin.fix_kind == "you"  # the AI drafts bullets for roles, not projects


def test_an_unnamed_project_is_incomplete() -> None:
    data = _fresher(internship=False)
    data.projects[0].name = ""
    check = _by_id(data)["roles_complete"]
    assert check.points == 3 and check.target == f"projects.{data.projects[0].id}"


def test_project_without_bullets_asks_for_them() -> None:
    data = _fresher(internship=False)
    for p in data.projects:
        p.bullets = []
        p.description = "A student project"
    checks = _by_id(data)
    assert checks["quantified"].points == 0 and checks["quantified"].target == "projects"
    assert "each project" in (checks["quantified"].fix or "")


def test_experienced_resumes_score_as_before() -> None:
    from tests.test_resumes import strong_resume

    before = ats.score_resume(strong_resume())
    data = strong_resume()
    data.projects = [Project(name="Side project", bullets=["Wrote a thing"])]  # weak, but roles are what's judged
    after = {c.id: c for c in ats.score_resume(data).checks}
    for c in before.checks:
        if c.category in ("experience", "sections"):
            assert after[c.id].points == c.points and after[c.id].label == c.label, c.id


def test_an_empty_resume_still_scores_zero_for_experience() -> None:
    checks = _by_id(ResumeData())
    for id_ in ("has_experience", "roles_complete", "bullets_per_role", "action_verbs", "quantified"):
        assert checks[id_].points == 0, id_
    assert checks["roles_complete"].target == "experience" and checks["quantified"].target == "experience"
