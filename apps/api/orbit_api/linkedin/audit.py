"""The LinkedIn audit: section by section, what a recruiter searching LinkedIn sees and what's missing, scored out of
100. Every check is something the profile itself shows (a length, a keyword, a figure), measured here, not guessed:
recruiters find people by searching keywords and titles, and judge them on the headline, the About's opening (what
shows before "see more") and the latest role.

"Keywords" are the skills the job posts Orbit has for the target role ask for most (their `keywords`, read when
fetched), so the check is against what employers are asking for now, not a fixed list.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from orbit_api.linkedin.read import Profile

SEE_MORE = 265  # about what the About shows before "see more" on a laptop
_FIGURE = re.compile(r"\d+(?:[.,]\d+)?\s*(?:%|x\b|k\b|m\b|cr\b|l\b|lakh|crore|million|users|customers|hours|days|ms\b)|"
                     r"[₹$€£]\s?\d", re.I)
_REACH = re.compile(r"@|\b(?:reach (?:me|out)|connect with me|get in touch|let'?s (?:talk|connect)|dm me|message me|"
                    r"contact me|email me|open to)\b", re.I)
_WEAK_HEADLINE = re.compile(r"^\s*(?:student|fresher|looking for (?:a )?(?:job|opportunit\w*)|seeking\b|"
                            r"open to work|aspiring\b|unemployed)", re.I)
_AT_ONLY = re.compile(r"^[\w .&/+-]{2,80}\s+at\s+[\w .&/+-]{2,80}$", re.I)
_URL_ID = re.compile(r"linkedin\.com/in/([\w-]+)", re.I)


@dataclass(frozen=True)
class Check:
    id: str
    section: str  # headline | about | experience | skills | keywords | extras
    ok: bool
    points: int
    max: int
    title: str
    tip: str  # what to do (shown when not ok), or why it's good


@dataclass
class Audit:
    score: int
    checks: list[Check]
    keywords: list[str]  # the market's, most asked first
    found: list[str]
    missing: list[str]
    mismatches: list[str] = field(default_factory=list)  # against the Orbit resume


def _has(text: str, term: str) -> bool:
    t = term.lower().strip()
    if not t:
        return False
    if re.fullmatch(r"[\w ]+", t):
        return re.search(rf"(?<![\w]){re.escape(t)}(?![\w])", text, re.I) is not None
    return t in text.lower()


def _words(title: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9+#]+", title.lower()) if len(w) > 2 and w not in {"and", "the", "for"}}


def audit(p: Profile, target: str, keywords: list[str], resume_roles: list[tuple[str, str]] | None = None) -> Audit:
    """`target`: the role the user is after. `keywords`: the market's skills for it, most asked first.
    `resume_roles`: (title, company) on their Orbit resume, to spot what the two disagree on."""
    checks: list[Check] = []

    def add(id_: str, section: str, ok: bool, max_: int, title: str, tip: str, partial: float | None = None) -> None:
        pts = max_ if ok else round(max_ * partial) if partial else 0
        checks.append(Check(id_, section, ok, pts, max_, title, tip))

    everything = " ".join([p.headline, p.about, *(f"{r.title} {r.description}" for r in p.experience), *p.skills,
                           *p.certifications])
    kw = keywords[:15]
    found = [k for k in kw if _has(everything, k)]
    missing = [k for k in kw if k not in found]
    role_words = _words(target)

    # Headline (20)
    h = p.headline.strip()
    add("headline_set", "headline", len(h) >= 10, 4, "You have a headline",
        "Write a headline: it's next to your name in every search result and comment.")
    add("headline_length", "headline", 60 <= len(h) <= 220, 4, "Headline uses the space (60-220 characters)",
        f"Your headline is {len(h)} characters. LinkedIn allows 220: use it for your role, your strongest skills and "
        "what you've done.", partial=0.5 if len(h) >= 30 else None)
    add("headline_role", "headline", bool(role_words) and bool(role_words & _words(h)), 5,
        "Headline names the role you want",
        f"Put the role you're after in the headline (\"{target}\"): recruiters search by title." if target
        else "Set the role you're after (Jobs AI → Profile) so the audit can check it.")
    hk = [k for k in kw if _has(h, k)]
    add("headline_keywords", "headline", len(hk) >= 2, 4, "Headline has 2+ in-demand skills",
        f"Add two or three skills employers ask for: {', '.join(missing[:3]) or ', '.join(kw[:3])}.",
        partial=0.5 if hk else None)
    add("headline_strong", "headline", bool(h) and not _WEAK_HEADLINE.search(h) and not _AT_ONLY.match(h), 3,
        "Headline says what you do, not just a job title or \"looking for work\"",
        "\"Title at Company\" or \"Looking for opportunities\" wastes the headline. Say what you do and for whom.")

    # About (20)
    a = p.about.strip()
    add("about_set", "about", len(a) >= 300, 5, "You have an About section",
        "Write an About: a few short paragraphs on what you do, what you've achieved and what you want next.",
        partial=0.4 if a else None)
    add("about_length", "about", len(a) >= 1_000, 3, "About is substantial (1,000+ characters)",
        f"Your About is {len(a)} characters of the 2,600 LinkedIn allows. Add your results and the skills you use.",
        partial=0.5 if len(a) >= 500 else None)
    opening = a[:SEE_MORE]
    add("about_opening", "about", bool(role_words & _words(opening)) or any(_has(opening, k) for k in kw[:8]), 4,
        "The About's opening (before \"see more\") says what you do",
        "Most people only read the first two lines. Open with your role and your strongest result.")
    add("about_figures", "about", bool(_FIGURE.search(a)), 3, "About has a result with a number",
        "Add one result with a number in it (users, time saved, revenue, percentage).")
    ak = [k for k in kw if _has(a, k)]
    add("about_keywords", "about", len(ak) >= 3, 3, "About uses 3+ in-demand skills",
        "Name the skills employers search for: "
        f"{', '.join([k for k in missing if k not in ak][:4]) or ', '.join(kw[:4])}.",
        partial=0.5 if ak else None)
    add("about_reach", "about", bool(_REACH.search(a)), 2, "About ends with how to reach you",
        "End with what you're open to and how to reach you (an email, or \"message me here\").")

    # Experience (25)
    roles = p.experience
    latest = roles[0] if roles else None
    add("exp_any", "experience", bool(roles), 5, "Your experience is listed",
        "Add your roles, internships and projects: an empty Experience section rarely gets a message.")
    add("exp_latest_text", "experience", bool(latest and len(latest.description) >= 150), 7,
        "Your latest role is described",
        "Describe your latest role in 3-5 lines: what you built or ran, with what, and the result.",
        partial=0.4 if latest and latest.description else None)
    recent = roles[:3]
    described = [r for r in recent if len(r.description) >= 80]
    add("exp_described", "experience", bool(recent) and len(described) == len(recent), 6,
        "Each recent role has a description",
        f"{len(recent) - len(described)} of your last {len(recent)} roles have no description: add two lines to each.",
        partial=(len(described) / len(recent)) if recent and described else None)
    add("exp_figures", "experience", any(_FIGURE.search(r.description) for r in recent), 4,
        "Your roles show results with numbers",
        "Add a number to at least one role: how many, how much, how fast.")
    add("exp_current", "experience", bool(latest and latest.current) or not roles, 3, "A current role is shown",
        "If you're between jobs, add what you're doing now (a project, a course, freelance work) as a current role.")

    # Skills (15)
    n = len(p.skills)
    add("skills_count", "skills", n >= 10, 6, "10+ skills listed",
        f"You list {n} skills. LinkedIn allows 100; recruiters filter on them. Add the ones you use.",
        partial=0.5 if n >= 5 else None)
    sk = [k for k in kw[:10] if any(_has(s, k) or _has(k, s) for s in p.skills)]
    add("skills_market", "skills", len(sk) >= 5, 9, "Your skills match what employers ask for",
        f"Add the in-demand skills you have to your Skills: {', '.join(k for k in kw[:10] if k not in sk)[:200]}.",
        partial=len(sk) / 5 if sk else None)

    # Keywords anywhere (10)
    share = len(found) / len(kw) if kw else 0
    add("keywords", "keywords", share >= 0.6, 10, "The profile covers most in-demand skills",
        f"Found {len(found)} of the {len(kw)} skills employers ask for most for this role. The missing ones, if you "
        f"have them: {', '.join(missing[:8])}." if kw else "Not enough job posts for this role to compare keywords.",
        partial=share / 0.6 if share else None)

    # Extras (10)
    add("education", "extras", bool(p.education), 4, "Education is listed",
        "Add your education: many searches filter on it.")
    add("certs", "extras", bool(p.certifications), 3, "Certifications are listed",
        "Add certifications you hold (cloud, data, security...): they're searchable.")
    slug = (_URL_ID.search(p.url) or [None, ""])[1] if p.url else ""
    custom = bool(slug) and not re.search(r"-?[0-9a-f]{6,}$|\d{3,}$", str(slug))
    add("url", "extras", custom, 3, "A clean custom profile URL",
        "Set a custom URL (Edit public profile & URL): linkedin.com/in/yourname looks better on a resume."
        if p.url else "Add your custom LinkedIn URL to your resume and email signature.")

    mismatches: list[str] = []
    if resume_roles:
        li = {re.sub(r"\W+", "", r.company.lower()): r for r in p.experience if r.company}
        for title, company in resume_roles[:6]:
            key = re.sub(r"\W+", "", company.lower())
            if not key:
                continue
            match = li.get(key) or next((r for k, r in li.items() if key in k or k in key), None)
            if match is None:
                mismatches.append(f"{company} is on your resume but not on LinkedIn.")
            elif title and match.title and not (_words(title) & _words(match.title)):
                mismatches.append(f"At {company} your resume says \"{title}\" but LinkedIn says \"{match.title}\".")

    score = round(sum(c.points for c in checks) / sum(c.max for c in checks) * 100)
    return Audit(score=score, checks=checks, keywords=kw, found=found, missing=missing, mismatches=mismatches)
