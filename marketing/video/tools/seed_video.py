"""More of the demo person for the launch videos, on top of marketing/screens/seed.py (run that first): a first draft
of her resume (the "before" of Resume AI's fixes), pay ranges in a few older job posts (the market Offer AI reads),
an offer, and her LinkedIn profile as LinkedIn's "Save to PDF" lays it out. All fictional; LOCAL temp SQLite only.

usage (from apps/api, with the stack's ORBIT_DATABASE_URL):
    uv run python ../../marketing/video/tools/seed_video.py --api http://localhost:8034 --web http://localhost:5197 all
Steps: draft | pay | offer | linkedin (then restart the API: the job feed reads its posts at startup).
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "screens"))
import seed  # noqa: E402  (refuses anything but a temp SQLite database)

from orbit_api.job_portal.postings import dedupe_key, find_cities, listing_id, snippet_of  # noqa: E402
from orbit_api.job_portal.skills import listing_keywords  # noqa: E402
from orbit_api.models import JobListing  # noqa: E402
from sqlalchemy import delete  # noqa: E402

STATE = seed.STATE

DRAFT = copy.deepcopy(seed.RESUME)
DRAFT["basics"]["headline"] = "Data Analyst"
DRAFT["basics"]["summary"] = "Data analyst with experience in data. Hard working team player looking for new opportunities."
DRAFT["experience"][0]["bullets"] = [
    "Responsible for the delivery time model for checkout. Late deliveries went down 18% in two quarters.",
    "Worked on A/B tests on the booking flow with the product team, 14 tests, 5 shipped.",
    "Made a dashboard to replace 9 weekly spreadsheet reports for 60+ city managers.",
]
DRAFT["experience"][1]["bullets"] = [
    "Looked at the booking funnel and found the three steps where 40% of people dropped off.",
    "Did the monthly revenue report using SQL and Python, from 3 days to 4 hours.",
]
DRAFT["skills"] = [{"id": "s1", "name": "Skills", "items": ["Excel", "SQL", "Python"]}]
DRAFT["certifications"] = []
DRAFT["projects"] = []

PAY_POSTS = [  # (company, title, salary, days ago)
    ("Meridian Freight", "Analytics Engineer", "₹20L – ₹28L a year", 9),
    ("Saltpan Labs", "Analytics Engineer", "₹22L – ₹30L a year", 11),
    ("Lattice Grocers", "Analytics Engineer", "₹18L – ₹26L a year", 13),
    ("Bluefin Health", "Analytics Engineer", "₹24L – ₹34L a year", 15),
    ("Orchard Mobility", "Analytics Engineer", "₹21L – ₹29L a year", 17),
    ("Copperline", "Analytics Engineer", "₹25L – ₹32L a year", 19),
]

LINKEDIN = """Contact
aditi.rao@example.com
www.linkedin.com/in/aditi-rao-4b21a9 (LinkedIn)
Top Skills
SQL
Excel
Python
Aditi Rao
Data Analyst at Juniper Logistics
Bengaluru, Karnataka, India
Summary
I am a data analyst. I like working with data and finding insights.
Experience
Juniper Logistics
Senior Data Analyst
April 2023 - Present (1 year 7 months)
Worked on dashboards and reports for the operations team. Did analysis for the product team.
Fernway Travel
Data Analyst
July 2021 - March 2023 (1 year 9 months)
Analysed bookings data and made reports.
Education
College of Engineering, Pune
Bachelor of Technology - BTech, Information Technology
"""


def draft(api: str, web: str) -> None:
    with seed.client(api, web) as c:
        c.headers["Authorization"] = f"Bearer {seed.sign_in(c)}"
        resumes = c.get("/v1/resumes").json()
        rid = next((x["id"] for x in resumes if x["title"] == "Aditi Rao, first draft"), None)
        body = {"title": "Aditi Rao, first draft", "data": DRAFT, "design": seed.DESIGN, "job_text": seed.TEXT_ANALYST}
        if rid is None:
            r = c.post("/v1/resumes", json=body)
            r.raise_for_status()
            rid = r.json()["id"]
        else:
            c.put(f"/v1/resumes/{rid}", json=body).raise_for_status()
        score = c.post("/v1/resumes/score", json={"data": DRAFT, "design": seed.DESIGN, "job_text": seed.TEXT_ANALYST}).json()
        print("draft resume", rid, "ATS score", score.get("score"))
        seed.save_state(draft_resume_id=rid)


async def pay() -> None:
    async with seed.sessionmaker()() as db:
        await db.execute(delete(JobListing).where(JobListing.board == "orbit-demo-pay"))
        for i, (company, title, salary, days) in enumerate(PAY_POSTS):
            text = seed.TEXT_ENGINEER
            ext = f"demo-pay-{i}"
            url = f"https://careers.{company.lower().replace(' ', '')}.example/jobs/{5200 + i}-analytics-engineer"
            cities = find_cities("Bengaluru, India")
            db.add(JobListing(
                id=listing_id("greenhouse", ext), source="greenhouse", external_id=ext, board="orbit-demo-pay",
                company=company, title=title, locations=["Bengaluru, India"], cities=cities, country="IN",
                workplace="hybrid", employment_type="full_time", level="mid", exp_min=3, exp_max=6,
                posted_at=seed.NOW - days * seed.D, url=url, apply_url=url, snippet=snippet_of(text), description=text * 3,
                salary=salary, keywords=listing_keywords(title, text, company), text_hash="demo",
                dedupe_key=dedupe_key(company, title, cities, "hybrid"), fetched_at=seed.NOW - seed.H,
                created_at=seed.NOW - days * seed.D))
        await db.commit()
    print(f"{len(PAY_POSTS)} posts with pay ranges")


def offer(api: str, web: str) -> None:
    with seed.client(api, web) as c:
        c.headers["Authorization"] = f"Bearer {seed.sign_in(c)}"
        for o in c.get("/v1/offers").json():
            c.delete(f"/v1/offers/{o['id']}")
        r = c.post("/v1/offers", json={
            "company": "Cobalt Commerce", "role": "Analytics Engineer", "city": "Bengaluru", "currency": "INR",
            "fixed": 2200000, "variable": 200000, "joining_bonus": 150000, "equity_per_year": 0, "other": 0,
            "pf": "capped", "employer_costs_in_ctc": False, "deadline": None, "status": "considering",
            "notes": "Offer letter came on Friday. Joining bonus is paid back if I leave within a year."})
        if r.status_code >= 400:
            print("offer:", r.status_code, r.text[:400])
            r.raise_for_status()
        oid = r.json()["id"]
        seed.save_state(offer_id=oid)
        print("offer", oid)


def linkedin(api: str, web: str) -> None:
    with seed.client(api, web) as c:
        c.headers["Authorization"] = f"Bearer {seed.sign_in(c)}"
        c.delete("/v1/linkedin")
        r = c.post("/v1/linkedin/read", json={"text": LINKEDIN})
        if r.status_code >= 400:
            print("linkedin read:", r.status_code, r.text[:400])
            r.raise_for_status()
        state = r.json()
        r = c.put("/v1/linkedin/target", json={"target_role": "Product Analyst"})
        state = r.json() if r.status_code < 400 else state
        print("linkedin score", state.get("audit", {}).get("score"), "headline:", state.get("profile", {}).get("headline"))


INTERVIEW_QA = [
    ("Thanks for making time today. To start, tell me about a time you used data to change a product decision.",
     "At Juniper Logistics most late deliveries came from one promise we showed at checkout. I built a delivery-time "
     "model, made the case to show a window instead of a date, and late deliveries fell 18% in two quarters."),
    ("Walk me through an A/B test you designed, and what you'd do differently next time.",
     "We tested a delivery window against a single date. Cancellation rate was the main metric, conversion the "
     "guardrail, two weeks, split by city. Cancellations fell about 6% with no drop in conversion, so it shipped. "
     "Next time I'd run it a week longer to rule out a novelty effect."),
    ("How would you investigate a sudden drop in weekly bookings?",
     "First check it's real: tracking, a release, a holiday. Then split by platform, city and funnel step. At "
     "Fernway a drop like that was one Android release that broke the date picker."),
]


def interview(api: str, web: str) -> None:
    """An ended live session started from the Kestrel Pay job (the interview-day loop's wrap-up)."""
    import uuid
    from datetime import timedelta

    from orbit_api.models import LiveSessionRow, Question, SessionSummary, SessionTurn
    from sqlalchemy import update

    state = json.loads(STATE.read_text())
    entry = state["tracker"]["Kestrel Pay"]
    with seed.client(api, web) as c:
        c.headers["Authorization"] = f"Bearer {seed.sign_in(c)}"
        old = state.get("interview_session_id")
        if old and c.get(f"/v1/sessions/{old}").status_code == 200:
            c.delete(f"/v1/sessions/{old}")
        r = c.post("/v1/sessions", json={
            "title": "Kestrel Pay: hiring manager round", "type": "interview", "role": "Product Analyst",
            "company": "Kestrel Pay", "document_ids": [state["document_id"]], "application_id": entry})
        r.raise_for_status()
        sid = r.json()["id"]

    async def write() -> None:
        async with seed.sessionmaker()() as db:
            start = seed.NOW - 2 * seed.H
            t, ms = start, 0
            for i, (q, a) in enumerate(INTERVIEW_QA):
                tq = str(uuid.uuid4())
                q_ms = len(q.split()) * 380
                db.add(SessionTurn(id=tq, session_id=sid, speaker="interviewer", text=q, start_ms=ms, end_ms=ms + q_ms, created_at=t))
                db.add(Question(id=str(uuid.uuid4()), session_id=sid, turn_id=tq, text=q,
                                type="behavioral" if i == 0 else "technical", confidence=0.95, is_follow_up=False,
                                source="auto", created_at=t + timedelta(seconds=1)))
                ms += q_ms + 1500
                a_ms = len(a.split()) * 400
                db.add(SessionTurn(id=str(uuid.uuid4()), session_id=sid, speaker="candidate", text=a, start_ms=ms,
                                   end_ms=ms + a_ms, created_at=t + timedelta(seconds=4)))
                ms += a_ms + 1500
                t += timedelta(milliseconds=q_ms + a_ms + 6000)
            await db.flush()
            await db.execute(update(LiveSessionRow).where(LiveSessionRow.id == sid).values(
                status="ended", started_at=start, ended_at=start + timedelta(minutes=34), duration_s=34 * 60,
                created_at=start))
            db.add(SessionSummary(session_id=sid, content={
                "questions_asked": [q for q, _ in INTERVIEW_QA], "question_types": {"behavioral": 1, "technical": 2},
                "follow_up_count": 0,
                "summary": ("The hiring-manager round for Kestrel Pay's Product Analyst role: a product decision changed "
                            "with data, an A/B test end to end, and an investigation of a bookings drop."),
                "topics": ["Experiment design", "Funnel analysis", "Product decisions"],
                "important_follow_ups": ["Send the delivery-window test write-up"],
                "potential_weak_areas": ["Saying what you'd do differently earlier"],
                "suggested_preparation": ["Prepare a story about a test that didn't work"],
                "generated_by": "demo-seed"}))
            await db.commit()
    asyncio.run(write())
    seed.save_state(interview_session_id=sid)
    print("interview session", sid)


SABA_QA = [
    ("To start, tell me about a time you used data to change a product decision.",
     "At Juniper Logistics, most late deliveries came from the date we promised at checkout. So I built a "
     "delivery-time model, and made the case for showing a delivery window instead. Late deliveries fell 18% in two "
     "quarters."),
    ("That's a clear result. When you made the case for a window, how did you convince the product team?",
     "I ran a two-week test, split by city, with cancellations as the main metric. The numbers did the convincing."),
]
SABA_REVIEW = {
    "overall_score": 4,
    "strengths": ["You led with the problem and closed with a measured result", "A specific, testable change, not a vague one"],
    "improvements": ["Say what the guardrail metric was when you describe the test"],
    "practice": ["Tell the same story in 60 seconds, result first"],
    "items": [
        {"q": 1, "score": 4, "feedback": "Problem, action and a measured result in under a minute.",
         "better": "Name your part in one line before the model: 'I owned the analysis and the case to product.'",
         "missing_points": ["Who else was involved"], "delivery_score": 4, "clarity_score": 5,
         "dimensions": {"problem_framing": 4, "communication_clarity": 5}},
        {"q": 2, "score": 4, "feedback": "A test design is the right answer to 'how did you convince them'.",
         "better": "Add the guardrail you watched, conversion, so the result can't be read as a trade-off.",
         "missing_points": ["The guardrail metric"], "delivery_score": 4, "clarity_score": 4,
         "dimensions": {"problem_framing": 4, "technical_depth": 4, "communication_clarity": 4}},
    ],
}


def video(api: str, web: str) -> None:
    """An ended AI video interview with Saba (the review the Saba film ends on)."""
    import uuid
    from datetime import timedelta

    from orbit_api.models import LiveSessionRow, Question, SessionSummary, SessionTurn
    from orbit_api.sessions.delivery import delivery_stats
    from orbit_api.sessions.report import build_review, pair_questions_with_answers
    from sqlalchemy import select, update

    state = json.loads(STATE.read_text())
    with seed.client(api, web) as c:
        c.headers["Authorization"] = f"Bearer {seed.sign_in(c)}"
        old = state.get("video_session_id")
        if old and c.get(f"/v1/sessions/{old}").status_code == 200:
            c.delete(f"/v1/sessions/{old}")
        r = c.post("/v1/sessions", json={
            "title": "Video interview: Product Analyst", "type": "mock", "language": "en", "length": "standard",
            "style": "natural", "auto_answer": False, "role": "Product Analyst", "document_ids": [state["document_id"]],
            "mock": {"video": True, "company": "Kestrel Pay", "interview_type": "mixed", "difficulty": "medium",
                     "duration_minutes": 10, "adaptive_depth": True}})
        r.raise_for_status()
        sid = r.json()["id"]

    async def write() -> None:
        async with seed.sessionmaker()() as db:
            start = seed.NOW - 20 * 60 * timedelta(seconds=1)
            t, ms = start, 0
            for i, (q, a) in enumerate(SABA_QA):
                tq = str(uuid.uuid4())
                q_ms = len(q.split()) * 380
                db.add(SessionTurn(id=tq, session_id=sid, speaker="interviewer", text=q, start_ms=ms, end_ms=ms + q_ms, created_at=t))
                db.add(Question(id=str(uuid.uuid4()), session_id=sid, turn_id=tq, text=q, type="behavioral", confidence=0.95,
                                is_follow_up=i == 1, source="auto", created_at=t + timedelta(seconds=1)))
                ms += q_ms + 1200
                a_ms = len(a.split()) * 400
                db.add(SessionTurn(id=str(uuid.uuid4()), session_id=sid, speaker="candidate", text=a, start_ms=ms,
                                   end_ms=ms + a_ms, created_at=t + timedelta(seconds=4)))
                ms += a_ms + 1200
                t += timedelta(milliseconds=q_ms + a_ms + 5000)
            await db.flush()
            await db.execute(update(LiveSessionRow).where(LiveSessionRow.id == sid).values(
                status="ended", started_at=start, ended_at=start + timedelta(minutes=6, seconds=40), duration_s=400,
                created_at=start))
            turns = (await db.scalars(select(SessionTurn).where(SessionTurn.session_id == sid))).all()
            questions = (await db.scalars(select(Question).where(Question.session_id == sid))).all()
            pairs = pair_questions_with_answers(questions, turns)
            db.add(SessionSummary(session_id=sid, content={
                "questions_asked": [q for q, _ in SABA_QA], "question_types": {"behavioral": 2}, "follow_up_count": 1,
                "summary": ("A short video interview with Saba for a product analyst role: a product decision changed with "
                            "data, and how the case was made to the product team."),
                "topics": ["Product decisions", "Experiment design"], "important_follow_ups": [],
                "potential_weak_areas": ["Naming the guardrail metric"], "suggested_preparation": ["A 60-second version"],
                "review": build_review(SABA_REVIEW, pairs), "generated_by": "demo-seed",
                "delivery": delivery_stats(turns, [p.answer for p in pairs])}))
            await db.commit()
    asyncio.run(write())
    seed.save_state(video_session_id=sid)
    print("video interview", sid)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--api", default="http://localhost:8034")
    p.add_argument("--web", default="http://localhost:5197")
    p.add_argument("step", choices=["all", "draft", "pay", "offer", "linkedin", "interview", "video"])
    a = p.parse_args()
    if a.step in ("all", "draft"):
        draft(a.api, a.web)
    if a.step in ("all", "pay"):
        asyncio.run(pay())
    if a.step in ("all", "offer"):
        offer(a.api, a.web)
    if a.step in ("all", "linkedin"):
        linkedin(a.api, a.web)
    if a.step in ("all", "interview"):
        interview(a.api, a.web)
    if a.step in ("all", "video"):
        video(a.api, a.web)
    print(json.dumps(json.loads(STATE.read_text()), indent=1)[:400])


if __name__ == "__main__":
    main()
