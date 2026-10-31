"""Deterministic offline LLM for development and tests. Clearly labelled — never presented as real."""

import asyncio
import json
import re
from collections.abc import AsyncIterator
from typing import Any

from orbit_api.live.routing import ReasoningLevel
from orbit_api.providers.llm.base import LLMChunk, LLMProvider, LLMRequest, Usage

_CODING = """ANSWER: [mock] Use a hash map to find each complement in one pass.
- Iterate once, storing value → index
- For each x, check whether target - x was seen
- Return both indices on the first hit
CODE: python
```python
def two_sum(nums: list[int], target: int) -> list[int]:
    seen: dict[int, int] = {}
    for i, x in enumerate(nums):
        if target - x in seen:
            return [seen[target - x], i]
        seen[x] = i
    return []
```
TIME: O(n)
SPACE: O(n)
INTUITION: [mock] I can find the pair in one pass by remembering the values I have already seen.
COMMENTARY: First I create a map from each value to its index. | \
For each number I check whether its complement is in the map. | \
When I find a match I return both indices; otherwise I store this number.
DEFENSE: Each number needs one constant-time map lookup, so the pass takes O(n) time and \
the map holds at most n entries, using O(n) extra space.
FOLLOWUP: How would you handle duplicate values?
POINTS: Hash map of complements | One pass | O(n) time and space
"""

_GENERAL = """ANSWER: [mock answer — set DEEPSEEK_API_KEY for real responses] {q}
- Lead with the direct answer in one sentence
- Support it with one concrete, verified example
- Close with the impact or trade-off
FOLLOWUP: Can you give a specific example?
POINTS: Direct answer first | One verified example | Impact or trade-off
"""


def _mock_report(user: str) -> str:
    """Canned report whose review scores every paired question (4 when answered) so tests exercise the
    server-side validation of the model's scorecard."""
    import json
    import re

    said = dict(re.findall(r"^Q(\d+):.*?\nCANDIDATE SAID: (.*?)\n", user, flags=re.MULTILINE | re.DOTALL))

    def rubric(n: str) -> dict[str, Any]:
        # One quote from the answer itself (kept), one the candidate never said (dropped by the server's check).
        own = " ".join(said.get(n, "").split()[:4])
        return {"structure": {"score": 4, "reason": "[mock] A clear order", "quote": own or None},
                "specifics": {"score": 2, "reason": "[mock] No numbers",
                              "quote": "I single-handedly saved the company"},
                "relevance": {"score": 5, "reason": "[mock] On the question", "quote": None},
                "clarity": {"score": 4, "reason": "[mock] Easy to follow", "quote": None},
                "conciseness": {"score": 3, "reason": "[mock] Some repetition", "quote": None}}

    items = [{"q": int(n), "feedback": f"[mock] feedback {n}", "score": 4,
              # A figure the candidate didn't give (37%) shows the server's placeholder check.
              "better": f"[mock] better {n}: I led [the project] and cut the time by 37%.",
              "improvement": f"[mock] Lead with the result in question {n}.", "rubric": rubric(n),
              "missing_points": ["[mock] Add the measurement baseline"], "delivery_score": 4, "clarity_score": 4,
              "dimensions": {"problem_framing": 4, "technical_depth": 4, "scalability": 3,
                             "edge_case_rigor": 3, "communication_clarity": 4}}
             for n in re.findall(r"^Q(\d+):", user, flags=re.MULTILINE)]
    return json.dumps({
        "summary": "[mock] Session summary.", "topics": [], "important_follow_ups": [],
        "potential_weak_areas": [], "suggested_preparation": [],
        "review": {"overall_score": 4, "strengths": ["[mock] clear structure"], "improvements": ["[mock] add metrics"],
                   "practice": ["[mock] rehearse STAR stories"], "items": items,
                   "top_practice": [{"practice": "[mock] Give one number for every result", "questions": [1, 2]},
                                    {"practice": "[mock] Open with the point, then the story", "questions": [1]},
                                    {"practice": "[mock] Cut the repeats", "questions": []}]},
        **({"counter_offer_email": {"subject": "[mock] Following up on the offer",
                                    "body": "[mock] Thank you for the offer. Could we look at the base again?"}}
           if 'source="negotiation_setup"' in user else {}),
    })


def _reference(body: str, source: str) -> list[dict[str, Any]]:
    m = re.search(rf'<reference_data source="{source}">\s*(\[.*?\])\s*</reference_data>', body, re.S)
    try:
        items = json.loads(m.group(1)) if m else []
    except json.JSONDecodeError:
        return []
    return [x for x in items if isinstance(x, dict) and "path" in x]


def _mock_resume_fix(body: str) -> str:
    """Every listed line rewritten to start with a verb, without "I"/"my" or filler, keeping its words; a question
    where it needs a number, and the candidate's fact written in where there is one. New bullets for listed roles."""
    facts = {f["path"]: f.get("fact", "") for f in _reference(body, "facts")}
    out, questions = [], []
    for line in _reference(body, "lines_to_fix"):
        words = [w for w in re.findall(r"[\w'%$.,+-]+", str(line.get("text", "")))
                 if w.lower() not in {"i", "my", "me", "responsible", "for", "helped", "successfully", "was", "were",
                                      "by", "team", "player", "hard", "working"}]
        rest = " ".join(words).strip(" .,").lower() or "the work"
        fact = facts.get(line["path"], "")
        after = f"Delivered {rest}" + (f", {fact}" if fact else "") + " for the people who relied on it"
        if line["path"] == "basics.summary":
            after = ("Support professional who runs customer queues, writes help content and trains new colleagues, "
                     "with a record of keeping customers answered and teams informed. Looking for a role that builds "
                     "on that work.")
        out.append({"path": line["path"], "after": after, "reason": "(mock) Fixed what was flagged."})
        if any("number" in str(p) for p in line.get("problems", [])) and not fact:
            questions.append({"path": line["path"], "question": "(mock) How many did you handle a week?"})
    for role in _reference(body, "roles")[:3]:
        job = str(role.get("role", "team")).split(" at ")[0].lower()
        out.append({"path": role["path"], "after": f"Maintained the {job} systems day to day for the people who "
                                                   "relied on them",
                    "reason": "(mock) A role needs at least two bullets."})
    return json.dumps({"suggestions": out, "questions": questions})


def _mock_resume_import(body: str) -> str:
    """Enough of a resume read to exercise the editor locally: the name, contact details and a role."""
    raw = [ln.strip() for ln in re.sub(r"</?reference_data[^>]*>", "", body).splitlines()]
    lines = [ln.strip(" -•*\t") for ln in raw if ln]
    bullets = [ln.strip(" -•*\t") for ln in raw if ln[:1] in {"-", "•", "*"}]
    email = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", body)
    phone = re.search(r"\+?\d[\d ()-]{7,}\d", body)
    return json.dumps({
        "basics": {"name": lines[0][:120] if lines else "", "headline": "", "email": email.group(0) if email else "",
                   "phone": phone.group(0) if phone else "", "location": "", "summary": "", "links": []},
        "experience": [{"title": "[mock] Role", "company": "[mock] Company", "location": "", "start": "Jan 2020",
                        "end": "", "current": True, "bullets": [ln[:300] for ln in bullets[:4]]}],
        "education": [], "skills": [{"name": "Skills", "items": ["[mock] Skill"]}], "projects": [],
        "certifications": []})


_LI_HEADINGS = ("Contact", "Top Skills", "Languages", "Certifications", "Honors-Awards", "Summary", "Experience",
                "Education", "Projects", "Featured", "Recommendations", "Activity")


def _mock_linkedin_read(body: str) -> str:
    """A LinkedIn "Save to PDF" text sorted the way the real read does, for the layout LinkedIn uses: the side column
    (Contact, Top Skills, Certifications), then name, headline and location, Summary, Experience, Education."""
    text = re.sub(r"</?reference_data[^>]*>", "", body)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not re.match(r"Page \d+ of \d+", ln.strip())]
    sections: dict[str, list[str]] = {}
    current = ""
    for ln in lines:
        if ln in _LI_HEADINGS:
            current = ln
            sections[current] = []
        elif current:
            sections[current].append(ln)
    side = [*sections.get("Certifications", [])] or [*sections.get("Top Skills", [])]
    head = side[-3:] if len(side) >= 3 else []
    name, headline, location = [*head, "", "", ""][:3]
    if sections.get("Certifications") and len(sections["Certifications"]) >= 3:
        sections["Certifications"] = sections["Certifications"][:-3]
    elif sections.get("Top Skills") and len(sections["Top Skills"]) >= 3:
        sections["Top Skills"] = sections["Top Skills"][:-3]
    roles, exp = [], sections.get("Experience", [])
    i = 0
    while i + 2 < len(exp):
        company, title, dates = exp[i], exp[i + 1], exp[i + 2]
        desc = []
        i += 3
        while i < len(exp) and not (i + 2 < len(exp) and re.search(r"\d{4} - ", exp[i + 2])):
            desc.append(exp[i])
            i += 1
        roles.append({"title": title, "company": company, "dates": dates, "current": "Present" in dates,
                      "description": " ".join(desc)})
    edu = sections.get("Education", [])
    url = next((ln.split(" ")[0] for ln in sections.get("Contact", []) if "linkedin.com/in/" in ln), "")
    # A profile copied from the page may also have these (the PDF never does).
    recs = next((int(m.group(1)) for ln in sections.get("Recommendations", [])
                 if (m := re.search(r"Received \((\d+)\)", ln))), None)
    activity = sections.get("Activity")
    return json.dumps({"name": name, "headline": headline, "location": location,
                       "about": " ".join(sections.get("Summary", [])), "url": url, "experience": roles,
                       "education": [{"school": edu[0], "degree": edu[1] if len(edu) > 1 else ""}] if edu else [],
                       "skills": sections.get("Top Skills", []), "certifications": sections.get("Certifications", []),
                       "projects": sections.get("Projects", []),
                       "featured": sections["Featured"] if "Featured" in sections else None,
                       "recommendations_received": recs,
                       "activity": None if activity is None else not any("haven't posted" in a for a in activity)})


def _ref_object(body: str, source: str) -> dict[str, Any]:
    m = re.search(rf'<reference_data source="{source}">\s*(\{{.*?\}})\s*</reference_data>', body, re.S)
    try:
        data = json.loads(m.group(1)) if m else {}
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _mock_linkedin_fix(request_type: str, body: str) -> str:
    """LinkedIn AI's fixes put together from the profile and/or resume in the prompt, plus one figure no source gives
    (in a role's bullets), so the server's grounding is exercised: it must come back as a placeholder."""
    profile, resume = _ref_object(body, "linkedin_profile"), _ref_object(body, "resume")
    roles = [r for r in profile.get("experience") or [] if isinstance(r, dict)] or [
        {"title": r.get("title", ""), "company": r.get("company", ""), "description": " ".join(r.get("bullets") or [])}
        for r in resume.get("experience") or [] if isinstance(r, dict)]
    target = (m.group(1).strip() if (m := re.search(r"^Target role: (.+)$", body, re.M)) else "") or (
        roles[0].get("title") if roles else "") or "Professional"
    if target.startswith("the one their"):
        target = roles[0].get("title") if roles else "Professional"
    backed = [s.strip() for s in m.group(1).split(",")] if (
        m := re.search(r"that they have \(use them where they fit\): (.+)$", body, re.M)) else []
    skills = backed or [s for s in (profile.get("skills") or resume.get("skills") or []) if isinstance(s, str)]
    first = roles[0] if roles else {}

    def sentences(text: str) -> list[str]:
        return [s.strip().rstrip(".") for s in re.split(r"(?<=[.!?])\s+", text or "") if len(s.strip()) > 12]

    work = sentences(" ".join(str(r.get("description") or "") for r in roles))
    if request_type == "linkedin_fix_headline":
        result = next((s for s in work if re.search(r"\d", s)), work[0] if work else "my recent work")
        return json.dumps({"options": [
            {"style": "search", "text": " | ".join(x for x in (target, ", ".join(skills[:4])) if x)},
            {"style": "result", "text": f"{target} | {result[:120]}"},
            {"style": "focus", "text": f"{target} | (mock) {first.get('title') or target} work at "
                                       f"{first.get('company') or 'my company'}"}]})
    if request_type == "linkedin_fix_about":
        lead = work[0] if work else f"I work as a {target.lower()}"
        return json.dumps({"opening": f"(mock) {target} with {', '.join(skills[:3]) or 'a solid record'}. {lead}.",
                           "rest": "\n\n".join([
                               " ".join(f"{s}." for s in work[1:4]) or "(mock) More about the work on my roles.",
                               f"(mock) The tools I use most: {', '.join(skills[:6]) or 'the ones on my profile'}.",
                               f"(mock) I'm open to {target} roles. Message me here."])})
    if request_type == "linkedin_fix_role":
        named = re.search(r"rewrite the description of this role: (.+?)(?: \(|\.$)", body, re.M)
        role = next((r for r in roles if named and f"{r.get('title')} at {r.get('company')}" == named.group(1)),
                    first)
        own = sentences(str(role.get("description") or "")) or [f"Worked as {role.get('title') or target}"]
        return json.dumps({"bullets": [*(f"{s}." for s in own[:3]),
                                       "(mock) Cut the team's review time by 35% with a clearer checklist.",
                                       "(mock) Grew usage of the tools the role owned to [N users]."]})
    if request_type == "linkedin_fix_featured":
        titles = [str(x) for x in (profile.get("projects") or [])] + [
            str(p.get("name")) for p in resume.get("projects") or [] if isinstance(p, dict) and p.get("name")]
        certs = [str(x) for x in (profile.get("certifications") or resume.get("certifications") or [])]
        ideas = [{"title": t[:60], "what": "(mock) A link or slides showing it, with one line on the result."}
                 for t in titles[:3]] + [{"title": c[:60], "what": "(mock) The certificate itself."} for c in certs[:1]]
        return json.dumps({"ideas": ideas or [{"title": f"{first.get('title') or target} work",
                                               "what": "(mock) A post about your best result there."}]})
    subject = re.search(r"about their work as (.+?)\.$", body, re.M)
    about = subject.group(1) if subject else target
    there = next((r for r in roles if f"{r.get('title')} at {r.get('company')}" == about), first)
    own = sentences(str(there.get("description") or "")) or ["the work we did together"]
    return json.dumps({"body": f"(mock) Would you write me a short recommendation about my work as {about}? We "
                               "worked on this together for a good while.\n\n(mock) You could mention this: "
                               f"{own[0]}. If you're busy, no worries at all, and thank you either way."})


def _resume_ref(body: str) -> dict[str, Any]:
    m = re.search(r'<reference_data source="resume">\s*(\{.*?\})\s*</reference_data>', body, re.S)
    try:
        data = json.loads(m.group(1)) if m else {}
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _mock_prep_questions(body: str) -> str:
    """Two questions per role (one behavioural, its outline the role's own words) and one per project, plus one from the
    job post when there is one: grounded, so they come back as written."""
    resume = _resume_ref(body)
    out: list[dict[str, Any]] = []
    for role in resume.get("roles", []):
        bullets = [str(b) for b in role.get("bullets", [])] or [str(role.get("title") or "the work")]
        out += [{"group": role["id"], "type": "behavioral",
                 "question": f"(mock) Walk me through your work at {role.get('company') or 'that job'}.",
                 "outline": [f"Situation: {role.get('title', '')} at {role.get('company', '')}",
                             f"Action: {bullets[0]}"],
                 "missing": [], "defend": "(mock) Be ready to say what was yours alone.", "example": "(mock) Example"},
                {"group": role["id"], "type": "technical", "question": f"(mock) How did this work: {bullets[-1]}?",
                 "outline": [bullets[-1]], "missing": [], "defend": "", "example": ""}]
    out += [{"group": p["id"], "type": "technical", "question": f"(mock) Why did you build {p.get('name')} this way?",
             "outline": [str(p.get("description") or p.get("name"))], "missing": [], "defend": "", "example": ""}
            for p in resume.get("projects", [])]
    if 'source="job_post"' in body:
        out.append({"group": "job", "type": "role", "question": "(mock) What in this job post fits your experience?",
                    "outline": [], "missing": ["Add the part of the job you've done before"], "defend": "",
                    "example": ""})
    return json.dumps({"role": "(mock) Role", "questions": out})


def _mock_skill_gap(body: str) -> str:
    """Every missing keyword to prepare for, the first one not to claim."""
    m = re.search(r'<reference_data source="missing">\s*(\[.*?\])\s*</reference_data>', body, re.S)
    missing = json.loads(m.group(1)) if m else []
    return json.dumps({"gaps": [
        {"skill": kw, "verdict": "dont_claim" if i == 0 else "prepare", "evidence": "", "say": "",
         "prepare": f"(mock) Read up on {kw}.", "note": "(mock) Say you haven't used it yet."}
        for i, kw in enumerate(missing)]})

def _mock_resume_kit(request_type: str, body: str) -> str:
    """A Naukri or LinkedIn profile, or a message, put together from the resume in the prompt (nothing added), so
    the server's checks pass and the editor has something real-looking to show."""
    m = re.search(r'<reference_data source="resume">\s*(\{.*?\})\s*</reference_data>', body, re.S)
    try:
        resume = json.loads(m.group(1)) if m else {}
    except json.JSONDecodeError:
        resume = {}
    roles = resume.get("experience") or [{}]
    title = roles[0].get("title") or "Professional"
    skills = [s for s in resume.get("skills") or [] if isinstance(s, str)]
    bullets = [b for r in roles for b in r.get("bullets") or []][:3]
    work = " ".join(b.rstrip(".") + "." for b in bullets) or "Work across the roles on the resume."
    if request_type == "resume_shorten":
        filler = {"the", "a", "an", "successfully", "various", "very", "really", "that"}
        return json.dumps({"suggestions": [
            {"path": line["path"], "after": " ".join(w for w in str(line.get("text", "")).split()
                                                     if w.lower() not in filler),
             "reason": "(mock) Dropped the filler words."} for line in _reference(body, "lines_to_shorten")]})
    if request_type == "resume_naukri":
        return json.dumps({"headline": " | ".join([title, ", ".join(skills[:3]), "(mock) profile"]),
                           "summary": f"(mock) {title} with this work behind me. {work}",
                           "skills": list(reversed(skills))})
    if request_type == "resume_linkedin":
        return json.dumps({"headline": " | ".join([title, ", ".join(skills[:3])]),
                           "about": f"(mock) What I do as a {title.lower()}. {work}\n\n(mock) What I want next: more "
                                    "of the same work, with a team that relies on it.",
                           "skills": skills[:5]})
    # The role and company it's for, and the job's requirements the resume shows, when the prompt gives them.
    found = re.search(r'<reference_data source="candidate_inputs">\s*(\{.*?\})\s*</reference_data>', body, re.S)
    inputs = json.loads(found.group(1)) if found else {}
    found = re.search(r'<reference_data source="job_requirements">\s*(\{.*?\})\s*</reference_data>', body, re.S)
    shown = [str(s) for s in (json.loads(found.group(1)) if found else {}).get("resume_shows", [])][:3]
    role, company = inputs.get("role"), inputs.get("company")
    role = (f"the {role} role" if role else "a role" if company else "the role on your team") + (
        f" at {company}" if company else "")
    fit = f" (mock) My resume shows {', '.join(shown)}, which the job asks for." if shown else ""
    if "(kind: screening)" in body:
        return json.dumps({"subject": "", "connection_note": "", "body": "\n\n".join([
            f"Why do you want to work at {company or 'your company'}?\n(mock) The work in {role} is what I do. {work}",
            f"Describe a relevant project or system you built or scaled.\n(mock) {work}",
            f"Why are you a good fit for this role?\n(mock) As a {title.lower()} I've done this work.{fit} {work}"])})
    return json.dumps({"subject": "(mock) About the role", "connection_note": f"Hi, (mock) I'd like to connect about "
                                                                              f"{role}.",
                       "body": f"(mock) I'm reaching out about {role}. {work}{fit}\n\n(mock) Could we talk about it "
                               "this week?"})


def _mock_jobs(request_type: str, body: str) -> str:
    """Jobs (job_portal/): a search profile from the resume's own titles, skills and city; a fit check that cites
    the resume's first role and the post's first missing skill."""
    resume = _resume_ref(body)
    roles =[e for e in resume.get("experience", []) if isinstance(e, dict)]
    if request_type == "job_profile":
        years = re.search(r"about ([\d.]+) years", body)
        n = float(years.group(1)) if years else 0.0
        titles = [*[str(e.get("title") or "") for e in roles if e.get("title")][:3], "Software Engineer"]
        return json.dumps({"titles": titles, "skills": [str(s) for s in resume.get("skills", [])][:12],
                           "seniority": "fresher" if n < 1 else "junior" if n < 3 else "mid" if n < 6 else "senior",
                           "locations": [resume.get("location") or ""]})
    missing = re.search(r"Not found in the resume: ([^.\n]*)", body)
    gap = (missing.group(1).split(",")[0].strip() if missing else "") or "a skill the post lists"
    role = " at ".join(x for x in (str(roles[0].get("title") or ""), str(roles[0].get("company") or "")) if x) \
        if roles else "your last role"
    return json.dumps({"verdict": "Good", "summary": "(mock) You match a good part of this job.",
                       "why": [f"(mock) Your work as {role} matches what this job asks for."],
                       "gaps": [f"(mock) The post asks for {gap}, which your resume doesn't show."],
                       "tweaks": [{"change": "(mock) Put your most relevant role first.",
                                   "why": "(mock) Recruiters read the top first."}],
                       "requirements": [
                           *({"requirement": shown, "status": "met", "job_quote": shown, "resume_quote": shown}
                             for shown in (_shown(body)[:2])),
                           {"requirement": gap, "status": "missing", "job_quote": gap, "resume_quote": ""}]})


def _mock_business(request_type: str, body: str) -> str:
    """Orbit for Business (business_ai/): a job draft that only restates the brief, an empty resume structure (the
    deterministic parse stands), and a ranking that quotes the profile line sharing a word with each requirement."""
    m = re.search(r"<reference_data[^>]*>\s*(.*?)\s*</reference_data>", body, re.S)
    ref = m.group(1) if m else ""
    if request_type == "business_fill":
        from orbit_api.business_ai.job_fill import mock_answer  # the assistant's own reading, laid out (D85)

        return mock_answer(body)
    if request_type == "business_jd":
        try:
            brief = json.loads(ref)
        except ValueError:
            brief = {}
        title = str(brief.get("title") or "this role")
        must = [str(x) for x in brief.get("must_haves") or []]
        nice = [str(x) for x in brief.get("nice_to_haves") or []]
        filler = ("(mock) This sentence stands in for the description the AI writes from your brief, using only "
                  "what the brief says. ")
        md = "\n\n".join([f"## About the role\n(mock) We're hiring a {title}. " + filler * 6,
                          "## What you'll do\n" + filler * 6,
                          "## What you need\n" + "\n".join(f"- {x}" for x in must),
                          "## Nice to have\n" + "\n".join(f"- {x}" for x in nice),
                          "## About us\n" + (str(brief.get("about_company") or "") or filler) + " " + filler * 5])
        return json.dumps({"title": title, "summary": f"(mock) A {title} role.", "responsibilities": [filler.strip()],
                           "must_haves": must, "nice_to_haves": nice, "description_markdown": md,
                           "suggested_screening_questions": [{"text": f"Do you have: {x}?", "kind": "yes_no",
                                                              "choices": None} for x in must[:4]]})
    if request_type == "business_rank":
        lines = [x.strip() for x in ref.split("\n") if x.strip()]
        matches = []
        for rid, req in re.findall(r"^([MN]\d+): (.+)$", body, re.M):
            words = set(re.findall(r"[a-z]{4,}", req.lower())) - {"years", "with", "experience", "strong"}
            line = next((x for x in lines if words & set(re.findall(r"[a-z]{4,}", x.lower()))), None)
            matches.append({"id": rid, "met": "yes" if line else "no", "evidence": line})
        return json.dumps({"matches": matches, "summary": "(mock) Compared with the requirements.", "cautions": []})
    return json.dumps({"headline": None, "location": None, "experience": [], "education": [], "skills": []})


def _shown(body: str) -> list[str]:
    found = re.search(r"Skills the post asks for that the resume shows: ([^.\n]*)", body)
    return [s.strip() for s in found.group(1).split(",") if s.strip() and s.strip() != "none found"] if found else []


class MockLLMProvider(LLMProvider):
    name = "mock"

    def __init__(self, *, chunk_delay_s: float = 0.0, script: list[str] | None = None) -> None:
        self._delay = chunk_delay_s
        self._script = script  # queued exact responses for tests
        self.requests: list[LLMRequest] = []

    def model_for(self, reasoning: ReasoningLevel) -> str:
        return "mock"

    def supports_vision(self) -> bool:
        return True

    def _response_for(self, request: LLMRequest) -> str:
        if self._script:
            return self._script.pop(0)
        if request.request_type == "personal_form_agent":
            body = request.messages[-1].content
            data = json.loads(body[body.find("{"):body.rfind("}") + 1])
            return json.dumps({"matches": [{"question_id": q["id"], "source": q["candidates"][0], "confidence": 0.99}
                for q in data["questions"] if len(q["candidates"]) == 1]})
        if request.request_type == "career_contact_extraction":
            body = request.messages[-1].content
            data = json.loads(body[body.find("{"):body.rfind("}") + 1])
            people = []
            for source in data["sources"]:
                match = re.search(r"From:\s*([^<>\n]+)\s*<([^<>\n]+)>\s*\nTitle:\s*([^\n]+)", source["text"])
                if match:
                    people.append({"source_id": source["id"], "name": match[1].strip(), "email": match[2],
                        "title": match[3].strip(), "linkedin_url": None, "quote": match[0]})
            return json.dumps({"people": people[:3]})
        if request.request_type == "career_contact_draft":
            return json.dumps({"subject": "[mock] A question about the role", "message":
                "[mock] Hello, I'm interested in the role at your company. "
                "Could you point me to the appropriate hiring contact?"})
        if request.request_type == "career_launchpad":
            body = request.messages[-1].content
            data = json.loads(body[body.find("{"):body.rfind("}") + 1])
            fact = data["facts"][0]
            return json.dumps({"roles": [{"title": data.get("target") or "Graduate trainee",
                "fact_id": fact["id"], "source_quote": fact["text"],
                "reason": "[mock] This resume evidence is a starting point for exploring the role.",
                "experiment": "[mock] Build one small example using this skill and document how it works.",
                "check": "[mock] Explain your decisions and demonstrate the example to a peer."}]})
        if request.request_type == "transition_review":
            body = request.messages[-1].content
            data = json.loads(body[body.find("{"):body.rfind("}") + 1])
            rows = data.get("requirements", [])
            suggestions = [{"requirement_id": row["id"], "source_quote": row["requirement"][:600],
                "gap": "[mock] Clarify the supporting example and distinguish practice from employment.",
                "next_action": "[mock] Record one reproducible example and its actual result for review."}
                for row in rows[:5] if len(row["requirement"]) >= 8]
            return json.dumps({"summary": "[mock] Review your supporting evidence and choose one concrete next action.",
                               "suggestions": suggestions})
        if request.request_type == "employer_message":
            from orbit_api.job_portal.message_updates import classify
            body = request.messages[-1].content
            data = json.loads(body[body.find("{"):body.rfind("}") + 1])
            return classify(data["message"]).model_dump_json()
        if request.request_type == "business_knowledge_answer":
            body = request.messages[-1].content
            data = json.loads(body[body.find("{"):body.rfind("}") + 1])
            return json.dumps({"status": "answered", "points": [{"passage_id": p["id"],
                "quote": p["text"][:300], "text": "[mock] Review this source passage before applying the policy."}
                for p in data["passages"][:3]]})
        if request.request_type == "business_workflow_draft":
            body = request.messages[-1].content
            data = json.loads(body[body.find("{") : body.rfind("}") + 1])
            source = data["facts"][0]
            return json.dumps(
                {
                    "plan": {
                        "title": "[mock] Role readiness playbook",
                        "steps": [
                            {
                                "id": "brief",
                                "title": "Review the role brief",
                                "instruction": "[mock] Review the saved role requirements with the team.",
                                "days": 0,
                                "depends_on": [],
                                "workspace": "pipeline",
                            },
                            {
                                "id": "criteria",
                                "title": "Prepare consistent criteria",
                                "instruction": "[mock] Agree job-related interview evidence and questions.",
                                "days": 1,
                                "depends_on": ["brief"],
                                "workspace": "interview-plan",
                            },
                            {
                                "id": "review",
                                "title": "Review team readiness",
                                "instruction": "[mock] Review ownership and decide the next preparation step.",
                                "days": 2,
                                "depends_on": ["criteria"],
                                "workspace": "hiring-desk",
                            },
                        ],
                    },
                    "sources": [
                        {"step_id": key, "fact_id": source["id"], "quote": source["text"]}
                        for key in ("brief", "criteria", "review")
                    ],
                }
            )
        if request.request_type in ("career_weekly_coach", "business_ops_brief", "application_second_reader",
                                   "career_next_step_plan", "opportunity_coach", "business_requisition_review",
                                   "business_knowledge_review", "business_knowledge_reading",
                                   "business_capacity_brief", "business_import_review",
                                   "business_experience_brief", "business_workflow_brief"):
            body = request.messages[-1].content
            data = json.loads(body[body.find("{"):body.rfind("}") + 1])
            return json.dumps({"tips": [{"fact_id": f["id"], "source_quote": f["text"][:300],
                "suggestion": "[mock] Review this saved signal and choose one manageable improvement.",
                "success_check": "[mock] Revisit the same metric after updating the original records."}
                for f in data["facts"][:3]]})
        if request.request_type in ("career_action_brief", "business_plan_assist"):
            body = request.messages[-1].content
            data = json.loads(body[body.find("{"):body.rfind("}") + 1])
            if request.request_type == "career_action_brief":
                return json.dumps({"steps": [{"action_id": a["id"], "source_quote": a["detail"],
                    "suggestion": "[mock] Open the linked workspace and review this saved next step."}
                    for a in data["actions"][:3]]})
            plan = data["current_plan"]
            for criterion in plan["criteria"]:
                criterion["question"] = "[mock] " + criterion["question"][:790]
            return json.dumps({"plan": plan, "sources": [{"criterion_id": c["id"],
                "requirement_quote": next((s for s in data["requirements"] if s in c["name"]), data["title"])}
                for c in plan["criteria"]]})
        if request.request_type in ("job_profile", "job_fit"):
            return _mock_jobs(request.request_type, request.messages[-1].content if request.messages else "")
        if request.request_type == "summary":
            return _mock_report(request.messages[-1].content if request.messages else "")
        if request.request_type == "prep":
            body = request.messages[-1].content if request.messages else ""
            m = re.search(r"Number of questions: (\d+)", body)
            n = int(m.group(1)) if m else 8
            cats = ["behavioral", "technical", "role", "motivation", "curveball"]
            return json.dumps({"role": "[mock] Role", "company": None, "questions": [
                {"question": f"[mock] Prep question {i + 1}?", "category": cats[i % len(cats)],
                 "why": "[mock] The job description asks for this.",
                 "talking_points": ["[mock] point A", "[mock] point B"],
                 "suggested_answer": f"[mock] In my last role I [name the project] — answer {i + 1}."}
                for i in range(n)], "ask_them": [
                {"question": f"[mock] What would success look like in the first 90 days? ({i + 1})",
                 "why": "[mock] Shows you're thinking about delivering, not just landing the job."}
                for i in range(4)]})
        if request.request_type == "pitch":
            return json.dumps({
                "short": "[mock] I'm a backend engineer building Python services. Most recently I built payment "
                         "services handling 7 million requests, and I want to bring that to your platform team.",
                "standard": "[mock] I'm a backend engineer. " * 12, "long": "[mock] I'm a backend engineer. " * 18,
                "hooks": ["[mock] Python services at PayNest", "[mock] REST APIs for partner banks"]})
        if request.request_type == "reference_brief":
            body = request.messages[-1].content
            section = body.split("References, with", 1)[-1].split("Candidate's resume", 1)[0]
            names = re.findall(r"^- (.+?) \(", section, flags=re.M)
            return json.dumps({"references": [
                {"name": name,
                 "ask": f"[mock] Hi {name}, I'm interviewing for a role and would love you as a reference.",
                 "brief": ["[mock] The payments project you saw me lead", "[mock] [a result you both remember]"]}
                for name in names], "tips": ["[mock] Thank them after the call."]})
        if request.request_type == "first_ninety":
            return json.dumps({"phases": [
                {"name": name, "goals": [f"[mock] {name}: learn how the team ships", "[mock] Meet the people below"]}
                for name in ("First two weeks", "By day 30", "By day 60", "By day 90")],
                "people": ["[mock] your manager", "[mock] the on-call lead"],
                "questions": ["[mock] What does a great first quarter look like?"],
                "early_win": "[mock] Improve one slow API, drawing on your PostgreSQL work."})
        if request.request_type == "written_review":
            body = request.messages[-1].content
            answer = body.split("Candidate's answer:", 1)[-1].split("</reference_data>")[0].strip()
            words = answer.split()
            return json.dumps({"scores": {"content": 3, "organisation": 4, "language": 3, "tone": 4},
                "summary": "[mock] Clear purpose; answer every point in the brief.",
                "covered": ["[mock] the reason for writing"], "missed": ["[mock] a date to reply by"],
                "fixes": [{"quote": " ".join(words[:4]), "issue": "[mock] Too informal.", "better": "[mock] Dear Sir"},
                          {"quote": "words the candidate never wrote", "issue": "[mock] x", "better": "[mock] y"}],
                "strengths": ["[mock] Polite sign-off."]})
        if request.request_type == "guesstimate_review":
            body = request.messages[-1].content
            part = body.split("Assumptions:", 1)[-1].split("Calculation:")[0].strip()
            return json.dumps({"scores": {"clarify": 3, "structure": 4, "assumptions": 3, "math": 5, "sanity": 2},
                "summary": "[mock] Good structure; justify the share of tea drinkers.",
                "assumptions": [{"quote": " ".join(part.split()[:4]), "verdict": "needs a reason",
                                 "note": "[mock] Say why."},
                                {"quote": "an assumption nobody wrote", "verdict": "too high", "note": "[mock] x"}],
                "math_ok": True, "math_note": "[mock] The multiplication adds up.",
                "missed": ["[mock] weekday vs weekend demand"],
                "follow_ups": ["[mock] How would this change in winter?"]})
        if request.request_type == "first_look":
            return json.dumps({"impression": "[mock] Reads as a backend engineer; the job's main platform skill isn't "
                               "visible until the second role.",
                               "headline": "[mock] Backend Engineer · Python, Go",
                               "summary": "[mock] I build backend services in Python and Go, with 99 [what you led]."})
        if request.request_type == "interview_debrief":
            return json.dumps({"questions": [
                {"question": "[mock] Tell me about a time you handled a production incident.", "kind": "behavioral",
                 "went": "okay"},
                {"question": "[mock] How would you design a rate limiter?", "kind": "technical", "went": "weak"}],
                "promises": ["[mock] Send the link to the project you mentioned."],
                "focus": ["[mock] Practise one system design question end to end."],
                "thank_you_points": ["[mock] The discussion about the team's on-call rotation."],
                "stories": [{"title": "[mock] Handled a checkout outage",
                             "situation": "[mock] Checkout failed at peak.",
                             "task": "[mock] I was on call.", "action": "[mock] I rolled back and [what you did next].",
                             "result": "[mock] Service recovered in [how long].", "competencies": ["ownership"]}]})
        if request.request_type == "story_draft":
            body = request.messages[-1].content if request.messages else ""
            m = re.search(r"Number of stories: (\d+)", body)
            comps = ["leadership", "conflict", "failure", "impact", "teamwork", "ambiguity"]
            return json.dumps({"stories": [
                {"title": f"[mock] Story {i + 1}", "situation": "[mock] The team was behind on a launch.",
                 "task": "[mock] I owned the release.", "action": "[mock] I re-planned the work and [what you did].",
                 "result": "[mock] We shipped on time [with a number].", "competencies": [comps[i % len(comps)]]}
                for i in range(int(m.group(1)) if m else 1)]})
        if request.request_type == "evidence_suggest":
            # Grounded like the real thing should be: each quote is a sentence of the source, word for word.
            body = request.messages[-1].content if request.messages else ""
            m = re.search(r"<reference_data[^>]*>\s*(.*?)\s*</reference_data>", body, re.S)
            sentences = [x.strip() for x in re.split(r"(?<=[.!?])\s+", m.group(1) if m else "") if len(x.strip()) > 20]
            return json.dumps({"items": [{"claim": f"[mock] {q[:80]}", "quote": q} for q in sentences[:3]]
                               + [{"claim": "[mock] Invented claim", "quote": "words that are not in the source"}]})
        if request.request_type.startswith("business_"):
            return _mock_business(request.request_type, request.messages[-1].content if request.messages else "")
        if request.request_type == "resume_import":
            return _mock_resume_import(request.messages[-1].content if request.messages else "")
        if request.request_type in ("resume_suggest", "apply_tailor"):  # Orbit Apply tailors with the same prompt
            body = request.messages[-1].content if request.messages else ""
            m = re.search(r'<reference_data source="resume_fields">\s*(\[.*?\])\s*</reference_data>', body, re.S)
            try:
                fields = json.loads(m.group(1)) if m else []
            except json.JSONDecodeError:
                fields = []
            roles_match = re.search(r'<reference_data source="roles">\s*(\[.*?\])\s*</reference_data>', body, re.S)
            try:
                roles = json.loads(roles_match.group(1)) if roles_match else []
            except json.JSONDecodeError:
                roles = []
            # Finished text with no [brackets], like the real prompt asks for (a bracket would be dropped as a
            # placeholder), so "(mock)" marks it instead.
            added = [{"path": r["path"], "after": f"Maintained the {r['role'].split(' at ')[0].lower()} systems "
                                                  "day to day for the teams that relied on them",
                      "reason": "(mock) A role needs at least two bullets."}
                     for r in roles if isinstance(r, dict) and "path" in r][:2]
            return json.dumps({"suggestions": added + [
                {"path": f["path"], "after": f"(mock) Improved: {f['text'] or 'A summary of your strengths'}"[:300],
                 "reason": "(mock) Clearer and more specific."}
                for f in fields if isinstance(f, dict) and "path" in f][:3]})
        if request.request_type == "resume_fix":
            return _mock_resume_fix(request.messages[-1].content if request.messages else "")
        if request.request_type in ("resume_naukri", "resume_linkedin", "resume_outreach", "resume_shorten"):
            return _mock_resume_kit(request.request_type, request.messages[-1].content if request.messages else "")
        if request.request_type == "resume_skills":
            return json.dumps({"skills": ["Git", "Agile", "Jira", "Linux", "Code review", "Testing", "Communication"]})
        if request.request_type == "apply_cover_letter":  # Orbit Apply's: finished text, no placeholders
            body = request.messages[-1].content if request.messages else ""
            m = re.search(r'"name": "([^"]*)"', body)
            return ("Dear Hiring Manager,\n\nI'm applying for the role in your job post. My work building and "
                    "running backend services is close to what you describe, and I'd bring the same care to your "
                    "team.\n\nIn my current role I build the services and APIs other teams rely on, and I own them "
                    "in production.\n\nI'd welcome the chance to talk.\n\nSincerely,\n"
                    + ((m.group(1) if m else "") or "Me"))
        if request.request_type == "apply_why":
            return ("The role is the kind of backend work I already do every day: building services and APIs that "
                    "other teams depend on and keeping them reliable in production. The post describes that work "
                    "closely, and I'd like to do it on this team.")
        if request.request_type == "cover_letter":
            body = request.messages[-1].content if request.messages else ""
            m = re.search(r'"name": "([^"]*)"', body)
            name = (m.group(1) if m else "") or "[Your name]"
            return ("Dear Hiring Manager,\n\n[mock] I'm applying for the role in your job post. My experience "
                    "building reliable backend systems matches what you describe.\n\n[mock] In my last role I "
                    "cut release time by [a number you can cite], and I led the work end to end.\n\n[mock] What "
                    "draws me to this team is the scale of the problem. I'd welcome the chance to talk.\n\n"
                    f"Sincerely,\n{name}")
        if request.request_type == "resume_prep_questions":
            return _mock_prep_questions(request.messages[-1].content if request.messages else "")
        if request.request_type == "resume_skill_gap":
            return _mock_skill_gap(request.messages[-1].content if request.messages else "")
        if request.request_type == "code_review":
            body = request.messages[-1].content if request.messages else ""
            all_pass = re.search(r"Tests: (\d+) of (\d+) passed", body)
            ok = bool(all_pass and all_pass.group(1) == all_pass.group(2))
            return json.dumps({
                "verdict": "solved" if ok else "partly", "summary": "[mock] A reasonable start.",
                "scores": {"problem_solving": 4, "code_quality": 3, "complexity": 3, "communication": 2},
                "complexity": "O(n) time, O(n) space", "strengths": ["[mock] Clear names"],
                "fixes": ["[mock] Handle the empty input", "```js\nreturn x;\n```", "return nums[0];"],
                "edge_cases": ["[mock] An empty list"], "follow_up": "[mock] What if the input doesn't fit in memory?"})
        if request.request_type == "linkedin_read":
            return _mock_linkedin_read(request.messages[-1].content if request.messages else "")
        if request.request_type.startswith("linkedin_fix_"):
            return _mock_linkedin_fix(request.request_type, request.messages[-1].content if request.messages else "")
        if request.request_type == "offer_plan":
            return json.dumps({
                "ask": 0, "ask_why": "[mock] Anchored on the top of the market range for this role.",
                "reasons": ["[mock] The resume shows the core skills the role asks for."],
                "call_script": ["[mock] Thank you, I'm excited about the role.",
                                "[mock] Based on the market for this role, I was hoping for a higher fixed pay.",
                                "[mock] If the fixed pay can't move, could we look at the joining bonus?"],
                "email": {"subject": "[mock] Re: your offer",
                          "body": "Hi [Recruiter name],\n\n[mock] Thank you for the offer.\n\n[Your name]"},
                "questions": ["[mock] How is the variable pay decided?"], "watch_outs": []})
        if request.request_type == "follow_up":
            return json.dumps({
                "debrief": {"went_well": ["[mock] clear example"], "to_improve": ["[mock] add a metric"],
                            "promised": ["[mock] send the portfolio link"], "next_steps": []},
                "thank_you": {"subject": "[mock] Thank you",
                              "body": "Hi [Interviewer name],\n\n[mock] Thanks for the conversation.\n\n[Your name]"},
            })
        if request.request_type == "mock_question" and "call_so_far" in (request.messages[-1].content
                                                                           if request.messages else ""):
            body = request.messages[-1].content
            n = body.count("Recruiter:") + 1
            return json.dumps({"question": f"[mock] Recruiter turn {n}: what number did you have in mind?",
                               "is_follow_up": n > 1, "done": "set done to true" in body})
        if request.request_type == "debrief_retry":
            # Test provider only; production configuration rejects mock providers.
            return json.dumps({"score": 4, "clarity_score": 4, "feedback": "[mock] Clear reasoning; add evidence.",
                "ideal_answer": "[mock] I would state assumptions, explain my approach and test failure cases.",
                "missing_points": ["[mock] Name a failure case"], "dimensions": {"problem_framing": 4,
                "technical_depth": 4, "scalability": 3, "edge_case_rigor": 3, "communication_clarity": 4}})
        if request.request_type == "spoken_walkthrough":
            return json.dumps({"intuition": "[mock] Use a hash map to find an earlier complement in constant time.",
                "commentary": ["[mock] Create the map to remember each earlier value and its index.",
                    "[mock] Check the complement before insertion so a value cannot pair with itself.",
                    "[mock] Store the current index so later values can find it."],
                "complexity_defense": "[mock] Each value is visited once, so time and auxiliary space are O(n)."})
        if request.request_type == "defense_critique":
            return json.dumps({"spofs": ["[mock] Verify that the database has failover."],
                "bottlenecks": ["[mock] Measure database write throughput before adding application replicas."],
                "trade_offs": ["[mock] Explain the consistency and availability trade-off."],
                "follow_ups": [{"question": "[mock] What happens when the database fails?",
                    "answer": "[mock] Fail over to a replica and retry idempotent operations."},
                    {"question": "[mock] How do you handle traffic spikes?",
                     "answer": "[mock] Use bounded queues and backpressure."},
                    {"question": "[mock] How do you detect lost events?",
                     "answer": "[mock] Track offsets and reconcile with the durable source."}]})
        if request.request_type == "mock_question":
            body = request.messages[-1].content if request.messages else ""
            system = request.messages[0].content if request.messages else ""
            # The video interviewer's own requests (D76): the candidate's question at the end, a question put
            # another way.
            if 'source="their_question"' in body:
                return json.dumps({"answer": "[mock] Good question. I don't have the details on that, so the "
                                             "recruiter is the best person to ask."})
            if system.startswith("Rephrase this interview question"):
                return json.dumps({"question": "[mock] In simpler words: what did you build, and how did it go?"})
            n = body.count("Interviewer:") + 1
            follow = "follow-up on the last answer" in body and n > 1 and n % 2 == 0
            out: dict[str, Any] = {"question": f"[mock] Question {n}: tell me about a project you're proud of.",
                                   "is_follow_up": follow, "last_answer_score": 4 if n > 1 else None}
            if '"reaction"' in system:
                said = body.rsplit("Candidate:", 1)[-1].split("</reference_data>", 1)[0].split()
                out["reaction"] = "[mock] So " + " ".join(said[:5]).strip(".,") + "."
            return json.dumps(out)
        if request.request_type == "classify":
            # Deterministic stand-in for the ambiguous-question classifier: statements about prices/values are
            # not questions; anything else in the band is answered as-is.
            body = request.messages[-1].content if request.messages else ""
            utterance = body.split('source="utterance">', 1)[-1].split("</reference_data>", 1)[0].strip()
            statement = any(w in utterance.lower() for w in ("price", "we value", "our culture"))
            return json.dumps({"kind": "non_question" if statement else "question", "should_answer": not statement,
                               "normalized_question": "" if statement else utterance})
        user = request.messages[-1].content if request.messages else ""
        q = ""
        for line in user.splitlines():
            if line.startswith("QUESTION:"):
                q = line.removeprefix("QUESTION:").strip()
        low = user.lower()
        if request.images or any(k in low for k in ("two sum", "write a function", "implement")):
            return _CODING
        return _GENERAL.format(q=q or "Here is a structured answer.")

    async def stream(self, request: LLMRequest) -> AsyncIterator[LLMChunk]:
        self.requests.append(request)
        text = self._response_for(request)
        words = text.split(" ")
        for i, w in enumerate(words):
            if self._delay:
                await asyncio.sleep(self._delay)
            yield LLMChunk(delta=w if i == 0 else " " + w)
        yield LLMChunk(usage=Usage(sum(len(m.content) for m in request.messages) // 4, len(text) // 4))
