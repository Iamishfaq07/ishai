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
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel

from orbit_api.resumes.claims import _GENERIC, _figures
from orbit_api.resumes.lint import LineIssue, line_count, line_issues
from orbit_api.resumes.schema import Experience, Project, ResumeData, ResumeDesign

Category = Literal["contact", "sections", "summary", "experience", "skills", "readability", "layout", "keywords"]
CATEGORY_LABELS: dict[Category, str] = {
    "contact": "Contact details", "sections": "Standard sections", "summary": "Summary",
    "experience": "Experience bullets", "skills": "Skills", "readability": "Readability",
    "layout": "ATS-safe layout", "keywords": "Job keywords",
}


FixKind = Literal["ai", "auto", "you"]


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
    # How it gets fixed: "ai" rewrites or drafts text (a resume credit), "auto" is worked out without the AI (free),
    # "you" needs something only the candidate knows (a phone number, a role's dates). None once it passes.
    fix_kind: FixKind | None = None
    # Every line the problem is on (paths), not just the first: what "Fix with AI" rewrites and then re-checks.
    paths: list[str] = []


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
    # Line by line (lint.py): every flagged line, so the editor marks each one where it is.
    issues: list[LineIssue] = []


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
closed coded documented exceeded hired hosted landed lifted lowered onboarded owned piloted quadrupled ramped
retained rolled shaped shortened sold sourced steered trimmed
answered entered responded prepared compiled collected updated escalated logged recorded filed demonstrated
explained interviewed liaised moderated navigated ordered posted purchased received registered routed sorted staffed
stocked surveyed tutored verified volunteered welcomed cleaned greeted assisted answered handled triaged resolved
assigned briefed checked communicated conveyed delegated distributed drafted equipped estimated familiarized gathered
greenlit illustrated informed inventoried issued lectured matched modified noticed obtained outlined persuaded
photographed picked prepped printed programmed protected qualified rated reached recognized rectified rewrote
scanned screened shared simulated sketched spoke sponsored strategized studied summarized supplied tailored
transcribed transitioned uncovered unveiled visualized weighed
found forecast
""".split())
# Present-tense forms whose past isn't the word + "ed"/"d" (a current role is written in the present: "Lead a team").
_IRREGULAR_PRESENT = {
    "lead": "led", "build": "built", "run": "ran", "drive": "drove", "grow": "grew", "write": "wrote", "win": "won",
    "cut": "cut", "oversee": "oversaw", "teach": "taught", "sell": "sold", "troubleshoot": "troubleshot",
    "find": "found", "speak": "spoke", "rebuild": "rebuilt", "rewrite": "rewrote",
}


# Words ending in -ed that describe the person, or say they were near the work rather than did it: never an action.
_NOT_ACTIONS = frozenset("""
experienced skilled seasoned talented dedicated detailed varied related based focused oriented certified licensed
interested accomplished distinguished versed worked helped tasked involved acted used needed wanted liked loved hoped
exposed acquainted familiarised engaged entrusted titled named called
""".split())


def is_action_verb(word: str) -> bool:
    """A bullet opener that says what the person did, in the past ("Led") or, for a current role, the present ("Lead",
    "Leads", "Manage"). "Co-founded" and "Re-architected" count as their verb, and so does any other verb in the past
    tense ("Pentested", "Fuzzed", "Red-teamed"), unless it describes the person ("Experienced") or is a weak opener
    ("Worked", "Helped")."""
    w = word.lower().rstrip(".,;:")
    parts = w.split("-")
    last = parts[-1]
    if (len(last) >= 5 and last.endswith("ed") and not last.endswith("eed") and parts[0] != "self"
            and w not in _NOT_ACTIONS and last not in _NOT_ACTIONS and last.isalpha()):
        return True
    for prefix in ("co-", "re-"):
        if w.startswith(prefix) and len(w) > len(prefix) + 2:
            w = w[len(prefix):]
    if w in ACTION_VERBS:
        return True
    bases = {w}
    if w.endswith("ies"):
        bases.add(w[:-3] + "y")  # "applies" -> "apply"
    if w.endswith("es"):
        bases.add(w[:-2])  # "fixes" -> "fix"
    if w.endswith("s"):
        bases.add(w[:-1])  # "leads" -> "lead"
    for base in bases:
        if _IRREGULAR_PRESENT.get(base) in ACTION_VERBS:
            return True
        past = {base + "ed", base + "d", base[:-1] + "ied" if base.endswith("y") else "", base + base[-1:] + "ed"}
        if past & ACTION_VERBS:
            return True
    return False

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

# "I", but not the I in "I/O" or "CI/CD".
_PRONOUN = re.compile(r"(?<![\w/])I(?![\w/])|\b(?:me|my|mine|myself|My|Me)\b")
# Results said in words: "doubled sign-ups", "cut hundreds of hours".
# ...and how often, which recruiters and checkers like Resume Worded count as sizing a result ("a weekly report").
_NUMBER_WORDS = re.compile(r"\b(?:doubl|tripl|quadrupl|halv)(?:ed|ing|es)\b|\b(?:dozens|hundreds|thousands|millions|"
                           r"billions|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|fifty|"
                           r"daily|weekly|biweekly|monthly|quarterly|annually|yearly|every (?:day|week|sprint|month|"
                           r"quarter|release))\b", re.IGNORECASE)
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
_WORD = re.compile(r"[A-Za-z][A-Za-z0-9+#.\-']*")
_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")


def word_count(data: ResumeData) -> int:
    """The resume's length as the "300-1,000 words" check counts it."""
    return len(_words(resume_text(data)))


def _words(text: str) -> list[str]:
    return _WORD.findall(text)


def is_quantified(text: str) -> bool:
    """The bullet sizes its result: a figure (40%, $2M, 1,500, 3x; not the 3 in "S3", "Q3" or "24/7", not a year) or
    a number in words ("doubled", "hundreds of")."""
    return bool(_figures(text) or _NUMBER_WORDS.search(text) or re.search(r"[₹€£]\s?\d", text))


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
        lines += [f"{ed.degree} {ed.field} {ed.school}", ed.grade, ed.details]
    for c in data.certifications:
        lines += [f"{c.name} {c.issuer}"]
    for x in data.extras:
        lines += [x.title, *x.items]
    return "\n".join(line for line in lines if line and line.strip())


def _bullets(data: ResumeData, *, projects: bool = False) -> Iterator[tuple[str, str]]:
    """(path, text) of every non-empty experience bullet, or with `projects` every project bullet."""
    section = "projects" if projects else "experience"
    entries = [(p.id, p.bullets) for p in data.projects] if projects else [(e.id, e.bullets) for e in data.experience]
    for id_, texts in entries:
        for i, text in enumerate(texts):
            if text.strip():
                yield f"{section}.{id_}.bullets.{i}", text.strip()


# ---- job keywords --------------------------------------------------------------------------------------------

# Skills and tools recruiters search for. Multi-word terms first so "machine learning" wins over "learning".
SKILL_VOCAB: tuple[str, ...] = tuple(sorted({
    # engineering
    "python", "java", "javascript", "typescript", "go", "golang", "rust", "c++", "c#", "ruby", "php", "kotlin", "swift",
    "scala", "sql", "nosql", "html", "css", "react", "angular", "vue", "node.js", "next.js", "django", "flask",
    "fastapi", "spring", "ruby on rails", ".net", "graphql", "rest", "grpc", "microservices", "kubernetes", "docker",
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
SKILL_VOCAB_SET = frozenset(SKILL_VOCAB)

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
remote hybrid onsite pto benefits salary equity bonus insurance dental vision
""".split())


_LIST_LEAD = frozenset({",", "(", "/", "and", "or", "with", "in", "using", "like", "via", "including", "of"})
# Job-post boilerplate that looks like a product name or acronym: titles, time zones, places, legal lines.
_BOILERPLATE = frozenset("""
eeo eoe est edt pst pdt cst cdt mst gmt utc ist cet us usa uk eu emea apac latam hq llc inc ltd coo cmo cio svp evp
avp asap ote dei pto wfh nyc sf la ada
""".split()) | _GENERIC
# Where the job is, not what it needs: "Austin, TX", "Offices in Bengaluru and London", "Location: Texas". A US state's
# two-letter code counts only right after a city ("Austin, TX"): some are skills on their own ("AR/VR", "ML, IN").
_US_STATES = frozenset("""
al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh ok or pa ri sc
sd tn tx ut vt va wa wv wi wy dc
""".split())
_PLACES = frozenset("""
alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana
iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska
nevada ohio oklahoma oregon pennsylvania tennessee texas utah vermont virginia wisconsin wyoming carolina dakota jersey
austin seattle boston chicago denver atlanta dallas houston miami portland nashville raleigh charlotte pittsburgh
philadelphia detroit minneapolis baltimore orlando tampa sacramento columbus cincinnati cleveland indianapolis
milwaukee omaha tucson albuquerque boise bellevue redmond sunnyvale cupertino palo alto menlo oakland irvine plano
bentonville san francisco jose diego antonio angeles los las vegas york brooklyn manhattan
bengaluru bangalore mumbai bombay delhi gurgaon gurugram noida hyderabad pune chennai madras kolkata calcutta
ahmedabad jaipur kochi cochin chandigarh indore coimbatore trivandrum thiruvananthapuram mysore mysuru nagpur lucknow
bhubaneswar vizag visakhapatnam surat vadodara mohali srinagar jammu kashmir karnataka maharashtra telangana kerala
gujarat rajasthan haryana punjab bengal pradesh odisha
london manchester edinburgh glasgow birmingham cambridge oxford dublin cork belfast berlin munich hamburg frankfurt
cologne stuttgart paris lyon amsterdam rotterdam utrecht brussels antwerp zurich geneva basel vienna prague warsaw
krakow budapest lisbon porto madrid barcelona valencia milan rome turin stockholm gothenburg oslo copenhagen helsinki
tallinn riga vilnius athens istanbul bucharest belgrade zagreb kyiv toronto vancouver montreal ottawa calgary
waterloo guadalajara bogota medellin lima santiago buenos aires paulo janeiro singapore tokyo osaka seoul beijing
shanghai shenzhen hangzhou taipei hong kong manila jakarta bangkok hanoi kuala lumpur dubai abu dhabi doha riyadh
jeddah cairo nairobi lagos johannesburg sydney melbourne brisbane perth auckland wellington
india canada germany france ireland netherlands spain portugal italy poland sweden norway denmark finland switzerland
austria belgium romania ukraine israel egypt kenya nigeria australia zealand japan korea china taiwan philippines
indonesia vietnam thailand malaysia brazil argentina chile colombia peru mexico emirates uae qatar arabia europe
america americas asia africa nordics
""".split())
_CITY_STATE = re.compile(r"\b([A-Z][a-z]+(?:[ -][A-Z][a-z]+){0,2}),\s?([A-Z]{2})\b(?!\s*(?:/|&|and)\s*VR)")


@lru_cache(maxsize=128)
def _places_in(job_text: str) -> frozenset[str]:
    """Places this post names as "City, ST" (each of the city's words and the code), as `_norm` keys."""
    found: set[str] = set()
    for m in _CITY_STATE.finditer(job_text):
        city, code = m.group(1), m.group(2).lower()
        if code in _US_STATES and _norm(city) not in SKILL_VOCAB:
            found.add(code)
            found.update(_norm(w) for w in re.split(r"[ -]", city))
    return frozenset(found)


# Skills that are also everyday words ("go to market", "excel in", "the rest", "Spring 2025", "a lean team"): only
# counted when the post writes them as the product, capitalised mid-sentence.
_AMBIGUOUS = {"go": "Go", "react": "React", "rest": "REST", "excel": "Excel", "spring": "Spring", "lean": "Lean",
              "swift": "Swift", "spark": "Spark", "ruby": "Ruby"}


def _as_product(job_text: str, written: str) -> int:
    """How often `written` ("Go", "Excel") appears capitalised mid-sentence: not as a season, not a sentence's first
    word."""
    n = 0
    for m in re.finditer(r"(?<![A-Za-z0-9])" + re.escape(written) + r"(?![A-Za-z0-9])", job_text):
        before = job_text[:m.start()].rstrip(" \t")
        if not before or before[-1] in ".!?:\n•*-–—" or re.match(r"\s+(?:19|20)\d\d", job_text[m.end():]):
            continue
        n += 1
    return n


# Skills that are also topic words in a sentence ("40% of mobile bookings", "embedded with the sales team"): counted
# only where a word beside them makes them the skill ("mobile apps", "iOS and Android", "embedded systems"), or as an
# item of their own in a list of skills ("Swift, Kotlin, mobile"). Each has what may follow it, and what may come
# just before it. A Skills section lists them as they are (`names_skill`).
_IN_CONTEXT: dict[str, tuple[re.Pattern[str], re.Pattern[str] | None]] = {
    "mobile": (
        re.compile(r"(?:\s*(?:and|&|/)\s*web)?[\s-]+(?:apps?|applications?|development|developers?|dev|engineers?|"
                   r"engineering|platforms?|sdks?|ui|ux|testing|games?|first|frontend|front-end)(?![a-z0-9])"
                   r"|\s*[(:/–-]\s*(?:ios|android)(?![a-z0-9])"),
        re.compile(r"(?<![a-z0-9])(?:ios|android|cross-platform|react native|flutter)"
                   r"(?:\s*(?:and|&|/|or)\s*(?:ios|android))?[\s-]*$")),
    "embedded": (
        re.compile(r"[\s-]+(?:systems?|software|firmware|c|c\+\+|linux|devices?|hardware|engineers?|engineering|"
                   r"development|developers?|programming|controllers?|rtos)(?![a-z0-9])"),
        None),
}
# Skills a sentence can use as ordinary words: `skill_mentions` reads them more carefully than the rest.
_PROSE_WORDS = frozenset(_AMBIGUOUS) | frozenset(_IN_CONTEXT)
_LIST_SEP = re.compile(r"[,;|/•·()]|:\s|\s(?:and|or|&)\s")
_SKILLS_LINE = re.compile(r"^\W*(?:(?:key|core|technical|tech)\s+)?(?:skills|tools|technologies|tech stack|stack|"
                          r"platforms|requirements|must[- ]haves?|nice[- ]to[- ]haves?)\s*:")


def _listed(text: str, start: int, end: int) -> bool:
    """`text[start:end]` (lowercased) is an item of its own on its line: in a skills line ("Tools: mobile, Figma"),
    beside another known skill ("Swift, Kotlin, mobile"), or alone ("• Mobile", a skills group of one)."""
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", end)
    before = _LIST_SEP.split(text[line_start:start])
    after = _LIST_SEP.split(text[end:] if line_end < 0 else text[end:line_end])
    if before[-1].strip(" \t-*•") or after[0].strip(" \t.!"):
        return False  # part of a phrase: "mobile bookings", "on mobile"
    if _SKILLS_LINE.match(text[line_start:start]):
        return True
    prev = [i for i in (x.strip(" \t-*•.:") for x in before[:-1]) if i]
    nxt = [i for i in (x.strip(" \t-*•.:!") for x in after[1:]) if i]
    near = prev[-1:] + nxt[:1]
    return not near or any(i in SKILL_VOCAB_SET or i in _SYNONYM_OF for i in near)


def skill_mentions(term: str, text: str, norm: str | None = None) -> int:
    """How often prose (a job post, a resume's bullets) names the vocabulary skill `term`: an everyday word only as the
    product ("Go", "Excel"), a topic word only where it's the skill ("mobile apps"), any other skill anywhere. `norm`
    is `_norm(text)`, when the caller has it already."""
    if term in _AMBIGUOUS:
        return _as_product(text, _AMBIGUOUS[term])
    if term in _IN_CONTEXT:
        after, before = _IN_CONTEXT[term]
        low = text.lower()  # not _norm: that joins the lines, and a list is read line by line

        def as_skill(m: re.Match[str]) -> bool:
            return bool(after.match(low, m.end())
                        or (before and before.search(low, max(0, m.start() - 40), m.start()))
                        or _listed(low, m.start(), m.end()))

        return sum(1 for m in _term_pattern(term).finditer(low) if as_skill(m))
    return len(_term_pattern(term).findall(_norm(text) if norm is None else norm))


def names_skill(form: str, text: str, norm: str, listed: str) -> bool:
    """Whether a resume or profile names the skill `form`: `text` is all of it (`norm` the same through `_norm`),
    `listed` its Skills section through `_norm`. A listed skill counts as written; elsewhere an everyday-word skill has
    to read as the skill (`skill_mentions`): "mobile bookings" doesn't make someone a mobile developer."""
    key = form.lower()
    if key in _PROSE_WORDS:
        return bool(_term_pattern(key).search(listed)) or skill_mentions(key, text, norm) > 0
    return bool(_term_pattern(form).search(norm))


def pretty_term(term: str, *texts: str) -> str:
    """The way the term is written in the first text that has it (with a capital), else a sensible casing."""
    for text in texts:
        m = re.search(r"(?<![A-Za-z0-9])" + re.escape(term) + r"(?![A-Za-z0-9+#])", text, re.IGNORECASE)
        if m and m.group(0) != m.group(0).lower():
            return m.group(0)
    if "/" in term and all(len(p) <= 4 for p in term.split("/")):
        return term.upper()
    if len(term) <= 3 and " " not in term:
        return term.upper()
    return " ".join(w if w.isupper() else w[:1].upper() + w[1:] for w in term.split(" "))


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


# Enough for any real job post; the rest can't change the keywords much, and every extra word costs a regex.
MAX_JOB_SCORE_CHARS = 8_000


def extract_keywords(job_text: str, limit: int = 20) -> list[str]:
    """Cached: re-scoring as the candidate types keeps the same job post (and the work is regexes over all of it)."""
    return list(_extract_keywords(job_text[:MAX_JOB_SCORE_CHARS], limit))


@lru_cache(maxsize=128)
def _extract_keywords(job_text: str, limit: int) -> tuple[str, ...]:
    """The job post's most searchable terms: known skills first, then product/tech names, then repeated words."""
    norm = _norm(job_text)
    places = _places_in(job_text) | _PLACES
    scores: Counter[str] = Counter()
    display: dict[str, str] = {}
    covered: list[str] = []
    for term in SKILL_VOCAB:
        n = skill_mentions(term, job_text, norm)
        if n and not any(term in bigger for bigger in covered):  # "learning" inside "machine learning"
            scores[term] += 3 * n + 10
            # "AWS", "PostgreSQL": the chip is added to the resume as shown.
            display[term] = _AMBIGUOUS.get(term) or pretty_term(term, job_text)
            covered.append(term)
    # Product and tech names. CamelCase and acronyms anywhere mid-sentence ("GraphQL", "SOC2"); a plain capitalised
    # word ("Datadog") only in a list-like spot ("with X", "in X", "X, Y", "(X)"), so a company name after "at" or a
    # job title isn't mistaken for a skill.
    # (A lowercase word must be followed by a space: "gRPC" is one word, not "g" then "RPC".)
    for m in re.finditer(r"(?:(\b[a-z]+\s|[,(/]\s?))([A-Z][a-z]*[A-Z][A-Za-z0-9]*|[A-Z]{2,6}[0-9]?|[A-Z][a-z]{2,})\b",
                         job_text):
        before, word = m.group(1).strip(), m.group(2)
        plain = word[0].isupper() and word[1:].islower()
        if plain and before not in _LIST_LEAD:
            continue
        key = _norm(word)
        if (key in _STOP or key.rstrip("s") in _STOP or key in _BOILERPLATE or key in scores or key in _PROSE_WORDS
                or key in places or _part_of(key, covered)):
            continue
        scores[key] += 4
        display.setdefault(key, word)
    # (Nor is a skill that's also an everyday word one by being said often: "mobile" three times isn't "mobile apps".)
    counts = Counter(w for w in re.findall(r"[a-z][a-z+#-]{3,}", norm)
                     if w not in _STOP and w not in _PROSE_WORDS and w not in places)
    # The most repeated few only: each is another pass over the post, and a post of a thousand words said three
    # times each would otherwise cost a thousand passes.
    for word, n in counts.most_common(60):
        if n < 3:
            break
        if not any(word in k for k in scores):
            # Capitalised every time it appears: the company's own name ("Brightline"), not a skill.
            seen = re.findall(r"(?<![A-Za-z])" + re.escape(word) + r"(?![A-Za-z])", job_text, re.IGNORECASE)
            if seen and all(s[0].isupper() for s in seen):
                continue
            scores[word] += n
            display.setdefault(word, word)
    return tuple(display[k] for k, _ in scores.most_common(limit))


# The same thing written another way: a resume that says "k8s" has the job post's "Kubernetes" (as Jobscan and Teal
# count it). Both directions: the post may use either form.
SYNONYMS: tuple[frozenset[str], ...] = tuple(frozenset(g) for g in (
    {"javascript", "js"}, {"typescript", "ts"}, {"kubernetes", "k8s"}, {"postgresql", "postgres", "psql"},
    {"aws", "amazon web services"}, {"gcp", "google cloud", "google cloud platform"}, {"azure", "microsoft azure"},
    {"machine learning", "ml"}, {"artificial intelligence", "ai"}, {"natural language processing", "nlp"},
    {"ci/cd", "continuous integration", "continuous delivery", "continuous deployment"},
    {"node.js", "nodejs", "node"}, {"react", "react.js", "reactjs"}, {"vue", "vue.js", "vuejs"},
    {"c#", "csharp"}, {"user experience", "ux"}, {"user interface", "ui"},
    {"search engine optimization", "seo"}, {"customer relationship management", "crm"},
    {"a/b testing", "ab testing", "split testing"},
    {"power bi", "powerbi"}, {"rest", "restful", "rest api", "rest apis"}, {"sql", "structured query language"},
))
_SYNONYM_OF = {term: group for group in SYNONYMS for term in group}


def match_keywords(keywords: list[str], data: ResumeData) -> AtsKeywords:
    raw = resume_text(data)
    text = _norm(raw)
    listed = _norm("\n".join(i for s in data.skills for i in s.items))
    matched: list[str] = []
    missing: list[str] = []
    for kw in keywords:
        forms = _SYNONYM_OF.get(kw.lower(), frozenset({kw}))
        found = any(names_skill(f, raw, text, listed) for f in forms | {kw})
        (matched if found else missing).append(kw)
    return AtsKeywords(matched=matched, missing=missing)


# ---- scoring -------------------------------------------------------------------------------------------------


def _check(checks: list[AtsCheck], id_: str, category: Category, label: str, max_points: float, ratio: float,
           fix: str | None, target: str | None = None, ai_fixable: bool = False, *, kind: FixKind | None = None,
           paths: list[str] | None = None) -> None:
    """`kind` is how the problem gets fixed (default: "ai" when the AI can, else "you"); `paths` every line it's on."""
    ratio = max(0.0, min(1.0, ratio))
    passed = ratio >= 0.999
    kind = kind or ("ai" if ai_fixable else "you")
    checks.append(AtsCheck(id=id_, category=category, label=label, max_points=max_points,
                           points=round(max_points * ratio, 1), passed=passed, fix=None if passed else fix,
                           target=None if passed else target, ai_fixable=ai_fixable and not passed,
                           fix_kind=None if passed else kind, paths=[] if passed else list(paths or [])))


def _project_checks(checks: list[AtsCheck], projects: list[Project]) -> None:
    """A fresher's roles_complete and bullets_per_role: each project named, with what was built (a description or
    bullets), and 2-6 bullets, the way a role is held to a title, dates and 2-6 bullets."""
    complete = [p for p in projects if p.name.strip() and (p.description.strip() or any(x.strip() for x in p.bullets))]
    incomplete = next((p for p in projects if p not in complete), None)
    _check(checks, "roles_complete", "experience", "Every project has a name and what you built", 6,
           len(complete) / len(projects),
           f"Give \"{incomplete.name or 'each project'}\" a name and a line on what you built." if incomplete else None,
           f"projects.{incomplete.id}" if incomplete else None)
    counts = [len([x for x in p.bullets if x.strip()]) for p in projects]
    thin = next((p for p, n in zip(projects, counts, strict=True) if not 2 <= n <= 6), None)
    _check(checks, "bullets_per_role", "experience", "2-6 bullets per project", 4,
           sum(1 for n in counts if 2 <= n <= 6) / len(projects),
           f"Give \"{thin.name or 'each project'}\" 2-6 bullets: what you built, with what, and the result."
           if thin else None, f"projects.{thin.id}" if thin else None)


def _verdict(score: int) -> str:
    return "Strong" if score >= 80 else "Good" if score >= 65 else "Needs work" if score >= 45 else "Weak"


def score_resume(data: ResumeData, design: ResumeDesign | None = None, job_text: str = "") -> AtsReport:
    from orbit_api.resumes.fixes import date_suggestions  # fixes builds on this module's helpers

    design = design or ResumeDesign()
    data = data.visible()  # a hidden section isn't on the resume, so it can't count
    checks: list[AtsCheck] = []
    b = data.basics

    # contact (10)
    _check(checks, "name", "contact", "Your name at the top", 2, 1.0 if b.name.strip() else 0,
           "Add your full name: it's the first thing a parser looks for.", "basics.name")
    _check(checks, "email", "contact", "A valid email address", 3, 1.0 if _EMAIL.match(b.email.strip()) else 0,
           "Add an email address recruiters can reach you at.", "basics.email", kind="auto")  # the account's
    _check(checks, "phone", "contact", "A phone number", 2,
           1.0 if len(re.sub(r"\D", "", b.phone)) >= 7 else 0, "Add a phone number, with the country code.",
           "basics.phone")
    _check(checks, "location", "contact", "Your city or region", 1, 1.0 if b.location.strip() else 0,
           "Add your city and country (or \"Remote\"): recruiters filter by location.", "basics.location",
           kind="auto" if any(e.location.strip() for e in data.experience) else "you")  # the latest role's
    _check(checks, "link", "contact", "A LinkedIn or portfolio link", 2,
           1.0 if any(link.url.strip() for link in b.links) else 0,
           "Add your LinkedIn profile or portfolio link.", "basics.links")

    # sections (10)
    has_exp = any(e.title.strip() or e.company.strip() for e in data.experience)
    # A student or fresher with no job yet: their projects are judged the way roles are, and two with bullets count
    # as experience (an internship is a role already), so a strong first resume isn't scored as if it were empty.
    projects = [p for p in data.projects if p.name.strip() or any(x.strip() for x in p.bullets)]
    fresher = not has_exp and bool(projects)
    has_edu = any(e.school.strip() or e.degree.strip() for e in data.education)
    n_skills = sum(len([i for i in s.items if i.strip()]) for s in data.skills)
    _check(checks, "has_experience", "sections",
           "Experience: an internship, or 2+ projects with bullets" if fresher else "An Experience section", 4,
           1.0 if has_exp or sum(1 for p in projects if any(x.strip() for x in p.bullets)) >= 2 else 0,
           "Add your work experience: it's what ATS software weighs most. Internships and volunteer roles count, and "
           "so do two projects with bullets if you're a student.", "experience")
    _check(checks, "has_education", "sections", "An Education section", 3, 1.0 if has_edu else 0,
           "Add your education: many ATS filters check for a degree or school.", "education")
    _check(checks, "has_skills", "sections", "A Skills section", 3, 1.0 if n_skills else 0,
           "Add a Skills section: recruiters search it first.", "skills", ai_fixable=True)

    # summary (4)
    summary_words = len(_words(b.summary))
    _check(checks, "summary", "summary", "A summary of 25-90 words", 4,
           0 if not summary_words else 1.0 if 25 <= summary_words <= 90 else 0.5,
           "Add a 2-3 sentence summary: who you are, your strongest skills, and what you're looking for."
           if not summary_words else
           f"Your summary has {summary_words} words; aim for 25-90 so it's read in full.",
           "basics.summary", ai_fixable=True)

    # experience (26)
    roles = [e for e in data.experience if e.title.strip() or e.company.strip()]
    bullets = list(_bullets(data, projects=fresher))
    if fresher:
        _project_checks(checks, projects)
    else:
        complete = [e for e in roles if e.title.strip() and e.company.strip() and e.start.strip()
                    and (e.end.strip() or e.current)]
        incomplete = next((e for e in roles if e not in complete), None)
        _check(checks, "roles_complete", "experience", "Every role has a title, company and dates", 6,
               len(complete) / len(roles) if roles else 0,
               f"Fill in the title, company and dates for {incomplete.title or incomplete.company or 'each role'}."
               if incomplete else "Add at least one role with a title, company and dates.",
               f"experience.{incomplete.id}" if incomplete else "experience")
        def count(e: Experience) -> int:
            return len([x for x in e.bullets if x.strip()])

        thin = next((e for e in roles if not 2 <= count(e) <= 6), None)
        too_few = any(count(e) < 2 for e in roles)
        _check(checks, "bullets_per_role", "experience", "2-6 bullets per role", 4,
               (sum(1 for e in roles if 2 <= count(e) <= 6) / len(roles)) if roles else 0,
               (f"Trim \"{thin.title or thin.company}\" to its 6 strongest bullets: more gets skimmed."
                if thin and count(thin) > 6 else
                f"Give \"{thin.title or thin.company}\" 2-6 bullets: fewer looks thin, more gets skimmed.") if thin
               else "Add 2-6 bullets to each role.", f"experience.{thin.id}" if thin else "experience",
               # Too few: the AI drafts some (for review). Too many: the weakest go, free (resumes/autofix.py).
               ai_fixable=too_few, kind="ai" if too_few else "auto" if roles else None,
               paths=[f"experience.{e.id}.bullets.+" for e in roles if count(e) < 2])

    if bullets:
        weak = [(p, t) for p, t in bullets if not is_action_verb(_first_word(t))]
        _check(checks, "action_verbs", "experience", "Bullets start with an action verb", 4,
               1 - len(weak) / len(bullets),
               f"{len(bullets) - len(weak)} of {len(bullets)} bullets start with an action verb. Lead with what you "
               "did: Led, Built, Reduced, Launched.", weak[0][0] if weak else None, ai_fixable=True,
               paths=[p for p, _ in weak])
        unquantified = [(p, t) for p, t in bullets if not is_quantified(t)]
        quantified = len(bullets) - len(unquantified)
        _check(checks, "quantified", "experience", "At least half the bullets have a number", 7,
               min(1.0, quantified / (len(bullets) * 0.5)),
               f"{quantified} of {len(bullets)} bullets have a number. Add the size of the result: %, $, time saved, "
               "users, team size.", unquantified[0][0] if unquantified else None, ai_fixable=True,
               paths=[p for p, _ in unquantified])
        bad_len = [(p, t) for p, t in bullets if not 8 <= len(_words(t)) <= 35]
        _check(checks, "bullet_length", "experience", "Bullets are 8-35 words", 3, 1 - len(bad_len) / len(bullets),
               "Keep each bullet to one line or two: 8-35 words.", bad_len[0][0] if bad_len else None,
               ai_fixable=True, paths=[p for p, _ in bad_len])
        # The same opening verb over and over reads as padding: allow it on about one bullet in five, at least twice.
        openers = Counter(_first_word(t) for _, t in bullets)
        allowed = max(2, -(-len(bullets) // 5))
        overused = [(w, n) for w, n in openers.most_common() if w and n > allowed]
        repeat_at = None
        repeated: list[str] = []  # the ones past the allowance, for each overused opener
        for word, _ in overused:
            repeated += [p for p, t in bullets if _first_word(t) == word][allowed:]
        if overused:
            repeat_at = repeated[0]
        _check(checks, "varied_verbs", "experience", "Opening verbs are varied", 1, 0 if overused else 1.0,
               (f"{overused[0][1]} bullets start with \"{overused[0][0].capitalize()}\". Vary them"
                + (f": {VERB_ALTERNATIVES[overused[0][0]]}." if overused[0][0] in VERB_ALTERNATIVES else ".")
                ) if overused else None, repeat_at, ai_fixable=True, paths=repeated)
        first_person = [(p, t) for p, t in bullets if _PRONOUN.search(t)]
        _check(checks, "no_pronouns", "experience", "No \"I\" or \"my\" in bullets", 1,
               1 - len(first_person) / len(bullets),
               "Drop \"I\" and \"my\": resume bullets start with the verb.",
               first_person[0][0] if first_person else None, ai_fixable=True, paths=[p for p, _ in first_person])
    else:
        for id_, label, pts in (("action_verbs", "Bullets start with an action verb", 4),
                                ("quantified", "At least half the bullets have a number", 7),
                                ("bullet_length", "Bullets are 8-35 words", 3),
                                ("varied_verbs", "Opening verbs are varied", 1),
                                ("no_pronouns", "No \"I\" or \"my\" in bullets", 1)):
            _check(checks, id_, "experience", label, pts, 0,
                   "Add bullets to each project: what you built, with what, and the result." if fresher
                   else "Add bullets describing what you achieved in each role.",
                   "projects" if fresher else "experience", ai_fixable=bool(roles),
                   paths=[f"experience.{e.id}.bullets.+" for e in roles])

    # skills (7)
    _check(checks, "skills_count", "skills", "At least 8 skills listed", 7, n_skills / 8,
           f"You list {n_skills} skill{'s' if n_skills != 1 else ''}; list at least 8 tools, languages and methods you "
           "really use.", "skills", ai_fixable=True)

    # readability (14: clear_writing and tech_names are line by line, see lint.py)
    total_words = len(_words(resume_text(data)))
    _check(checks, "length", "readability", "300-1,000 words (1-2 pages)", 3,
           1.0 if 300 <= total_words <= 1000 else total_words / 300 if total_words < 300 else 0.5,
           f"The resume has {total_words} words: " + ("add more detail to your roles." if total_words < 300 else
                                                      "trim it to the last 10-15 years and your best results."),
           "experience", ai_fixable=bool(roles))  # the AI adds detail (or tightens) from what the resume says
    # Roles only: education written as years ("2016") is normal next to "Jan 2020" for jobs.
    styles = {s for e in data.experience for s in (date_style(e.start), date_style(e.end)) if s}
    _check(checks, "dates", "readability", "Dates written one way", 2,
           1.0 if len(styles) <= 1 and "other" not in styles else 0,
           "Write every date the same way, e.g. \"Jan 2021\", so a parser can work out each role's length.",
           "experience", ai_fixable=bool(date_suggestions(data)), kind="auto" if date_suggestions(data) else "you")
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
           0 if order_fix else 1.0, order_fix[0] if order_fix else None, order_fix[1] if order_fix else None,
           kind="auto" if order_fix and order_fix[0].startswith("List roles") else "you")  # sorting is mechanical
    fields = [(p, t) for p, t in text_fields(data) if t.strip()]
    unfilled = [(p, m.group(0)) for p, t in fields if (m := PLACEHOLDER.search(t))]
    n_unfilled = len(unfilled)
    _check(checks, "placeholders", "readability", "No [placeholders] left to fill", 2, 0 if unfilled else 1.0,
           (f"{n_unfilled} line{'s' if n_unfilled != 1 else ''} still {'have' if n_unfilled != 1 else 'has'} a "
            f"placeholder like {unfilled[0][1]}: rewrite {'them' if n_unfilled != 1 else 'it'} as finished text, "
            "using a real number if you have one, or it prints as-is."
            ) if unfilled else None, unfilled[0][0] if unfilled else None,
           ai_fixable=bool(unfilled),  # the AI rewrites them complete, without inventing a number
           paths=[p for p, _ in unfilled])
    cliched = [(p, m.group(1)) for p, t in fields if (m := _CLICHE.search(t))]
    _check(checks, "cliches", "readability", "No clichés like \"team player\"", 1, 0 if cliched else 1.0,
           (f"\"{cliched[0][1]}\" claims a quality instead of showing it. Replace it with what you did that proves it."
            ) if cliched else None, cliched[0][0] if cliched else None,
           ai_fixable=bool(cliched) and not cliched[0][0].startswith(("education.", "extras.")),
           paths=[p for p, _ in cliched if not p.startswith(("education.", "extras."))])
    issues = line_issues(data)
    unclear = [i for i in issues if i.kind != "casing"]
    unclear_lines = {i.path for i in unclear}
    n_bullets = line_count(data) or 1
    _check(checks, "clear_writing", "readability", "Every line reads clearly (strong opener, active, no filler)", 3,
           1 - len(unclear_lines) / n_bullets,
           (f"{len(unclear_lines)} line{'s' if len(unclear_lines) != 1 else ''} could read stronger. First: "
            f"{unclear[0].message} Fix weak openers (\"Responsible for\", \"Helped\"), the passive voice, filler words "
            "and a past role written in the present tense.") if unclear else None,
           unclear[0].path if unclear else None, ai_fixable=bool(unclear), paths=sorted(unclear_lines))
    miscased = [i for i in issues if i.kind == "casing"]
    _check(checks, "tech_names", "readability", "Tools and tech spelled the standard way", 1, 0 if miscased else 1.0,
           miscased[0].message if miscased else None, miscased[0].path if miscased else None,
           ai_fixable=bool(miscased), kind="auto",  # fixed mechanically (fixes.casing_suggestions): no AI, no credit
           paths=[i.path for i in miscased])

    # layout (4)
    _check(checks, "single_column", "layout", "Single-column template", 2, 0 if design.template == "sidebar" else 1.0,
           "Two-column layouts can be read out of order by ATS software. Pick Classic, Modern or Compact.",
           "design.template", kind="auto")
    photo = design.show_photo and bool(design.photo)
    _check(checks, "no_photo", "layout", "No photo", 2, 0 if photo else 1.0,
           "Most ATS software ignores photos, and US, UK and Canadian employers often screen them out. Hide it "
           "unless photos are expected where you apply.", "design.photo", kind="auto")

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
                     has_job=has_job, issues=issues)
