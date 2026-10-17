"""The LinkedIn audit: section by section, what a recruiter searching LinkedIn sees and what's missing, scored out of
100. Every check is something the profile itself shows (a length, a keyword, a figure), measured here, not guessed:
recruiters find people by searching keywords and titles, and judge them on the headline, the About's opening (what
shows before "see more") and the latest roles.

"Keywords" are the skills the job posts Orbit has for the target role ask for most (their `keywords`, read when
fetched), so the check is against what employers are asking for now, not a fixed list.

The sections LinkedIn's PDF has (headline, About, experience, skills, education, the URL) are worth 100 points between
them. What the PDF never carries (Featured, the photo and banner, recommendations, activity) is scored only once Orbit
knows it, from a profile copied from the page or the user's own say-so, and the score is the share of the known
points: something Orbit can't see neither costs nor earns anything. Each failing check says which fix raises it
(`part`: headline, about, experience (with `role`), skills, url, featured, photo, recommendation), how (`kind`: the AI
writes it, it's worked out without AI, or only you can add it) and by how much (`gain`, in points of the overall score).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace

from orbit_api.linkedin.read import Profile, Role

SEE_MORE = 265  # about what the About shows before "see more" on a laptop (LinkedIn doesn't publish it)
HEADLINE_SHOWN = 60  # about what a search result shows of the headline on a phone (nor this)
_FIGURE = re.compile(r"\d+(?:[.,]\d+)?\s*(?:%|x\b|k\b|m\b|cr\b|l\b|lakh|crore|million|users|customers|hours|days|ms\b)|"
                     r"[₹$€£]\s?\d", re.I)
_REACH = re.compile(r"@|\b(?:reach (?:me|out)|connect with me|get in touch|let'?s (?:talk|connect)|dm me|message me|"
                    r"contact me|email me|open to)\b", re.I)
_WEAK_HEADLINE = re.compile(r"^\s*(?:student|fresher|looking for (?:a )?(?:job|opportunit\w*)|seeking\b|"
                            r"open to work|aspiring\b|unemployed)", re.I)
_AT_ONLY = re.compile(r"^[\w .&/+-]{2,80}\s+at\s+[\w .&/+-]{2,80}$", re.I)
_URL_ID = re.compile(r"linkedin\.com/in/([\w%-]+)", re.I)

# Each of the latest three roles: (points for being described, points for a result with a number, the characters
# that count as described). The latest weighs most: it's the one a recruiter reads.
ROLE_WEIGHTS = ((6, 3, 150), (3, 2, 80), (2, 2, 80))

SECTIONS: tuple[tuple[str, str], ...] = (
    ("headline", "Headline"), ("about", "About"), ("experience", "Experience"), ("skills", "Skills"),
    ("keywords", "Search keywords"), ("education", "Education and certifications"), ("url", "Custom URL"),
    ("featured", "Featured and projects"), ("photo", "Photo and banner"), ("recommendations", "Recommendations"),
    ("activity", "Activity"),
)


@dataclass(frozen=True)
class Check:
    id: str
    section: str  # one of SECTIONS
    ok: bool
    points: int
    max: int
    title: str
    tip: str  # what to do (shown when not ok), or why it's good
    part: str | None = None  # the fix that raises it; None: only you can (add a degree, a current role)
    kind: str = "you"  # ai | auto | you
    role: int | None = None  # experience: which role, 0 = the latest
    known: bool = True  # False: Orbit can't see this (not in LinkedIn's PDF), so it isn't scored
    gain: int = 0  # points the overall score gains when this passes


@dataclass(frozen=True)
class RoleScore:
    index: int
    label: str
    points: int
    max: int


@dataclass(frozen=True)
class Section:
    id: str
    label: str
    points: int
    max: int
    known: bool
    roles: list[RoleScore] = field(default_factory=list)


@dataclass(frozen=True)
class Raise:
    """One fix and what it adds: every failing check it covers, passed."""
    part: str | None
    role: int | None
    label: str
    gain: int
    kind: str
    checks: list[str]


@dataclass
class Audit:
    score: int
    checks: list[Check]
    keywords: list[str]  # the market's, most asked first
    found: list[str]
    missing: list[str]
    mismatches: list[str] = field(default_factory=list)  # against the Orbit resume
    sections: list[Section] = field(default_factory=list)
    raise_it: list[Raise] = field(default_factory=list)  # biggest gain first


def _has(text: str, term: str) -> bool:
    t = term.lower().strip()
    if not t:
        return False
    if re.fullmatch(r"[\w ]+", t):
        return re.search(rf"(?<![\w]){re.escape(t)}(?![\w])", text, re.I) is not None
    return t in text.lower()


def _words(title: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9+#]+", title.lower()) if len(w) > 2 and w not in {"and", "the", "for"}}


def role_name(r: Role) -> str:
    return " at ".join(x for x in (r.title, r.company) if x) or "This role"


def url_slug(url: str) -> str:
    m = _URL_ID.search(url or "")
    return m.group(1) if m else ""


def custom_url(url: str) -> bool:
    slug = url_slug(url)
    return bool(slug) and not re.search(r"-?[0-9a-f]{6,}$|\d{3,}$", slug)


def has_figure(text: str) -> bool:
    return bool(_FIGURE.search(text))


def _score(checks: list[Check]) -> int:
    known = [c for c in checks if c.known]
    total = sum(c.max for c in known)
    return round(sum(c.points for c in known) / total * 100) if total else 0


def _passed(c: Check) -> Check:
    return replace(c, ok=True, points=c.max, known=True)


def score_if(checks: list[Check], ids: set[str]) -> int:
    """The overall score with the checks in `ids` passed (an unknown one known and passed)."""
    return _score([_passed(c) if c.id in ids else c for c in checks])


_PART_LABEL = {"headline": "Rewrite the headline", "about": "Rewrite the About", "skills": "Reorder and add skills",
               "url": "Set a custom URL", "featured": "Add to Featured", "photo": "Add a photo and banner",
               "recommendation": "Ask for a recommendation"}


def _raise_it(checks: list[Check], profile: Profile) -> list[Raise]:
    groups: dict[tuple[str | None, int | None, str], list[Check]] = {}
    for c in checks:
        if c.ok or not c.known:
            continue
        groups.setdefault((c.part, c.role, c.id if c.part is None else ""), []).append(c)
    base = _score(checks)
    out: list[Raise] = []
    for (part, role, _), cs in groups.items():
        gain = score_if(checks, {c.id for c in cs}) - base
        if part == "experience" and role is not None and role < len(profile.experience):
            label = f"Rewrite {role_name(profile.experience[role])}"
        else:
            label = _PART_LABEL.get(part or "", cs[0].title)
        kind = "ai" if any(c.kind == "ai" for c in cs) else "auto" if any(c.kind == "auto" for c in cs) else "you"
        out.append(Raise(part, role, label, gain, kind, [c.id for c in cs]))
    return sorted(out, key=lambda r: -r.gain)


def _sections(checks: list[Check], profile: Profile) -> list[Section]:
    out = []
    for sid, label in SECTIONS:
        mine = [c for c in checks if c.section == sid]
        if not mine:
            continue
        known = [c for c in mine if c.known]
        roles = []
        if sid == "experience":
            for i, r in enumerate(profile.experience[:len(ROLE_WEIGHTS)]):
                rc = [c for c in known if c.role == i]
                if rc:
                    roles.append(RoleScore(i, role_name(r), sum(c.points for c in rc), sum(c.max for c in rc)))
        out.append(Section(sid, label, sum(c.points for c in known), sum(c.max for c in known), bool(known), roles))
    return out


def audit(p: Profile, target: str, keywords: list[str], resume_roles: list[tuple[str, str]] | None = None) -> Audit:
    """`target`: the role the user is after. `keywords`: the market's skills for it, most asked first.
    `resume_roles`: (title, company) on their Orbit resume, to spot what the two disagree on."""
    checks: list[Check] = []

    def add(id_: str, section: str, ok: bool, max_: int, title: str, tip: str, partial: float | None = None, *,
            part: str | None = None, kind: str = "you", role: int | None = None, known: bool = True) -> None:
        pts = max_ if ok else round(max_ * min(partial, 1.0)) if partial else 0
        checks.append(Check(id_, section, ok, pts if known else 0, max_, title, tip, part, kind, role, known))

    everything = " ".join([p.headline, p.about, *(f"{r.title} {r.description}" for r in p.experience), *p.skills,
                           *p.certifications])
    kw = keywords[:15]
    found = [k for k in kw if _has(everything, k)]
    missing = [k for k in kw if k not in found]
    role_words = _words(target)

    # Headline (20)
    h = p.headline.strip()
    add("headline_set", "headline", len(h) >= 10, 4, "You have a headline",
        "Write a headline: it's next to your name in every search result and comment.", part="headline", kind="ai")
    add("headline_length", "headline", 60 <= len(h) <= 220, 4, "Headline uses the space (60-220 characters)",
        f"Your headline is {len(h)} characters. LinkedIn allows 220: use it for your role, your strongest skills and "
        "what you've done.", partial=0.5 if len(h) >= 30 else None, part="headline", kind="ai")
    add("headline_role", "headline", bool(role_words) and bool(role_words & _words(h)), 5,
        "Headline names the role you want",
        f"Put the role you're after in the headline (\"{target}\"): recruiters search by title." if target
        else "Set the role you're after (above) so the audit can check it.", part="headline", kind="ai")
    hk = [k for k in kw if _has(h, k)]
    add("headline_keywords", "headline", len(hk) >= 2, 4, "Headline has 2+ in-demand skills",
        f"Add two or three skills employers ask for: {', '.join(missing[:3]) or ', '.join(kw[:3])}.",
        partial=0.5 if hk else None, part="headline", kind="ai")
    add("headline_strong", "headline", bool(h) and not _WEAK_HEADLINE.search(h) and not _AT_ONLY.match(h), 3,
        "Headline says what you do, not just a job title or \"looking for work\"",
        "\"Title at Company\" or \"Looking for opportunities\" wastes the headline. Say what you do and for whom.",
        part="headline", kind="ai")

    # About (20)
    a = p.about.strip()
    add("about_set", "about", len(a) >= 300, 5, "You have an About section",
        "Write an About: a few short paragraphs on what you do, what you've achieved and what you want next.",
        partial=0.4 if a else None, part="about", kind="ai")
    add("about_length", "about", len(a) >= 1_000, 3, "About is substantial (1,000+ characters)",
        f"Your About is {len(a)} characters of the 2,600 LinkedIn allows. Add your results and the skills you use.",
        partial=0.5 if len(a) >= 500 else None, part="about", kind="ai")
    opening = a[:SEE_MORE]
    add("about_opening", "about", bool(role_words & _words(opening)) or any(_has(opening, k) for k in kw[:8]), 4,
        "The About's opening (before \"see more\") says what you do",
        "Most people only read the first two lines. Open with your role and your strongest result.",
        part="about", kind="ai")
    add("about_figures", "about", has_figure(a), 3, "About has a result with a number",
        "Add one result with a number in it (users, time saved, revenue, percentage).", part="about", kind="ai")
    ak = [k for k in kw if _has(a, k)]
    add("about_keywords", "about", len(ak) >= 3, 3, "About uses 3+ in-demand skills",
        "Name the skills employers search for: "
        f"{', '.join([k for k in missing if k not in ak][:4]) or ', '.join(kw[:4])}.",
        partial=0.5 if ak else None, part="about", kind="ai")
    add("about_reach", "about", bool(_REACH.search(a)), 2, "About ends with how to reach you",
        "End with what you're open to and how to reach you (an email, or \"message me here\").",
        part="about", kind="ai")

    # Experience (25 with three roles): listed, current, and each of the latest three roles on its own.
    roles = p.experience
    latest = roles[0] if roles else None
    add("exp_any", "experience", bool(roles), 4, "Your experience is listed",
        "Add your roles, internships and projects: an empty Experience section rarely gets a message.")
    add("exp_current", "experience", bool(latest and latest.current) or not roles, 3, "A current role is shown",
        "If you're between jobs, add what you're doing now (a project, a course, freelance work) as a current role.")
    for i, (r, (text_max, fig_max, need)) in enumerate(zip(roles, ROLE_WEIGHTS, strict=False)):
        name, d = role_name(r), r.description.strip()
        add(f"exp_text_{i}", "experience", len(d) >= need, text_max, f"{name} is described",
            ("Describe your latest role in 3-5 lines: what you built or ran, with what, and the result." if i == 0
             else f"Add two or three lines to {name}: what you did there and the result.")
            + (f" It has {len(d)} characters now." if d else ""),
            partial=min(0.8, len(d) / need) if d else None, part="experience", kind="ai", role=i)
        add(f"exp_figures_{i}", "experience", has_figure(d), fig_max, f"{name} shows a result with a number",
            "Add a number to it: how many, how much, how fast.", part="experience", kind="ai", role=i)

    # Skills (15)
    n = len(p.skills)
    add("skills_count", "skills", n >= 10, 6, "10+ skills listed",
        f"You list {n} skills. LinkedIn allows 100; recruiters filter on them. Add the ones you use.",
        partial=0.5 if n >= 5 else None, part="skills", kind="auto")
    sk = [k for k in kw[:10] if any(_has(s, k) or _has(k, s) for s in p.skills)]
    add("skills_market", "skills", len(sk) >= 5 or (bool(kw) and len(sk) >= len(kw[:10])), 9,
        "Your skills match what employers ask for",
        f"Add the in-demand skills you have to your Skills: {', '.join(k for k in kw[:10] if k not in sk)[:200]}."
        if kw else "Not enough job posts for this role to compare skills.",
        partial=len(sk) / 5 if sk else None, part="skills", kind="auto", known=bool(kw))

    # Keywords anywhere (10). Both keyword checks count only when there are job posts to compare with.
    share = len(found) / len(kw) if kw else 0
    add("keywords", "keywords", share >= 0.6, 10, "The profile covers most in-demand skills",
        f"Found {len(found)} of the {len(kw)} skills employers ask for most for this role. The missing ones, if you "
        f"have them: {', '.join(missing[:8])}." if kw else "Not enough job posts for this role to compare keywords.",
        partial=share / 0.6 if share else None, part="skills", kind="auto", known=bool(kw))

    # Education and certifications (7), the URL (3)
    add("education", "education", bool(p.education), 4, "Education is listed",
        "Add your education: many searches filter on it.")
    add("certs", "education", bool(p.certifications), 3, "Certifications are listed",
        "Add certifications you hold (cloud, data, security...): they're searchable.")
    add("url", "url", custom_url(p.url), 3, "A clean custom profile URL",
        "Set a custom URL: linkedin.com/in/yourname looks better on a resume and in an email signature."
        if p.url else "Orbit couldn't see your profile address. Set a custom one and put it on your resume.",
        part="url", kind="auto")

    # What the PDF doesn't carry: scored once known.
    seen_featured = p.featured is not None or bool(p.projects)
    add("featured", "featured", bool(p.featured) or bool(p.projects), 3, "Featured shows your best work",
        "Pin two or three things to Featured: a project, a certificate, a post about a result." if seen_featured else
        "LinkedIn's PDF doesn't include Featured. If yours is empty, pin two or three pieces of your best work.",
        part="featured", kind="ai", known=seen_featured)
    add("photo", "photo", bool(p.photo), 2, "A profile photo",
        "Add a clear, recent photo of your face: profiles with one get far more views." if p.photo is not None else
        "LinkedIn's PDF doesn't include your photo. Check you have a clear, recent one.",
        part="photo", kind="auto", known=p.photo is not None)
    add("banner", "photo", bool(p.banner), 1, "A background banner",
        "Add a background image about your work (1584 x 396 pixels)." if p.banner is not None else
        "LinkedIn's PDF doesn't include your banner. Check you have one about your work.",
        part="photo", kind="auto", known=p.banner is not None)
    recs = p.recommendations
    add("recommendations", "recommendations", (recs or 0) >= 2, 3, "Two or more recommendations",
        f"You have {recs} recommendation{'' if recs == 1 else 's'}. Ask a past manager or client for one."
        if recs is not None else "LinkedIn's PDF doesn't include recommendations. Two or more from managers help.",
        partial=0.5 if recs == 1 else None, part="recommendation", kind="ai", known=recs is not None)
    add("activity", "activity", bool(p.activity), 2, "Recent activity",
        "Post or comment about your work every week or two: it shows on your profile and in recruiters' feeds."
        if p.activity is not None else "LinkedIn's PDF doesn't include activity.",
        known=p.activity is not None)

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

    score = _score(checks)
    checks = [c if c.ok else replace(c, gain=score_if(checks, {c.id}) - score) for c in checks]
    return Audit(score=score, checks=checks, keywords=kw, found=found, missing=missing, mismatches=mismatches,
                 sections=_sections(checks, p), raise_it=_raise_it(checks, p))
