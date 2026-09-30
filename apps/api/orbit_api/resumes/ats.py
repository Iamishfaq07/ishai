"""ATS score: how applicant-tracking software is likely to read a resume, out of 100, with a fix for every miss.

Deterministic on purpose: the same resume always gets the same score, it costs nothing to re-score on every edit,
and every point is explainable. The rubric follows what resume parsers and recruiters' keyword searches depend on:
reachable contact details, the standard sections, bullets that start with a verb and carry a number, a skills list,
a single-column layout, and (with a job post) the job's own keywords.

Categories and weights (100): contact 10, sections 10, summary 4, experience 28, skills 7, readability 12, layout 4,
keywords 25. Without a job post there are no keywords to match, and the other 75 points are scaled to 100.

Paths in `target` point at the text a fix is about, e.g. `experience.<id>.bullets.2` or `basics.summary`. The editor
jumps there, and "Fix with AI" asks for a rewrite of exactly that text.
"""

import re
from collections import Counter
from collections.abc import Iterator
from typing import Literal

from pydantic import BaseModel

from orbit_api.resumes.schema import ResumeData, ResumeDesign

Category = Literal["contact", "sections", "summary", "experience", "skills", "readability", "layout", "keywords"]
CATEGORY_LABELS: dict[Category, str] = {
    "contact": "Contact details", "sections": "Standard sections", "summary": "Summary",
    "experience": "Experience bullets", "skills": "Skills", "readability": "Readability",
    "layout": "ATS-safe layout", "keywords": "Job keywords",
}


class AtsCheck(BaseModel):
    id: str
    category: Category
    label: str
    points: float
    max_points: float
    passed: bool
    fix: str | None = None
    target: str | None = None
    ai_fixable: bool = False


class AtsCategory(BaseModel):
    id: Category
    label: str
    points: float
    max_points: float


class AtsKeywords(BaseModel):
    matched: list[str]
    missing: list[str]


class AtsReport(BaseModel):
    score: int
    verdict: str
    categories: list[AtsCategory]
    checks: list[AtsCheck]
    keywords: AtsKeywords | None = None
    has_job: bool


# ---- text helpers --------------------------------------------------------------------------------------------

ACTION_VERBS = frozenset("""
accelerated achieved acquired adapted addressed administered advanced advised advocated aligned analyzed analysed
architected arranged assembled assessed assisted attained audited authored automated balanced boosted budgeted built
calculated captured catalogued championed clarified coached collaborated completed composed conceived conceptualized
conducted configured consolidated constructed consulted contributed controlled converted coordinated corrected
created cultivated curated cut debugged decreased defined delivered deployed designed determined developed devised
diagnosed directed discovered doubled drafted drove earned edited educated eliminated enabled engineered enhanced
established evaluated examined executed expanded expedited facilitated fixed forecasted formed formulated founded
generated grew guided halved handled headed identified implemented improved increased influenced initiated innovated
inspected installed instituted integrated introduced invented investigated launched led leveraged maintained managed
mapped marketed maximized measured mentored merged migrated minimized modeled modelled modernized monitored motivated
negotiated operated optimized orchestrated organized organised originated outperformed overhauled oversaw partnered
performed pioneered planned presented prevented prioritized processed produced programmed promoted proposed
prototyped provided published raised ran rebuilt recommended reconciled recruited redesigned reduced refactored
refined reorganized replaced reported represented researched resolved restructured revamped reviewed revised
saved scaled scheduled secured selected served shipped simplified slashed solved spearheaded standardized
started streamlined strengthened structured supervised supported surpassed synthesized taught tested tracked trained
transformed translated tripled troubleshot tuned unified upgraded utilized validated won wrote
""".split())

# Other strong verbs to suggest when one opens too many bullets.
VERB_ALTERNATIVES: dict[str, str] = {
    "led": "Directed, Headed, Drove, Steered", "managed": "Directed, Oversaw, Ran, Coordinated",
    "built": "Engineered, Created, Developed, Shipped", "developed": "Built, Engineered, Designed, Created",
    "created": "Designed, Launched, Built, Produced", "improved": "Boosted, Strengthened, Raised, Refined",
    "worked": "Built, Delivered, Partnered, Drove", "helped": "Enabled, Supported, Advised, Contributed",
    "designed": "Architected, Planned, Shaped, Modeled", "implemented": "Rolled out, Delivered, Built, Deployed",
    "increased": "Grew, Raised, Boosted, Expanded", "reduced": "Cut, Lowered, Trimmed, Decreased",
}
# Phrases recruiters skim past: they claim a quality instead of showing it.
CLICHES: tuple[str, ...] = (
    "team player", "hard worker", "hard-working", "hardworking", "detail-oriented", "detail oriented",
    "results-driven", "results driven", "results-oriented", "self-starter", "self starter", "go-getter",
    "think outside the box", "thinking outside the box", "synergy", "proven track record", "highly motivated",
    "fast learner", "quick learner", "excellent communication skills", "go-to person", "dynamic individual",
)
_CLICHE = re.compile(r"(?<![a-z])(" + "|".join(re.escape(c) for c in CLICHES) + r")(?![a-z])", re.IGNORECASE)
# A bracketed cue the AI leaves for the user to fill in ("by [X%]"); same shape the editor highlights.
PLACEHOLDER = re.compile(r"\[[^\][\n]{1,160}\]")

_PRONOUN = re.compile(r"\b(?:I|me|my|mine|myself)\b|\b(?:My|Me)\b")
_NUMBER = re.compile(r"\d|%|\$|€|£|₹")
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
_WORD = re.compile(r"[A-Za-z][A-Za-z0-9+#.\-']*")
_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")


def _words(text: str) -> list[str]:
    return _WORD.findall(text)


def _first_word(text: str) -> str:
    words = _words(text)
    return words[0].lower().rstrip(".,;:") if words else ""


def date_style(value: str) -> str | None:
    """How a date is written: "month_year" (Jan 2021), "numeric" (01/2021), "year" (2021), or None if blank or
    "Present"."""
    v = value.strip().lower()
    if not v or v in {"present", "current", "now", "today", "ongoing"}:
        return None
    if re.fullmatch(r"\d{1,2}\s*[/.-]\s*\d{4}|\d{4}\s*[/.-]\s*\d{1,2}", v):
        return "numeric"
    if re.fullmatch(r"\d{4}", v):
        return "year"
    if v[:3] in _MONTHS and re.search(r"\d{4}", v):
        return "month_year"
    return "other"


_MONTH_NUM = {m: i + 1 for i, m in enumerate(_MONTHS)}


def date_key(value: str, *, end: bool = False) -> tuple[int, int] | None:
    """(year, month) of a written date, for ordering: "Jan 2021" -> (2021, 1), "01/2021" -> (2021, 1), "2021" ->
    (2021, 1) as a start or (2021, 12) as an end. "Present" as an end is the latest possible. None if unreadable."""
    v = value.strip().lower()
    if end and v in {"present", "current", "now", "today", "ongoing"}:
        return (9999, 12)
    year = re.search(r"\b(19|20)\d{2}\b", v)
    if not year:
        return None
    y = int(year.group(0))
    month: int | None = _MONTH_NUM.get(v[:3])
    if month is None:
        numeric = re.fullmatch(r"(\d{1,2})\s*[/.-]\s*\d{4}|\d{4}\s*[/.-]\s*(\d{1,2})", v)
        if numeric:
            month = int(numeric.group(1) or numeric.group(2))
    if month is None or not 1 <= month <= 12:
        month = 12 if end else 1
    return (y, month)


def text_fields(data: ResumeData) -> Iterator[tuple[str, str]]:
    """(path, text) of every free-text field a person or the AI writes sentences in; paths match the editor's."""
    b = data.basics
    yield "basics.headline", b.headline
    yield "basics.summary", b.summary
    for e in data.experience:
        for i, text in enumerate(e.bullets):
            yield f"experience.{e.id}.bullets.{i}", text
    for p in data.projects:
        yield f"projects.{p.id}.description", p.description
        for i, text in enumerate(p.bullets):
            yield f"projects.{p.id}.bullets.{i}", text
    for ed in data.education:
        yield f"education.{ed.id}", ed.details
    for x in data.extras:
        for i, text in enumerate(x.items):
            yield f"extras.{x.id}.items.{i}", text


def resume_text(data: ResumeData) -> str:
    """Everything on the resume as plain text (keyword matching, word counts, and "save to Documents")."""
    b = data.basics
    lines = [b.name, b.headline, b.email, b.phone, b.location, *(link.url for link in b.links), b.summary]
    for e in data.experience:
        lines += [f"{e.title} {e.company} {e.location}", *e.bullets]
    for s in data.skills:
        lines += [s.name, ", ".join(s.items)]
    for p in data.projects:
        lines += [p.name, p.description, *p.bullets]
    for ed in data.education:
        lines += [f"{ed.degree} {ed.field} {ed.school}", ed.details]
    for c in data.certifications:
        lines += [f"{c.name} {c.issuer}"]
    for x in data.extras:
        lines += [x.title, *x.items]
    return "\n".join(line for line in lines if line and line.strip())


def _bullets(data: ResumeData) -> Iterator[tuple[str, str]]:
    """(path, text) of every non-empty experience bullet."""
    for e in data.experience:
        for i, text in enumerate(e.bullets):
            if text.strip():
                yield f"experience.{e.id}.bullets.{i}", text.strip()


# ---- job keywords --------------------------------------------------------------------------------------------

# Skills and tools recruiters search for. Multi-word terms first so "machine learning" wins over "learning".
SKILL_VOCAB: tuple[str, ...] = tuple(sorted({
    # engineering
    "python", "java", "javascript", "typescript", "go", "golang", "rust", "c++", "c#", "ruby", "php", "kotlin", "swift",
    "scala", "sql", "nosql", "html", "css", "react", "angular", "vue", "node.js", "next.js", "django", "flask",
    "fastapi", "spring", "rails", ".net", "graphql", "rest", "grpc", "microservices", "kubernetes", "docker",
    "terraform", "ansible", "aws", "azure", "gcp", "google cloud", "linux", "git", "ci/cd", "jenkins",
    "github actions", "postgresql", "postgres", "mysql", "mongodb", "redis", "kafka", "rabbitmq", "elasticsearch",
    "spark", "hadoop", "airflow", "snowflake", "dbt", "bigquery", "tableau", "power bi", "looker", "excel",
    "pandas", "numpy", "pytorch", "tensorflow", "scikit-learn", "machine learning", "deep learning", "nlp",
    "computer vision", "data science", "data analysis", "data engineering", "data modeling", "statistics",
    "a/b testing", "llm", "generative ai", "distributed systems", "system design", "api design", "security",
    "devops", "sre", "observability", "monitoring", "testing", "unit testing", "automation", "agile", "scrum",
    "kanban", "jira", "figma", "ux", "ui", "user research", "accessibility", "mobile", "ios", "android",
    "embedded", "networking", "cloud", "serverless", "etl", "data pipelines", "performance", "scalability",
    # business
    "project management", "product management", "program management", "stakeholder management", "roadmap",
    "strategy", "budgeting", "forecasting", "financial modeling", "p&l", "sales", "business development",
    "account management", "customer success", "crm", "salesforce", "hubspot", "marketing", "seo", "sem",
    "content marketing", "social media", "copywriting", "brand", "analytics", "google analytics", "operations",
    "supply chain", "logistics", "procurement", "negotiation", "recruiting", "onboarding", "training",
    "compliance", "risk management", "audit", "accounting", "gaap", "sap", "erp", "leadership",
    "team leadership", "mentoring", "communication", "presentation", "cross-functional", "customer service",
    "process improvement", "lean", "six sigma", "quality assurance", "research", "writing", "editing",
}, key=lambda t: (-len(t.split()), t)))

_STOP = frozenset("""
a about above after again all also am an and any are as at be because been before being below between both but
by can could did do does doing down during each few for from further had has have having he her here hers him
his how i if in into is it its itself just me more most my no nor not now of off on once only or other our ours
out over own same she should so some such than that the their them then there these they this those through to
too under until up very was we were what when where which while who whom why will with would you your yours api
apis senior junior lead principal staff head manager engineer engineers developer developers backend frontend
product products analyst designer director specialist associate intern ability able across work working works
worked team teams role roles job jobs candidate candidates company experience experienced years year strong
excellent good great new using use used including include includes within well plus must required requirements
preferred responsibilities responsible opportunity join help helping make makes looking seeking ideal knowledge
skills skill understanding related relevant based level high highly etc will you'll we're our us day days time
part full support ensure across environment fast paced world class every best like other others
""".split())


_LIST_LEAD = frozenset({",", "(", "/", "and", "or", "with", "in", "using", "like", "via", "including", "of"})


def _norm(text: str) -> str:
    t = text.lower().replace("node.js", "nodejs").replace("next.js", "nextjs").replace("’", "'")
    return re.sub(r"\s+", " ", t)


def _term_pattern(term: str) -> re.Pattern[str]:
    t = _norm(term)
    # Word edges that also work for "c++", "c#", ".net" and "a/b testing"; an optional plural "s".
    return re.compile(r"(?<![a-z0-9])" + re.escape(t) + r"s?(?![a-z0-9+#])")


def _part_of(key: str, terms: list[str]) -> bool:
    """"ci" inside "ci/cd", "github" inside "github actions": already counted as the longer term."""
    stem = key.rstrip("s")
    return any(stem in re.split(r"[\s/.-]+", t) or key in re.split(r"[\s/.-]+", t) for t in terms)


def extract_keywords(job_text: str, limit: int = 20) -> list[str]:
    """The job post's most searchable terms: known skills first, then product/tech names, then repeated words."""
    norm = _norm(job_text)
    scores: Counter[str] = Counter()
    display: dict[str, str] = {}
    covered: list[str] = []
    for term in SKILL_VOCAB:
        n = len(_term_pattern(term).findall(norm))
        if n and not any(term in bigger for bigger in covered):  # "learning" inside "machine learning"
            scores[term] += 3 * n + 10
            display[term] = term
            covered.append(term)
    # Product and tech names. CamelCase and acronyms anywhere mid-sentence ("GraphQL", "SOC2"); a plain capitalised
    # word ("Datadog") only in a list-like spot ("with X", "in X", "X, Y", "(X)"), so a company name after "at" or a
    # job title isn't mistaken for a skill.
    for m in re.finditer(r"(?:(\b[a-z]+|[,(/])\s?)([A-Z][a-z]*[A-Z][A-Za-z0-9]*|[A-Z]{2,6}[0-9]?|[A-Z][a-z]{2,})\b",
                         job_text):
        before, word = m.group(1), m.group(2)
        plain = word[0].isupper() and word[1:].islower()
        if plain and before not in _LIST_LEAD:
            continue
        key = _norm(word)
        if key in _STOP or key.rstrip("s") in _STOP or key in scores or _part_of(key, covered):
            continue
        scores[key] += 4
        display.setdefault(key, word)
    counts = Counter(w for w in re.findall(r"[a-z][a-z+#-]{3,}", norm) if w not in _STOP)
    for word, n in counts.items():
        if n >= 3 and not any(word in k for k in scores):
            scores[word] += n
            display.setdefault(word, word)
    return [display[k] for k, _ in scores.most_common(limit)]


def match_keywords(keywords: list[str], data: ResumeData) -> AtsKeywords:
    text = _norm(resume_text(data))
    matched: list[str] = []
    missing: list[str] = []
    for kw in keywords:
        (matched if _term_pattern(kw).search(text) else missing).append(kw)
    return AtsKeywords(matched=matched, missing=missing)


# ---- scoring -------------------------------------------------------------------------------------------------


def _check(checks: list[AtsCheck], id_: str, category: Category, label: str, max_points: float, ratio: float,
           fix: str | None, target: str | None = None, ai_fixable: bool = False) -> None:
    ratio = max(0.0, min(1.0, ratio))
    passed = ratio >= 0.999
    checks.append(AtsCheck(id=id_, category=category, label=label, max_points=max_points,
                           points=round(max_points * ratio, 1), passed=passed, fix=None if passed else fix,
                           target=None if passed else target, ai_fixable=ai_fixable and not passed))


def _verdict(score: int) -> str:
    return "Strong" if score >= 80 else "Good" if score >= 65 else "Needs work" if score >= 45 else "Weak"


def score_resume(data: ResumeData, design: ResumeDesign | None = None, job_text: str = "") -> AtsReport:
    design = design or ResumeDesign()
    checks: list[AtsCheck] = []
    b = data.basics

    # contact (10)
    _check(checks, "name", "contact", "Your name at the top", 2, 1.0 if b.name.strip() else 0,
           "Add your full name: it's the first thing a parser looks for.", "basics.name")
    _check(checks, "email", "contact", "A valid email address", 3, 1.0 if _EMAIL.match(b.email.strip()) else 0,
           "Add an email address recruiters can reach you at.", "basics.email")
    _check(checks, "phone", "contact", "A phone number", 2,
           1.0 if len(re.sub(r"\D", "", b.phone)) >= 7 else 0, "Add a phone number, with the country code.",
           "basics.phone")
    _check(checks, "location", "contact", "Your city or region", 1, 1.0 if b.location.strip() else 0,
           "Add your city and country (or \"Remote\"): recruiters filter by location.", "basics.location")
    _check(checks, "link", "contact", "A LinkedIn or portfolio link", 2,
           1.0 if any(link.url.strip() for link in b.links) else 0,
           "Add your LinkedIn profile or portfolio link.", "basics.links")

    # sections (10)
    has_exp = any(e.title.strip() or e.company.strip() for e in data.experience)
    has_edu = any(e.school.strip() or e.degree.strip() for e in data.education)
    n_skills = sum(len([i for i in s.items if i.strip()]) for s in data.skills)
    _check(checks, "has_experience", "sections", "An Experience section", 4, 1.0 if has_exp else 0,
           "Add your work experience: it's what ATS software weighs most. Internships and volunteer roles count.",
           "experience")
    _check(checks, "has_education", "sections", "An Education section", 3, 1.0 if has_edu else 0,
           "Add your education: many ATS filters check for a degree or school.", "education")
    _check(checks, "has_skills", "sections", "A Skills section", 3, 1.0 if n_skills else 0,
           "Add a Skills section: recruiters search it first.", "skills")

    # summary (4)
    summary_words = len(_words(b.summary))
    _check(checks, "summary", "summary", "A summary of 25-90 words", 4,
           0 if not summary_words else 1.0 if 25 <= summary_words <= 90 else 0.5,
           "Add a 2-3 sentence summary: who you are, your strongest skills, and what you're looking for."
           if not summary_words else
           f"Your summary has {summary_words} words; aim for 25-90 so it's read in full.",
           "basics.summary", ai_fixable=True)

    # experience (28)
    roles = [e for e in data.experience if e.title.strip() or e.company.strip()]
    bullets = list(_bullets(data))
    complete = [e for e in roles if e.title.strip() and e.company.strip() and e.start.strip()
                and (e.end.strip() or e.current)]
    incomplete = next((e for e in roles if e not in complete), None)
    _check(checks, "roles_complete", "experience", "Every role has a title, company and dates", 6,
           len(complete) / len(roles) if roles else 0,
           f"Fill in the title, company and dates for {incomplete.title or incomplete.company or 'each role'}."
           if incomplete else "Add at least one role with a title, company and dates.",
           f"experience.{incomplete.id}" if incomplete else "experience")
    thin = next((e for e in roles if not 2 <= len([x for x in e.bullets if x.strip()]) <= 6), None)
    _check(checks, "bullets_per_role", "experience", "2-6 bullets per role", 4,
           (sum(1 for e in roles if 2 <= len([x for x in e.bullets if x.strip()]) <= 6) / len(roles)) if roles else 0,
           f"Give \"{thin.title or thin.company}\" 2-6 bullets: fewer looks thin, more gets skimmed." if thin
           else "Add 2-6 bullets to each role.", f"experience.{thin.id}" if thin else "experience")

    if bullets:
        weak = [(p, t) for p, t in bullets if _first_word(t) not in ACTION_VERBS]
        _check(checks, "action_verbs", "experience", "Bullets start with an action verb", 5,
               1 - len(weak) / len(bullets),
               f"{len(bullets) - len(weak)} of {len(bullets)} bullets start with an action verb. Lead with what you "
               "did: Led, Built, Reduced, Launched.", weak[0][0] if weak else None, ai_fixable=True)
        unquantified = [(p, t) for p, t in bullets if not _NUMBER.search(t)]
        quantified = len(bullets) - len(unquantified)
        _check(checks, "quantified", "experience", "At least half the bullets have a number", 7,
               min(1.0, quantified / (len(bullets) * 0.5)),
               f"{quantified} of {len(bullets)} bullets have a number. Add the size of the result: %, $, time saved, "
               "users, team size.", unquantified[0][0] if unquantified else None, ai_fixable=True)
        bad_len = [(p, t) for p, t in bullets if not 8 <= len(_words(t)) <= 35]
        _check(checks, "bullet_length", "experience", "Bullets are 8-35 words", 3, 1 - len(bad_len) / len(bullets),
               "Keep each bullet to one line or two: 8-35 words.", bad_len[0][0] if bad_len else None,
               ai_fixable=True)
        # The same opening verb over and over reads as padding: allow it on about one bullet in five, at least twice.
        openers = Counter(_first_word(t) for _, t in bullets)
        allowed = max(2, -(-len(bullets) // 5))
        overused = [(w, n) for w, n in openers.most_common() if w and n > allowed]
        repeat_at = None
        if overused:
            word = overused[0][0]
            repeat_at = [p for p, t in bullets if _first_word(t) == word][allowed]
        _check(checks, "varied_verbs", "experience", "Opening verbs are varied", 2, 0 if overused else 1.0,
               (f"{overused[0][1]} bullets start with \"{overused[0][0].capitalize()}\". Vary them"
                + (f": {VERB_ALTERNATIVES[overused[0][0]]}." if overused[0][0] in VERB_ALTERNATIVES else ".")
                ) if overused else None, repeat_at, ai_fixable=True)
        first_person = [(p, t) for p, t in bullets if _PRONOUN.search(t)]
        _check(checks, "no_pronouns", "experience", "No \"I\" or \"my\" in bullets", 1,
               1 - len(first_person) / len(bullets),
               "Drop \"I\" and \"my\": resume bullets start with the verb.",
               first_person[0][0] if first_person else None, ai_fixable=True)
    else:
        for id_, label, pts in (("action_verbs", "Bullets start with an action verb", 5),
                                ("quantified", "At least half the bullets have a number", 7),
                                ("bullet_length", "Bullets are 8-35 words", 3),
                                ("varied_verbs", "Opening verbs are varied", 2),
                                ("no_pronouns", "No \"I\" or \"my\" in bullets", 1)):
            _check(checks, id_, "experience", label, pts, 0, "Add bullets describing what you achieved in each role.",
                   "experience")

    # skills (7)
    _check(checks, "skills_count", "skills", "At least 8 skills listed", 7, n_skills / 8,
           f"You list {n_skills} skill{'s' if n_skills != 1 else ''}; list at least 8 tools, languages and methods you "
           "really use.", "skills")

    # readability (12)
    total_words = len(_words(resume_text(data)))
    _check(checks, "length", "readability", "300-1,000 words (1-2 pages)", 3,
           1.0 if 300 <= total_words <= 1000 else total_words / 300 if total_words < 300 else 0.5,
           f"The resume has {total_words} words: " + ("add more detail to your roles." if total_words < 300 else
                                                      "trim it to the last 10-15 years and your best results."),
           "experience")
    # Roles only: education written as years ("2016") is normal next to "Jan 2020" for jobs.
    styles = {s for e in data.experience for s in (date_style(e.start), date_style(e.end)) if s}
    _check(checks, "dates", "readability", "Dates written one way", 2,
           1.0 if len(styles) <= 1 and "other" not in styles else 0,
           "Write every date the same way, e.g. \"Jan 2021\", so a parser can work out each role's length.",
           "experience")
    # Roles most recent first, and none ending before it starts: parsers and recruiters both read it that way.
    # Out of order means it both starts and ends later than the role above it: overlapping jobs are fine.
    order_fix: tuple[str, str] | None = None
    previous: tuple[tuple[int, int] | None, tuple[int, int] | None, str] | None = None
    for e in roles:
        start, end = date_key(e.start), date_key("present" if e.current else e.end, end=True)
        name = e.title or e.company or "a role"
        if start and end and end < start:
            order_fix = (f"\"{name}\" ends before it starts: check its dates.", f"experience.{e.id}")
            break
        if previous:
            later = [mine > theirs for mine, theirs in ((start, previous[0]), (end, previous[1])) if mine and theirs]
            if later and all(later):
                order_fix = (f"List roles most recent first: move \"{name}\" above \"{previous[2]}\".",
                             f"experience.{e.id}")
                break
        if start or end:
            previous = (start, end, name)
    _check(checks, "date_order", "readability", "Roles most recent first, dates in order", 2,
           0 if order_fix else 1.0, order_fix[0] if order_fix else None, order_fix[1] if order_fix else None)
    fields = [(p, t) for p, t in text_fields(data) if t.strip()]
    unfilled = [(p, m.group(0)) for p, t in fields if (m := PLACEHOLDER.search(t))]
    n_unfilled = len(unfilled)
    _check(checks, "placeholders", "readability", "No [placeholders] left to fill", 3, 0 if unfilled else 1.0,
           (f"{n_unfilled} line{'s' if n_unfilled != 1 else ''} still {'have' if n_unfilled != 1 else 'has'} a "
            f"placeholder like {unfilled[0][1]}: fill in the real detail or remove it, or it prints as-is."
            ) if unfilled else None, unfilled[0][0] if unfilled else None)
    cliched = [(p, m.group(1)) for p, t in fields if (m := _CLICHE.search(t))]
    _check(checks, "cliches", "readability", "No clichés like \"team player\"", 2, 0 if cliched else 1.0,
           (f"\"{cliched[0][1]}\" claims a quality instead of showing it. Replace it with what you did that proves it."
            ) if cliched else None, cliched[0][0] if cliched else None,
           ai_fixable=bool(cliched) and not cliched[0][0].startswith(("education.", "extras.")))

    # layout (4)
    _check(checks, "single_column", "layout", "Single-column template", 2, 0 if design.template == "sidebar" else 1.0,
           "Two-column layouts can be read out of order by ATS software. Pick Classic, Modern or Compact.",
           "design.template")
    photo = design.show_photo and bool(design.photo)
    _check(checks, "no_photo", "layout", "No photo", 2, 0 if photo else 1.0,
           "Most ATS software ignores photos, and US, UK and Canadian employers often screen them out. Hide it "
           "unless photos are expected where you apply.", "design.photo")

    # keywords (25)
    keywords: AtsKeywords | None = None
    has_job = bool(job_text.strip())
    if has_job:
        wanted = extract_keywords(job_text)
        keywords = match_keywords(wanted, data)
        ratio = len(keywords.matched) / len(wanted) if wanted else 1.0
        missing = ", ".join(keywords.missing[:6])
        _check(checks, "keywords", "keywords", "Matches the job post's keywords", 25, min(1.0, ratio / 0.8),
               f"Missing from your resume: {missing}. Add the ones you really have, in your skills or bullets."
               if missing else None, "skills", ai_fixable=True)

    by_cat: dict[Category, list[AtsCheck]] = {}
    for c in checks:
        by_cat.setdefault(c.category, []).append(c)
    categories = [AtsCategory(id=cat, label=CATEGORY_LABELS[cat], points=round(sum(c.points for c in cs), 1),
                              max_points=sum(c.max_points for c in cs)) for cat, cs in by_cat.items()]
    earned = sum(c.points for c in checks)
    possible = sum(c.max_points for c in checks)
    score = round(100 * earned / possible) if possible else 0
    return AtsReport(score=score, verdict=_verdict(score), categories=categories, checks=checks, keywords=keywords,
                     has_job=has_job)
