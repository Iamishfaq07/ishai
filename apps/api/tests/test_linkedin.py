from fastapi.testclient import TestClient
from sqlalchemy import update

from orbit_api.db import sessionmaker
from orbit_api.linkedin.audit import audit
from orbit_api.linkedin.read import Profile, Role, School, parse_read
from orbit_api.models import User
from tests.test_api import _register
from tests.test_jobs import _listing, insert, jobs, run  # noqa: F401  (the fixture)

PDF_TEXT = """Contact
asha@example.com
www.linkedin.com/in/asha-rao (LinkedIn)
Top Skills
Go
Kafka
PostgreSQL
Certifications
AWS Certified Developer
Asha Rao
Backend Engineer at PayNest
Bengaluru, Karnataka, India
Summary
I build payment systems. I like hard problems and good teams and I am always learning new things every day.
Experience
PayNest
Backend Engineer
January 2021 - Present (3 years 9 months)
Built the payouts service in Go handling 2 million transfers a day, and cut settlement time by 40% with Kafka.
Acme
Software Engineer
June 2018 - December 2020 (2 years 7 months)
Education
IIT Delhi
B.Tech, Computer Science
Page 1 of 2"""


def test_the_read_keeps_only_text_that_is_on_the_profile() -> None:
    import json
    raw = json.dumps({"name": "Asha Rao", "headline": "Backend Engineer at PayNest",
                      "about": "I build payment systems and won three awards.",  # not on the profile
                      "experience": [{"title": "Backend Engineer", "company": "PayNest",
                                      "dates": "January 2021 - Present",
                                      "description": "Built the payouts service in Go handling 2 million transfers a "
                                                     "day, and cut settlement time by 40% with Kafka."}],
                      "skills": ["Go", "Kafka", "Rust"],  # Rust isn't listed
                      "url": "www.linkedin.com/in/asha-rao"})
    p = parse_read(raw, PDF_TEXT)
    assert p.headline == "Backend Engineer at PayNest"
    assert p.about == ""
    assert p.experience[0].current and "2 million" in p.experience[0].description
    assert p.skills == ["Go", "Kafka"]
    assert p.url == "www.linkedin.com/in/asha-rao"


KW = ["Go", "Kafka", "PostgreSQL", "Kubernetes", "AWS", "Docker", "Redis", "gRPC", "Python", "Microservices"]


def test_a_thin_profile_scores_low_and_says_what_to_fix() -> None:
    p = Profile(name="Asha", headline="Backend Engineer at PayNest",
                experience=[Role(title="Backend Engineer", company="PayNest", current=True)])
    a = audit(p, "Backend Engineer", KW)
    assert a.score < 40
    failed = {c.id for c in a.checks if not c.ok}
    assert {"headline_length", "headline_keywords", "headline_strong", "about_set", "exp_latest_text",
            "skills_count", "education"} <= failed
    tip = next(c.tip for c in a.checks if c.id == "headline_keywords")
    assert "Go" in tip or "Kafka" in tip


def test_a_strong_profile_scores_high() -> None:
    about = ("Backend engineer building payment systems in Go, Kafka and PostgreSQL on AWS and Kubernetes. "
             "At PayNest I built the payouts service that moves 2 million transfers a day and cut settlement time "
             "by 40%. " * 6 + "Open to backend roles: email me at asha@example.com.")
    desc = "Built the payouts service in Go and Kafka, 2 million transfers a day; cut settlement time by 40% on AWS."
    p = Profile(name="Asha", headline="Backend Engineer | Go, Kafka, PostgreSQL | Payments at scale: 2M transfers/day",
                about=about, url="https://www.linkedin.com/in/asha-rao",
                experience=[Role(title="Backend Engineer", company="PayNest", current=True, description=desc),
                            Role(title="Software Engineer", company="Acme", description=desc)],
                education=[School(school="IIT Delhi")], certifications=["AWS Certified Developer"],
                skills=[*KW, "Linux", "Git"])
    a = audit(p, "Backend Engineer", KW, [("Senior Backend Engineer", "PayNest"), ("Data Analyst", "Acme"),
                                          ("Intern", "Globex")])
    assert a.score >= 90, [c for c in a.checks if not c.ok]
    assert a.missing == []
    assert any("Globex" in m and "not on LinkedIn" in m for m in a.mismatches)
    assert any("Acme" in m and "Data Analyst" in m for m in a.mismatches)
    assert not any("PayNest" in m for m in a.mismatches)  # same role, more senior wording


def test_a_url_with_random_digits_is_not_custom() -> None:
    p = Profile(name="A", url="linkedin.com/in/asha-rao-4b2a91c7")
    assert not next(c for c in audit(p, "", []).checks if c.id == "url").ok


def _verify(client: TestClient, h: dict[str, str]) -> None:
    uid = client.get("/v1/auth/me", headers=h).json()["id"]

    async def go() -> None:
        async with sessionmaker()() as db:
            await db.execute(update(User).where(User.id == uid).values(email_verified=True))
            await db.commit()
    run(client, go)


def test_read_audit_retarget_and_delete(jobs: TestClient) -> None:  # noqa: F811
    _register(jobs)  # the first account is the admin (no cap) when this test runs alone
    h = _register(jobs)
    _verify(jobs, h)
    insert(jobs, *[_listing(company=f"C{i}", title="Backend Engineer", keywords=["Go", "Kafka", "Kubernetes", "AWS"])
                   for i in range(4)])
    empty = jobs.get("/v1/linkedin", headers=h).json()
    assert empty["profile"] is None and empty["reads_left"] == 3
    assert jobs.post("/v1/linkedin/read", headers=h, json={"text": "too short"}).status_code == 422
    r = jobs.post("/v1/linkedin/read-file", headers=h,
                  files={"file": ("Profile.txt", PDF_TEXT.encode(), "text/plain")})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["profile"]["name"] == "Asha Rao" and out["profile"]["headline"] == "Backend Engineer at PayNest"
    assert out["target_role"] == "Backend Engineer"  # from the latest role (no job profile saved)
    assert out["audit"]["posts"] == 4 and set(out["audit"]["keywords"]) == {"Go", "Kafka", "Kubernetes", "AWS"}
    assert "Kubernetes" in out["audit"]["missing"] and out["reads_left"] == 2
    retarget = jobs.put("/v1/linkedin/target", headers=h, json={"target_role": "Data Analyst"}).json()
    assert retarget["target_role"] == "Data Analyst" and retarget["audit"]["keywords"] == []
    assert retarget["reads_left"] == 2  # re-auditing is free
    other = _register(jobs)
    assert jobs.get("/v1/linkedin", headers=other).json()["profile"] is None
    assert jobs.delete("/v1/linkedin", headers=h).status_code == 204
    assert jobs.get("/v1/linkedin", headers=h).json()["profile"] is None
