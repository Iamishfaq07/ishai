"""A resume one past a list limit (an 11th skill group, which the editor's "add these skills" used to create) failed
every save and every AI request with Pydantic's "List should have at most 10 items after validation, not 11", even
where the honest answer was "you're out of AI credits"."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from orbit_api.resumes.apply import add_skills
from orbit_api.resumes.schema import MAX_SKILL_GROUPS, MAX_SKILLS_PER_GROUP, ResumeData, SkillGroup
from tests.test_credits import _new_ip, _signup, enforce  # noqa: F401  (the fixture)
from tests.test_resume_kit import credits_left, welcome  # noqa: F401  (the fixture)
from tests.test_resumes import JOB, strong_resume


def _groups(n: int, per: int = 3) -> list[dict[str, object]]:
    return [{"name": f"Group {g}", "items": [f"skill-{g}-{i}" for i in range(per)]} for g in range(n)]


def test_an_eleventh_skill_group_joins_the_others_instead_of_failing() -> None:
    groups = _groups(MAX_SKILL_GROUPS)
    groups.append({"name": "Additional skills", "items": ["Kafka", "skill-0-0", "Airflow"]})
    data = ResumeData.model_validate({"skills": groups})
    assert len(data.skills) == MAX_SKILL_GROUPS
    items = [i for g in data.skills for i in g.items]
    assert "Kafka" in items and "Airflow" in items
    assert items.count("skill-0-0") == 1  # a repeat isn't added twice


def test_folded_skills_stop_when_every_group_is_full() -> None:
    groups = _groups(MAX_SKILL_GROUPS, per=MAX_SKILLS_PER_GROUP)
    groups.append({"name": "More", "items": ["Kafka"]})
    data = ResumeData.model_validate({"skills": groups})
    assert len(data.skills) == MAX_SKILL_GROUPS
    assert all(len(g.items) == MAX_SKILLS_PER_GROUP for g in data.skills)


def test_a_list_far_past_the_limit_still_fails() -> None:
    with pytest.raises(ValidationError):
        ResumeData.model_validate({"skills": _groups(5 * MAX_SKILL_GROUPS)})


def test_adding_skills_with_ten_groups_fills_the_roomiest_one() -> None:
    data = ResumeData(skills=[SkillGroup(name=f"G{g}", items=["x"] * (5 + g)) for g in range(MAX_SKILL_GROUPS)])
    out = add_skills(data, ["Kafka", "Airflow"])
    assert len(out.skills) == MAX_SKILL_GROUPS
    assert out.skills[0].items[-2:] == ["Kafka", "Airflow"]  # G0 had the fewest


def test_out_of_credits_with_an_eleventh_group_says_so(client: TestClient, welcome: None) -> None:  # noqa: F811
    ip = _new_ip()
    _signup(client, ip)
    h = _signup(client, ip)  # the welcome credit is one per network: this account has none
    assert credits_left(client, h) == 0
    data = strong_resume().model_dump(mode="json")
    data["skills"] = _groups(MAX_SKILL_GROUPS + 1)
    r = client.post("/v1/resumes/outreach", headers=h, json={"data": data, "job_text": JOB, "kind": "referral"})
    assert r.status_code == 402, r.text
    assert r.json()["detail"]["code"] == "upgrade_required"
