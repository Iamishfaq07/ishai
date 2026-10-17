"""Seed a LOCAL Orbit stack with the demo person the marketing screens show: Aditi Rao, a data analyst with about four
years' experience, looking for a product or senior data analyst role. Everyone and every employer here is made up.

What it makes:
- through the local API: the account, a resume in Resume AI, the same resume as a document (so live answers can cite
  it), the Jobs AI search profile, tracker entries in every stage, and an ended mock interview;
- straight into the local SQLite database (no API writes these): job postings from fictional employers for the
  matches, believable dates on the tracker, and the mock interview's transcript, questions and scorecard (the mock
  LLM's own report says "[mock]", so the scorecard is written here with the server's own report builder).

It refuses to run unless ORBIT_DATABASE_URL is a SQLite file in a temp folder. Never point it at a real database.

usage (from apps/api, with the same ORBIT_DATABASE_URL as the running local API):
    uv run python ../../marketing/screens/seed.py --api http://localhost:8023 --web http://localhost:5186 all
    # then restart the local API (the feed reads its postings at startup) and capture: marketing/screens/capture.mjs
Steps can be run one at a time: account | listings | tracker | mock (account first; tracker after listings).
"""

import argparse
import asyncio
import json
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

DB_URL = os.environ.get("ORBIT_DATABASE_URL", "")
_db_file = DB_URL.split("///", 1)[-1].lower()
if not DB_URL.startswith("sqlite") or not any(t in _db_file for t in ("/temp/", "\\temp\\", "/tmp/")):
    sys.exit(f"refusing: ORBIT_DATABASE_URL must be a SQLite file in a temp folder, not {DB_URL!r}")

from sqlalchemy import delete, select, update  # noqa: E402

from orbit_api.db import sessionmaker  # noqa: E402
from orbit_api.job_portal.postings import dedupe_key, find_cities, listing_id, snippet_of  # noqa: E402
from orbit_api.job_portal.skills import listing_keywords  # noqa: E402
from orbit_api.models import (  # noqa: E402
    JobApplication,
    JobListing,
    LiveSessionRow,
    Question,
    SessionSummary,
    SessionTurn,
)
from orbit_api.sessions.delivery import delivery_stats  # noqa: E402
from orbit_api.sessions.report import build_review, pair_questions_with_answers  # noqa: E402

EMAIL = "aditi.demo@example.com"
PASSWORD = "orbit-demo-password-2026"
NAME = "Aditi Rao"
STATE = Path(__file__).with_name(".seed-state.json")  # ids for capture.mjs (gitignored)
NOW = datetime.now(UTC)
H, D = timedelta(hours=1), timedelta(days=1)

RESUME: dict[str, Any] = {
    "basics": {
        "name": NAME,
        "headline": "Senior Data Analyst · SQL, Python, product analytics",
        "email": "aditi.rao@example.com",
        "phone": "+91 98765 43210",  # the usual placeholder number, as on Resume AI's public sample
        "location": "Bengaluru, India",
        "links": [{"label": "LinkedIn", "url": "linkedin.com/in/aditi-rao-demo"}],
        "summary": (
            "Data analyst with four years of experience in logistics and travel, turning product and operations data "
            "into decisions. I build the metrics, run the experiments and explain the results to product and "
            "operations teams in plain words."
        ),
    },
    "experience": [
        {
            "id": "x1", "title": "Senior Data Analyst", "company": "Juniper Logistics", "location": "Bengaluru",
            "start": "Apr 2023", "end": "", "current": True,
            "bullets": [
                "Built the delivery-time model behind the checkout promise, cutting late deliveries by 18% in two quarters.",
                "Designed and analysed 14 A/B tests on the booking flow with the product team; 5 shipped to all users.",
                "Replaced 9 weekly spreadsheet reports with one Looker dashboard used by 60+ city managers.",
            ],
        },
        {
            "id": "x2", "title": "Data Analyst", "company": "Fernway Travel", "location": "Pune",
            "start": "Jul 2021", "end": "Mar 2023", "current": False,
            "bullets": [
                "Found the three steps where 40% of mobile bookings dropped off, and worked with design on the fixes.",
                "Automated the monthly revenue close with SQL and Python, from 3 days to 4 hours.",
            ],
        },
    ],
    "education": [
        {"id": "e1", "school": "College of Engineering, Pune", "degree": "B.Tech", "field": "Information Technology",
         "start": "2017", "end": "2021", "grade": "8.4 / 10 CGPA", "details": ""},
    ],
    "skills": [
        {"id": "s1", "name": "Analysis", "items": ["SQL", "Python (pandas)", "A/B testing", "Statistics", "Forecasting"]},
        {"id": "s2", "name": "Tools", "items": ["Looker", "BigQuery", "dbt", "Tableau", "Git"]},
    ],
    "projects": [
        {"id": "p1", "name": "Open bus-delay tracker", "link": "", "description": "",
         "bullets": ["A public dashboard of city bus delays from open GPS data, used by a local commuter group."]},
    ],
    "certifications": [{"id": "c1", "name": "Google Advanced Data Analytics Certificate", "issuer": "Coursera",
                        "date": "2024"}],
    "extras": [],
    "section_order": ["summary", "experience", "skills", "projects", "education", "certifications"],
}

DESIGN: dict[str, Any] = {"template": "modern", "accent": "#4f46e5", "font": "inter"}

TEXT_ANALYST = (
    "We're hiring a product analyst to work with our payments product team. You'll define the metrics for new "
    "features, design and read A/B tests, and build dashboards in Looker on BigQuery. Strong SQL and Python, "
    "experience with experimentation and statistics, and the ability to explain results to product managers and "
    "engineers. 3-5 years of experience. "
)
TEXT_SENIOR = (
    "Join the analytics team as a senior data analyst. Own the metrics for our marketplace, work with dbt and "
    "BigQuery, run experiments with product managers and present findings to leadership. SQL, Python, statistics "
    "and A/B testing are a must; Looker or Tableau a plus. 4-6 years of experience. "
)
TEXT_GROWTH = (
    "Our growth team needs a data analyst to own funnel and retention analysis in Amplitude and SQL, size "
    "experiments with product managers, and automate reporting in Python. Snowflake and Airflow experience is a plus. "
    "2-4 years of experience. "
)
TEXT_ENGINEER = (
    "As an analytics engineer you will build our data models in dbt on Snowflake, orchestrate pipelines with Airflow, "
    "write production SQL and Python, and give analysts clean, tested tables. Spark experience is a plus. "
    "3-6 years of experience. "
)
TEXT_HEALTH = (
    "Brightline Health is looking for a data analyst for our care operations team: forecasting demand, building "
    "dashboards in Tableau and SQL, and analysing patient journeys with Python. 2-4 years of experience. "
)

# (source, company, title, location, workplace, type, level, exp, posted ago, text)
POSTS = [
    ("greenhouse", "Kestrel Pay", "Product Analyst, Payments", "Bengaluru, India", "hybrid", "full_time", "mid", (3, 5), 5 * H, TEXT_ANALYST),
    ("lever", "Lumen Analytics", "Senior Data Analyst", "Bengaluru, India", "onsite", "full_time", "senior", (4, 6), 20 * H, TEXT_SENIOR),
    ("ashby", "Northwind Labs", "Product Analyst", "Remote, India", "remote", "full_time", "mid", (3, 5), 30 * H, TEXT_GROWTH),
    ("greenhouse", "Brightline Health", "Data Analyst, Care Operations", "Bengaluru, India", "hybrid", "full_time", "mid", (2, 4), 2 * D, TEXT_HEALTH),
    ("lever", "Cobalt Commerce", "Analytics Engineer", "Bengaluru, India", "hybrid", "full_time", "mid", (3, 6), 3 * D, TEXT_ENGINEER),
    ("ashby", "Tessellate", "Senior Product Analyst", "Remote, India", "remote", "full_time", "senior", (4, 7), 3 * D, TEXT_ANALYST),
    ("smartrecruiters", "Quillbook", "Data Analyst, Growth", "Pune, India", "onsite", "full_time", "mid", (2, 4), 4 * D, TEXT_GROWTH),
    ("greenhouse", "Parallel Grid", "Business Intelligence Analyst", "Hyderabad, India", "onsite", "full_time", "mid", (3, 5), 5 * D, TEXT_HEALTH),
    ("lever", "Harbourline", "Marketing Data Analyst", "Bengaluru, India", "hybrid", "full_time", "mid", (2, 5), 6 * D, TEXT_GROWTH),
]
BOARD = "orbit-demo"


def client(api: str, web: str) -> httpx.Client:
    return httpx.Client(base_url=api, headers={"Origin": web}, timeout=30)


def sign_in(c: httpx.Client) -> str:
    r = c.post("/v1/auth/login", json={"email": EMAIL, "password": PASSWORD})
    r.raise_for_status()
    token = r.json().get("access_token")
    assert token, "the API gave no Bearer token (is --web the API's own ORBIT_WEB_URL? use another origin)"
    return str(token)


def save_state(**kv: Any) -> None:
    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    state.update(kv)
    STATE.write_text(json.dumps(state, indent=2))


def account(api: str, web: str) -> None:
    with client(api, web) as c:
        r = c.post("/v1/auth/register", json={"email": EMAIL, "password": PASSWORD, "name": NAME, "country": "IN"})
        if r.status_code not in (201, 409, 400):
            r.raise_for_status()
        c.headers["Authorization"] = f"Bearer {sign_in(c)}"
        resumes = c.get("/v1/resumes").json()
        rid = next((x["id"] for x in resumes if x["title"] == "Aditi Rao, analyst"), None)
        body = {"title": "Aditi Rao, analyst", "data": RESUME, "design": DESIGN, "job_text": TEXT_ANALYST}
        if rid is None:
            r = c.post("/v1/resumes", json=body)
            r.raise_for_status()
            rid = r.json()["id"]
        else:
            c.put(f"/v1/resumes/{rid}", json=body).raise_for_status()  # a re-run brings the resume up to date
        score = c.post("/v1/resumes/score", json={"data": RESUME, "design": DESIGN, "job_text": TEXT_ANALYST}).json()
        print("resume", rid, "ATS score", score.get("score"), score.get("label", ""))
        text = "\n".join([
            NAME, RESUME["basics"]["headline"], RESUME["basics"]["summary"],
            *[f"{x['title']}, {x['company']} ({x['start']} - {x['end'] or 'present'}): " + " ".join(x["bullets"])
              for x in RESUME["experience"]],
            "Skills: " + "; ".join(", ".join(s["items"]) for s in RESUME["skills"]),
        ])
        docs = c.get("/v1/documents").json()
        did = next((d["id"] for d in docs if d.get("title") == "Aditi Rao resume"), None)
        if did is None:
            r = c.post("/v1/documents/text", json={"title": "Aditi Rao resume", "kind": "resume", "text": text})
            r.raise_for_status()
            did = r.json()["id"]
        prefs = {"titles": ["Product Analyst", "Senior Data Analyst", "Analytics Engineer"],
                 "skills": ["SQL", "Python", "A/B testing", "Looker", "BigQuery", "dbt", "Statistics", "Tableau"],
                 "locations": ["Bengaluru", "Remote"], "workplace": ["remote", "hybrid", "onsite"],
                 "level": "mid", "years": 4, "posted_within": 7}
        c.put("/v1/jobs/profile", json={"prefs": prefs, "resume_id": rid}).raise_for_status()
        save_state(email=EMAIL, password=PASSWORD, resume_id=rid, document_id=did)
        print("account ready:", EMAIL)


async def listings() -> None:
    async with sessionmaker()() as db:
        await db.execute(delete(JobListing).where(JobListing.board == BOARD))
        for i, (src, company, title, where, mode, kind, level, exp, posted, text) in enumerate(POSTS):
            ext = f"demo-{i}"
            slug = "".join(ch if ch.isalnum() else "-" for ch in title.lower()).strip("-")
            url = f"https://careers.{company.lower().replace(' ', '')}.example/jobs/{4100 + i}-{slug}"
            cities = find_cities(where)
            db.add(JobListing(
                id=listing_id(src, ext), source=src, external_id=ext, board=BOARD, company=company, title=title,
                locations=[where], cities=cities, country="IN", workplace=mode, employment_type=kind, level=level,
                exp_min=exp[0], exp_max=exp[1], posted_at=NOW - posted, url=url, apply_url=url,
                snippet=snippet_of(text), description=text * 3, salary=None,
                keywords=listing_keywords(title, text, company), text_hash="demo",
                dedupe_key=dedupe_key(company, title, cities, mode), fetched_at=NOW - H, created_at=NOW - posted))
        await db.commit()
    print(f"{len(POSTS)} postings (restart the API so the feed reads them)")


def tracker(api: str, web: str) -> None:
    async def ids() -> dict[str, str]:
        async with sessionmaker()() as db:
            return {r.company: r.id for r in (await db.scalars(select(JobListing).where(JobListing.board == BOARD)))}
    by_company = asyncio.run(ids())
    plan = [("Kestrel Pay", "interviewing"), ("Lumen Analytics", "applied"), ("Brightline Health", "applied"),
            ("Northwind Labs", "saved"), ("Tessellate", "saved"), ("Cobalt Commerce", "offer"), ("Quillbook", "rejected")]
    with client(api, web) as c:
        c.headers["Authorization"] = f"Bearer {sign_in(c)}"
        entries = {}
        for company, status in plan:
            r = c.post("/v1/jobs/tracker", json={"listing_id": by_company[company], "status": status})
            r.raise_for_status()
            entries[company] = r.json()["id"]
        interview = (NOW + 2 * D).replace(hour=5, minute=30, second=0, microsecond=0)  # 11:00 in India, in two days
        c.patch(f"/v1/jobs/tracker/{entries['Kestrel Pay']}", json={
            "next_at": interview.isoformat(),
            "notes": "Hiring manager round with the payments product lead. Prepare the A/B test story and the delivery-time model.",
        }).raise_for_status()
        c.patch(f"/v1/jobs/tracker/{entries['Lumen Analytics']}", json={
            "notes": "Referred by Meera (ex-Fernway). Follow up on Friday if there's no reply."}).raise_for_status()

    # Believable history: applied a while ago, moved since.
    async def dates() -> None:
        async with sessionmaker()() as db:
            for company, applied, moved in [("Kestrel Pay", 9, 2), ("Lumen Analytics", 5, 5), ("Brightline Health", 8, 8),
                                            ("Northwind Labs", None, 1), ("Tessellate", None, 0),
                                            ("Cobalt Commerce", 21, 1), ("Quillbook", 16, 6)]:
                values: dict[str, Any] = {"status_at": NOW - moved * D, "created_at": NOW - max(applied or 0, moved, 1) * D}
                if applied:
                    values["applied_at"] = NOW - applied * D
                await db.execute(update(JobApplication).where(JobApplication.id == entries[company]).values(**values))
            await db.commit()
    asyncio.run(dates())
    save_state(tracker=entries)
    print("tracker:", ", ".join(f"{c} {s}" for c, s in plan))


MOCK_QA = [
    ("Tell me about yourself, and why product analytics.",
     "I'm a data analyst at Juniper Logistics, where I own delivery-time analytics. Over four years, first at Fernway "
     "Travel and now at Juniper, I've found I enjoy the part where a number changes a product decision. Last year our "
     "delivery-time model changed the promise we show at checkout and cut late deliveries by 18%. I'd like to do more "
     "of that, closer to a product team, which is why I'm looking at product analyst roles."),
    ("Walk me through an A/B test you designed. What did you measure, and what happened?",
     "At Juniper we wanted to know if showing a delivery window instead of a single date would reduce cancellations. "
     "I set cancellation rate as the primary metric and conversion as a guardrail, sized the test for two weeks, and "
     "split by city. The window cut cancellations by about 6% with no drop in conversion, so it shipped everywhere. "
     "I'd also check novelty effects next time by running it a week longer."),
    ("How would you investigate a sudden drop in weekly bookings?",
     "First I'd check whether it's real: tracking changes, a release, a holiday. Then I'd split the drop by platform, "
     "city and funnel step to see where it lives. At Fernway a similar drop turned out to be one Android release that "
     "broke the date picker, and we found it in an afternoon by comparing app versions."),
    ("Tell me about a time you disagreed with a stakeholder.",
     "Our operations lead wanted a daily dashboard of forty metrics. I thought it would hide the three that mattered. "
     "I showed him a prototype with the three, plus a drill-down, and we agreed to try it for a month. Usage went up, "
     "and we kept it."),
]
MOCK_REVIEW = {
    "overall_score": 4,
    "strengths": ["Clear structure: the point first, then the example", "Real numbers from your own work",
                  "Calm, specific answers to the investigation question"],
    "improvements": ["Say what you'd do differently in the A/B test story earlier",
                     "In the disagreement story, name the result in numbers"],
    "practice": ["Retell the stakeholder story with the outcome measured", "Practise a 60-second version of 'tell me about yourself'"],
    "items": [
        {"q": 1, "score": 4, "feedback": "A clear arc from your current role to why product analytics, with one strong result.",
         "better": "Open with the result: 'Last year my delivery-time model changed what we promise at checkout and cut late deliveries by 18%.'",
         "missing_points": ["What you want to learn in the new role"], "delivery_score": 4, "clarity_score": 5,
         "dimensions": {"problem_framing": 4, "communication_clarity": 5}},
        {"q": 2, "score": 5, "feedback": "Metric, guardrail, sizing and the result: a complete test story.",
         "better": "Add one line on how you checked the split was balanced before reading the result.",
         "missing_points": ["How sample size was chosen"], "delivery_score": 4, "clarity_score": 5,
         "dimensions": {"problem_framing": 5, "technical_depth": 4, "edge_case_rigor": 4, "communication_clarity": 5}},
        {"q": 3, "score": 4, "feedback": "Good order of checks and a real example; the segmentation step could be sharper.",
         "better": "Name the first three cuts you'd make (platform, city, funnel step) and what each would rule out.",
         "missing_points": ["Comparing with the same week last year"], "delivery_score": 4, "clarity_score": 4,
         "dimensions": {"problem_framing": 4, "technical_depth": 4, "edge_case_rigor": 3, "communication_clarity": 4}},
        {"q": 4, "score": 3, "feedback": "A good situation and action; the result needs a number.",
         "better": "Say how much usage went up, and what the operations lead decided because of it.",
         "missing_points": ["The measured outcome", "What you learned"], "delivery_score": 3, "clarity_score": 4,
         "dimensions": {"communication_clarity": 4}},
    ],
}


def mock(api: str, web: str) -> None:
    with client(api, web) as c:
        c.headers["Authorization"] = f"Bearer {sign_in(c)}"
        state = json.loads(STATE.read_text()) if STATE.exists() else {}
        old = state.get("mock_session_id")
        if old and c.get(f"/v1/sessions/{old}").status_code == 200:
            c.delete(f"/v1/sessions/{old}")
        r = c.post("/v1/sessions", json={
            "title": "Product analyst: hiring manager round", "type": "mock", "role": "Product Analyst",
            "company": "Kestrel Pay", "document_ids": [state["document_id"]] if state.get("document_id") else [],
            "mock": {"interview_type": "mixed", "difficulty": "medium", "duration_minutes": 20, "persona": "hiring_manager"},
        })
        r.raise_for_status()
        sid = r.json()["id"]

    async def write() -> None:
        async with sessionmaker()() as db:
            start = NOW - 2 * D - 3 * H
            t = start
            ms = 0
            for i, (q, a) in enumerate(MOCK_QA):
                qid = str(uuid.uuid4())
                tq = str(uuid.uuid4())
                q_ms = len(q.split()) * 380
                db.add(SessionTurn(id=tq, session_id=sid, speaker="interviewer", text=q, start_ms=ms, end_ms=ms + q_ms,
                                   created_at=t))
                db.add(Question(id=qid, session_id=sid, turn_id=tq, text=q, type="behavioral" if i in (0, 3) else "technical",
                                confidence=0.95, is_follow_up=False, source="auto", created_at=t + timedelta(seconds=1)))
                ms += q_ms + 1800
                a_ms = len(a.split()) * 400
                db.add(SessionTurn(id=str(uuid.uuid4()), session_id=sid, speaker="candidate", text=a, start_ms=ms,
                                   end_ms=ms + a_ms, created_at=t + timedelta(seconds=4)))
                ms += a_ms + 1500
                t += timedelta(milliseconds=q_ms + a_ms + 6000)
            await db.flush()
            await db.execute(update(LiveSessionRow).where(LiveSessionRow.id == sid).values(
                status="ended", started_at=start, ended_at=start + timedelta(minutes=19, seconds=12), duration_s=19 * 60 + 12,
                created_at=start, rolling_summary=None))
            turns = (await db.scalars(select(SessionTurn).where(SessionTurn.session_id == sid))).all()
            questions = (await db.scalars(select(Question).where(Question.session_id == sid))).all()
            pairs = pair_questions_with_answers(questions, turns)
            report = {
                "questions_asked": [q for q, _ in MOCK_QA],
                "question_types": {"behavioral": 2, "technical": 2},
                "follow_up_count": 0,
                "summary": ("A hiring-manager round for a product analyst role. You explained your move into product "
                            "analytics, walked through a complete A/B test, investigated a bookings drop step by step and "
                            "told a stakeholder story. Strongest on experiments; add measured outcomes to behavioural stories."),
                "topics": ["Experiment design", "Funnel analysis", "Stakeholder management", "Career story"],
                "important_follow_ups": ["Send the hiring manager the delivery-window test write-up you mentioned"],
                "potential_weak_areas": ["Outcomes in behavioural stories"],
                "suggested_preparation": ["Prepare one more story where you changed a decision with data",
                                          "Review sample-size and power basics"],
                "review": build_review(MOCK_REVIEW, pairs),
                "generated_by": "demo-seed",
                "delivery": delivery_stats(turns, [p.answer for p in pairs]),
            }
            await db.execute(delete(SessionSummary).where(SessionSummary.session_id == sid))
            db.add(SessionSummary(session_id=sid, content=report))
            await db.commit()
    asyncio.run(write())
    save_state(mock_session_id=sid)
    print("mock interview:", sid)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://localhost:8023")
    p.add_argument("--web", default="http://localhost:5186", help="an origin the local API allows (ORBIT_CORS_ORIGINS)")
    p.add_argument("step", choices=["all", "account", "listings", "tracker", "mock"])
    a = p.parse_args()
    if a.step in ("all", "account"):
        account(a.api, a.web)
    if a.step in ("all", "listings"):
        asyncio.run(listings())
    if a.step in ("all", "tracker"):
        tracker(a.api, a.web)
    if a.step in ("all", "mock"):
        mock(a.api, a.web)


if __name__ == "__main__":
    main()
