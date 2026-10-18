"""Written demo content for the launch videos: what the AI says in the scenes, on a LOCAL stack only.

tools/demo_api.py runs the real API with its mock AI, and asks `respond()` first: a request type listed here gets
these words, anything else falls back to the mock's own. Everything is about the fictional demo person (Aditi Rao,
marketing/screens/seed.py) and made-up employers. The server still does all of its own work around the words
(grounding, scoring, re-scoring after a fix), so the screens show what the product really computes.
"""

from __future__ import annotations

import json
import re
from typing import Any

# ── Resume AI: the draft resume's lines, and what "Fix with AI" writes for them (same facts, better told) ────────
RESUME_FIXES: list[tuple[str, str]] = [
    ("Responsible for the delivery time model",
     "Built the delivery-time model behind the checkout promise, cutting late deliveries by 18% in two quarters."),
    ("Worked on A/B tests",
     "Designed and analysed 14 A/B tests on the booking flow with the product team; 5 shipped to all users."),
    ("Made a dashboard",
     "Replaced 9 weekly spreadsheet reports with one dashboard used by 60+ city managers."),
    ("Looked at the booking funnel",
     "Identified the three steps where 40% of bookings dropped off in the app, and worked with design on the fixes."),
    ("Did the monthly revenue report",
     "Automated the monthly revenue close with SQL and Python, from 3 days to 4 hours."),
    ("Data analyst with experience",
     "Data analyst in logistics and travel who turns product and operations data into decisions: A/B tests, a "
     "delivery-time model and dashboards, built in SQL and Python and explained in plain words to product teams."),
]


HEADLINE = "Senior Data Analyst · SQL, Python, A/B tests"


def _resume_suggest(body: str) -> str | None:
    """Suggestions for the listed fields: the headline, the summary and any line in RESUME_FIXES."""
    m = re.search(r'<reference_data source="resume_fields">\s*(\[.*?\])\s*</reference_data>', body, re.S)
    try:
        fields = json.loads(m.group(1)) if m else []
    except json.JSONDecodeError:
        return None
    out = []
    for f in fields:
        path, text = str(f.get("path", "")), str(f.get("text", ""))
        if path == "basics.headline":
            after = HEADLINE
        else:
            after = next((a for b, a in RESUME_FIXES if b.lower() in text.lower()), None)
        if after and after != text:
            out.append({"path": path, "after": after,
                        "reason": "Leads with what you did and names the tools the job asks for."})
    return json.dumps({"suggestions": out})


def _resume_fix(body: str) -> str | None:
    m = re.search(r'<reference_data source="lines_to_fix">\s*(\[.*?\])\s*</reference_data>', body, re.S)
    try:
        lines = json.loads(m.group(1)) if m else []
    except json.JSONDecodeError:
        return None
    out = []
    for line in lines:
        text = str(line.get("text", ""))
        after = next((a for b, a in RESUME_FIXES if b.lower() in text.lower()), None)
        if line.get("path") == "basics.headline":
            after = HEADLINE
        if after:
            out.append({"path": line["path"], "after": after,
                        "reason": "Starts with what you did, keeps your numbers, and names the tools the job asks for."})
    # Nothing of ours (a line already rewritten): no change, rather than the mock's own words.
    return json.dumps({"suggestions": out, "questions": []})


# ── LinkedIn AI ────────────────────────────────────────────────────────────────────────────────────────────────
LI_HEADLINE = {"options": [
    {"style": "search", "text": "Product Analyst | SQL, Python, A/B testing, Looker | Turning product data into decisions"},
    {"style": "result", "text": "Product Analyst | My delivery-time model cut late deliveries by 18% | SQL, Python, BigQuery"},
    {"style": "focus", "text": "Product and data analyst for logistics and travel | Experiments, metrics, dashboards"},
]}
LI_ABOUT = {
    "opening": ("I'm a data analyst who turns product data into decisions. At Juniper Logistics my delivery-time model "
                "changed the promise we show at checkout and cut late deliveries by 18% in two quarters."),
    "rest": ("Over four years, first at Fernway Travel and now at Juniper, I've designed and analysed 14 A/B tests on "
             "the booking flow, found where 40% of mobile bookings dropped off, and replaced nine weekly spreadsheet "
             "reports with one Looker dashboard that 60+ city managers use.\n\n"
             "The tools I use most: SQL, Python (pandas), BigQuery, dbt, Looker and Tableau, with the statistics to "
             "read an experiment properly.\n\n"
             "I'm looking for product analyst roles, close to a product team. Message me here."),
}
LI_ROLE = {"bullets": [
    "Built the delivery-time model behind the checkout promise, cutting late deliveries by 18% in two quarters.",
    "Designed and analysed 14 A/B tests on the booking flow with the product team; 5 shipped to all users.",
    "Replaced 9 weekly spreadsheet reports with one Looker dashboard used by 60+ city managers.",
]}

# ── Offer AI ───────────────────────────────────────────────────────────────────────────────────────────────────
def _offer_plan(body: str) -> str:
    fixed = re.search(r'"fixed":\s*(\d+)', body)
    base = int(fixed.group(1)) if fixed else 2200000
    ask = int(round(base * 1.14 / 50000) * 50000)
    return json.dumps({
        "ask": ask,
        "ask_why": "It sits in the upper half of what recent posts for this role in Bengaluru pay, and your experiment work is what the role asks for.",
        "reasons": [
            "You've designed and analysed 14 A/B tests on a booking flow, and the role is built around experiments.",
            "Your Looker dashboard replaced 9 weekly reports for 60+ managers: the reporting this team wants to automate.",
            "The fixed pay offered is below the middle of the market range Orbit read for the role.",
        ],
        "call_script": [
            "Thank you, I'm really excited about the role and the team.",
            "Having looked at the market for analytics engineers in Bengaluru, I was hoping for a fixed pay closer to the number I sent.",
            "My experiment work at Juniper is very close to what you described for the first six months.",
            "If the fixed pay can't move, could we look at a joining bonus, or a review at six months?",
        ],
        "email": {"subject": "Re: your offer for the Analytics Engineer role",
                  "body": ("Hi [Recruiter name],\n\nThank you for the offer. I'm excited about the team and the work on "
                           "your data models.\n\nHaving looked at the market for this role in Bengaluru, and given my "
                           "experience designing and analysing experiments at Juniper Logistics, I'd like to ask for a "
                           "fixed pay closer to the figure we discussed. If that's hard, a joining bonus or a review at "
                           "six months would also work for me.\n\nThank you again,\n[Your name]")},
        "questions": ["How is the variable pay decided, and what did people in this role get last year?",
                      "When is the first salary review?"],
        "watch_outs": ["The joining bonus is paid back if you leave within a year: check the letter."],
    })


# ── Interview day: the wrap-up's follow-up (debrief and thank-you note) ──────────────────────────────────────────
FOLLOW_UP = {
    "debrief": {
        "went_well": ["The A/B test story: metric, guardrail and result, in under two minutes",
                      "A clear walk through the bookings-drop investigation"],
        "to_improve": ["Say what you'd do differently earlier in the experiment story"],
        "promised": ["Send the delivery-window test write-up"],
        "next_steps": ["Follow up on Friday if you haven't heard back"],
    },
    "thank_you": {
        "subject": "Thank you for today's conversation",
        "body": ("Hi [Interviewer name],\n\nThank you for the conversation today about the Product Analyst role. I "
                 "enjoyed talking through how your team runs experiments on the payments flow.\n\nAs promised, I'll "
                 "send over the write-up of the delivery-window test we discussed.\n\nI'm excited about the role and "
                 "hope to speak again soon.\n\nBest,\n[Your name]"),
    },
}

# ── Practice: the AI interviewer's questions (a hiring-manager round for a product analyst) ─────────────────────
MOCK_QUESTIONS = [
    "Thanks for joining. To start, tell me about a time you used data to change a product decision.",
    "You said the short flow became the default. How did you make sure the result wasn't a novelty effect?",
    "Walk me through how you'd investigate a sudden drop in weekly bookings.",
    "Tell me about a time you disagreed with a stakeholder. What happened?",
]


def _mock_question(body: str) -> str:
    n = body.count("Interviewer:")
    q = MOCK_QUESTIONS[min(n, len(MOCK_QUESTIONS) - 1)]
    return json.dumps({"question": q, "is_follow_up": n == 1, "last_answer_score": 4 if n else None})


def respond(request_type: str, body: str) -> str | None:
    """The demo words for this request, or None for the mock's own."""
    if request_type == "resume_fix":
        return _resume_fix(body)
    if request_type == "resume_suggest":
        return _resume_suggest(body)
    if request_type == "resume_skills":
        return json.dumps({"skills": ["BigQuery", "Looker", "Statistics", "A/B testing", "dbt", "Tableau", "Forecasting"]})
    if request_type == "linkedin_fix_headline":
        return json.dumps(LI_HEADLINE)
    if request_type == "linkedin_fix_about":
        return json.dumps(LI_ABOUT)
    if request_type == "linkedin_fix_role":
        return json.dumps(LI_ROLE)
    if request_type == "offer_plan":
        return _offer_plan(body)
    if request_type == "follow_up":
        return json.dumps(FOLLOW_UP)
    if request_type == "mock_question" and "call_so_far" not in body:
        return _mock_question(body)
    return None


def demo_only(_: Any) -> None:  # keeps linters quiet about the module's purpose
    return None
