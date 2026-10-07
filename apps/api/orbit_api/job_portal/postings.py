"""What every source's job post is normalized to, and the reading of its free text: where it is (Indian cities,
remote, open to India or not), how senior it is, what kind of job, a short snippet, and the key that spots the same
job posted twice.

Sources fill in a `Posting` from their own fields; `normalize` turns it into a listing row, or None when the post
isn't one to show (too old, not in India and not remote-open to India, no title or link).
"""

import hashlib
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from html import unescape
from typing import Any, Literal

from orbit_api.job_portal.skills import KEYWORDS_VERSION
from orbit_api.prep.job_link import html_to_text

Workplace = Literal["remote", "hybrid", "onsite"]
EmploymentType = Literal["full_time", "part_time", "contract", "internship"]
Level = Literal["fresher", "junior", "mid", "senior"]
LEVELS: tuple[Level, ...] = ("fresher", "junior", "mid", "senior")

MAX_AGE = timedelta(days=30)  # older posts are dropped: most are filled or stale by then
MAX_DESCRIPTION = 20_000
SNIPPET_CHARS = 500


@dataclass
class Posting:
    """One job post as a source read it. `description` is plain text (`text_of` turns HTML into it)."""

    source: str
    external_id: str
    board: str
    company: str
    title: str
    url: str
    apply_url: str
    posted_at: datetime | None
    locations: list[str] = field(default_factory=list)
    description: str = ""
    workplace: Workplace | None = None
    employment_type: EmploymentType | None = None
    salary: str | None = None
    country: str | None = None  # an explicit ISO country code from the source ("IN")
    # The source already limited its results to jobs open to people in India (e.g. Himalayas' country=IN).
    open_to_india: bool = False
    # A remote post that names no region counts as open to India (an India-first company's own board).
    remote_unstated_ok: bool = False
    level: Level | None = None  # the source's own seniority label, when the title has none
    # Listed without its text (SmartRecruiters' list): the text and links already cached for it are kept.
    partial: bool = False


# ---- places --------------------------------------------------------------------------------------------------

# Canonical name -> the ways posts write it. Matched as whole words, case-insensitively.
CITIES: dict[str, tuple[str, ...]] = {
    "Bengaluru": ("bengaluru", "bangalore", "banglore", "blr"),
    "Mumbai": ("mumbai", "bombay", "navi mumbai", "thane", "powai"),
    "Delhi": ("new delhi", "delhi", "delhi ncr", "ncr"),
    "Gurugram": ("gurugram", "gurgaon"),
    "Noida": ("noida", "greater noida"),
    "Hyderabad": ("hyderabad", "secunderabad"),
    "Chennai": ("chennai", "madras"),
    "Pune": ("pune",),
    "Kolkata": ("kolkata", "calcutta"),
    "Ahmedabad": ("ahmedabad", "gandhinagar"),
    "Jaipur": ("jaipur",),
    "Kochi": ("kochi", "cochin", "ernakulam"),
    "Coimbatore": ("coimbatore",),
    "Chandigarh": ("chandigarh", "mohali", "panchkula"),
    "Indore": ("indore",),
    "Thiruvananthapuram": ("thiruvananthapuram", "trivandrum"),
    "Bhubaneswar": ("bhubaneswar",),
    "Nagpur": ("nagpur",),
    "Lucknow": ("lucknow",),
    "Mysuru": ("mysuru", "mysore"),
    "Visakhapatnam": ("visakhapatnam", "vizag"),
    "Vadodara": ("vadodara", "baroda"),
    "Surat": ("surat",),
    "Goa": ("goa", "panaji"),
    "Mangaluru": ("mangaluru", "mangalore"),
    "Bhopal": ("bhopal",),
    "Guwahati": ("guwahati",),
    "Dehradun": ("dehradun",),
    "Nashik": ("nashik",),
    "Madurai": ("madurai",),
}
_CITY_OF = {alias: name for name, aliases in CITIES.items() for alias in (*aliases, name.lower())}
_CITY_RE = re.compile(r"(?<![a-z])(" + "|".join(sorted(map(re.escape, _CITY_OF), key=len, reverse=True))
                      + r")(?![a-z])")
_INDIA_RE = re.compile(r"(?<![a-z])(india|bharat)(?![a-z])")
# Remote posts open to India: worldwide, or a region India is in.
_OPEN_RE = re.compile(r"(?<![a-z])(anywhere|worldwide|world ?wide|global(?:ly)?|international|apac|"
                      r"asia(?:[ -]pacific)?|south ?asia|ist|utc ?\+ ?5(?::30)?|gmt ?\+ ?5(?::30)?)(?![a-z])")
# Remote posts for somewhere else.
_ELSEWHERE_RE = re.compile(
    r"(?<![a-z])(us|usa|u\.s\.|united states|americas?|north america|canada|mexico|latam|latin america|brazil|"
    r"argentina|uk|united kingdom|england|ireland|europe|eu|emea|germany|france|spain|portugal|netherlands|poland|"
    r"romania|italy|sweden|switzerland|australia|new zealand|anz|singapore|philippines|japan|china|hong kong|korea|"
    r"vietnam|thailand|indonesia|malaysia|israel|uae|dubai|saudi|south africa|nigeria|kenya|egypt|pakistan|"
    r"bangladesh|sri lanka|est|pst|cst|cet|[a-z ]+, [a-z]{2} \d{5})(?![a-z])")


def find_cities(text: str) -> list[str]:
    """The Indian cities a location text names, canonical and in order ("Bangalore / Gurgaon" -> Bengaluru,
    Gurugram)."""
    out: list[str] = []
    for m in _CITY_RE.finditer(text.lower()):
        city = _CITY_OF[m.group(1)]
        if city not in out:
            out.append(city)
    return out


def canonical_city(name: str) -> str | None:
    found = find_cities(name)
    return found[0] if found else None


def mentions_india(text: str) -> bool:
    low = text.lower()
    return bool(_INDIA_RE.search(low) or _CITY_RE.search(low))


def worth_reading(where: str, *, remote: bool = False, country: str | None = None) -> bool:
    """Before reading a post's text (the slow part): could it be listed at all? In India, or remote. Global boards
    have hundreds of posts elsewhere."""
    return remote or (country or "").upper() == "IN" or mentions_india(where) or workplace_of(where) == "remote"


def remote_region(text: str) -> Literal["india", "open", "elsewhere"] | None:
    """For a remote post: is it open to someone in India? None when the text doesn't say."""
    low = text.lower()
    if mentions_india(low):
        return "india"
    if _OPEN_RE.search(low):
        return "open"
    if _ELSEWHERE_RE.search(low):
        return "elsewhere"
    return None


# ---- kind of job and seniority ---------------------------------------------------------------------------------

_REMOTE_RE = re.compile(r"(?<![a-z])(remote|work from home|wfh|anywhere|distributed)(?![a-z])")
_HYBRID_RE = re.compile(r"(?<![a-z])hybrid(?![a-z])")
_ONSITE_RE = re.compile(r"(?<![a-z])(on[- ]?site|in[- ]office|office[- ]based|work from office|wfo)(?![a-z])")


def workplace_of(*texts: str) -> Workplace | None:
    """Remote / hybrid / onsite as a location or title states it (hybrid wins over remote: "Hybrid - remote 2 days")."""
    low = " ".join(texts).lower()
    if _HYBRID_RE.search(low):
        return "hybrid"
    if _REMOTE_RE.search(low):
        return "remote"
    if _ONSITE_RE.search(low):
        return "onsite"
    return None


def employment_type_of(text: str) -> EmploymentType | None:
    low = re.sub(r"[\s_-]+", " ", text.lower())
    if re.search(r"\b(intern|internship|trainee|apprentice)", low):
        return "internship"
    if re.search(r"\b(contract|contractor|freelance|temporary|temp|fixed term)\b", low):
        return "contract"
    if re.search(r"\bpart time\b|\bparttime\b", low):
        return "part_time"
    if re.search(r"\b(full time|fulltime|permanent|regular)\b", low):
        return "full_time"
    return None


_FRESHER = re.compile(r"(?<![a-z])(intern|internship|trainee|fresher|freshers|graduate|grad|entry[- ]level|"
                      r"apprentice|campus|new grad)(?![a-z])")
# Not "manager": an Assistant or Associate Product Manager isn't senior; the years the post asks for decide.
_SENIOR = re.compile(r"(?<![a-z])(senior|sr|staff|principal|lead|architect|head|director|vp|vice president|"
                     r"sde ?-? ?(?:iii|3|iv|4)|(?:engineer|developer) ?(?:iii|iv|3|4))(?![a-z0-9])")
_JUNIOR = re.compile(r"(?<![a-z])(junior|jr|associate|sde ?-? ?(?:i|1)|(?:engineer|developer|analyst) ?(?:i|1))"
                     r"(?![a-z0-9])")
_MID = re.compile(r"(?<![a-z])(sde ?-? ?(?:ii|2)|(?:engineer|developer|analyst) ?(?:ii|2))(?![a-z0-9])")
_YEARS_RANGE = re.compile(r"(?<![\d.])(\d{1,2})\s*\+?\s*(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b", re.I)
_YEARS_MIN = re.compile(
    r"(?:(?<![\d.])(\d{1,2})\s*\+\s*(?:years?|yrs?)\b|(?:minimum|min\.?|at least|over|more than)\s*(?:of\s*)?"
    r"(\d{1,2})\s*(?:years?|yrs?)\b|(?<![\d.])(\d{1,2})\s*(?:years?|yrs?)(?:'|’)?\s*(?:of\s+)?(?:[\w/+#.-]+\s+){0,4}"
    r"experience)", re.I)


_ABOVE_SENIOR = re.compile(r"(?<![a-z])(staff|principal|distinguished|director|head of|vp|vice president|"
                           r"chief)(?![a-z])")


def title_level(title: str) -> Level | None:
    low = title.lower()
    if _FRESHER.search(low):
        return "fresher"
    if _MID.search(low):
        return "mid"
    if _SENIOR.search(low):
        return "senior"
    if _JUNIOR.search(low):
        return "junior"
    return None


def level_for_years(years: float) -> Level:
    return "fresher" if years < 1 else "junior" if years < 3 else "mid" if years < 6 else "senior"


def experience_of(title: str, description: str) -> tuple[Level | None, int | None, int | None]:
    """(level, min years, max years) as far as the post says. The title's own word wins ("Senior ...")."""
    head = description[:6_000]
    lo = hi = None
    m = _YEARS_RANGE.search(head)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if a <= b <= 30:
            lo, hi = a, b
    if lo is None:
        m2 = _YEARS_MIN.search(head)
        if m2:
            n = int(next(g for g in m2.groups() if g))
            if n <= 25:
                lo = n
    level = title_level(title)
    if _ABOVE_SENIOR.search(title.lower()):
        lo = max(lo or 0, 7)  # staff, principal, director: well past "senior", whatever the post's minimum says
    if level is None and lo is not None:
        level = level_for_years(lo)
    return level, lo, hi


# ---- text ---------------------------------------------------------------------------------------------------

def text_of(value: Any) -> str:
    """Plain text from a post's HTML (or text) body: tags out, entities decoded, whitespace tidied."""
    raw = str(value or "")
    if not raw.strip():
        return ""
    if "&lt;" in raw[:2_000] and "<" not in raw[:200]:
        raw = unescape(raw)  # Greenhouse sends its HTML entity-encoded
    if "<" in raw and ">" in raw:
        return html_to_text(raw)[:MAX_DESCRIPTION]
    return re.sub(r"[ \t ]+", " ", unescape(raw)).strip()[:MAX_DESCRIPTION]


def obj(value: Any) -> dict[str, Any]:
    """A JSON object field, or {} when the source sent something else."""
    return value if isinstance(value, dict) else {}


def clean_line(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]{0,200}>", "", str(value or "")))).strip()[:limit]


_ROLE_HEAD = re.compile(r"(?im)^\s*(?:about the (?:role|job|position|opportunity)|the role|role overview|"
                        r"what you(?:'|’)ll do|what you will do|your role|job description|responsibilities|"
                        r"key responsibilities|the opportunity|in this role)\s*:?\s*$")


def snippet_of(description: str, limit: int = SNIPPET_CHARS) -> str:
    """A few lines about the job itself: from "About the role" / "What you'll do" when the post has such a heading
    near the top (most open with the company's blurb), else from the start. Cut at a word."""
    text = description
    m = _ROLE_HEAD.search(description[:4_000])
    if m and len(description) - m.end() > 120:
        text = description[m.end():]
    # Word-processor bullets (private-use glyphs, "●") as one plain bullet.
    flat = re.sub(r"\s+", " ", re.sub(r"[-●▪■◦]", "•", text)).strip()
    if len(flat) <= limit:
        return flat
    cut = flat[:limit].rsplit(" ", 1)[0].rstrip(",;:-–")
    return cut + "…"


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9+#]+", " ", text.lower()).strip()


def dedupe_key(company: str, title: str, cities: list[str], workplace: str | None) -> str:
    """The same job posted twice (on the company's board and on a feed): same company, title and city."""
    company_key = re.sub(r"\b(private|pvt|limited|ltd|inc|llc|technologies|technology|labs|india)\b", "",
                         _norm(company)).strip()
    place = cities[0].lower() if cities else ("remote" if workplace == "remote" else "")
    # Word order and "developer" vs "engineer" don't make it another job.
    words = sorted({"engineer" if w in ("developer", "dev") else w for w in _norm(title).split()})
    return f"{re.sub(r' +', ' ', company_key)}|{' '.join(words)}|{place}"[:300]


def listing_id(source: str, external_id: str) -> str:
    return "j" + hashlib.sha256(f"{source}:{external_id}".encode()).hexdigest()[:35]


def text_hash(title: str, description: str) -> str:
    """Changes when the post's text does, or the way skills are read from it (KEYWORDS_VERSION)."""
    return hashlib.sha256(f"{KEYWORDS_VERSION}\n{title}\n{description}".encode()).hexdigest()[:16]


def parse_time(value: Any) -> datetime | None:
    """ISO 8601 (with or without a zone) or a Unix time in seconds or milliseconds."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        if isinstance(value, int | float) or (isinstance(value, str) and value.strip().isdigit()):
            n = float(value)
            if n > 1e11:  # milliseconds
                n /= 1000
            return datetime.fromtimestamp(n, UTC)
        when = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except (ValueError, OverflowError, OSError):
        return None
    return when if when.tzinfo else when.replace(tzinfo=UTC)


def salary_text(lo: Any, hi: Any, currency: Any, period: Any = None) -> str | None:
    """"₹12L – ₹20L a year", "$140k – $165k a year": None when the post gives no figure."""
    def num(v: Any) -> float | None:
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        return f if f > 0 else None

    a, b = num(lo), num(hi)
    if a is None and b is None:
        return None
    cur = str(currency or "").upper()
    sign = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}.get(cur, f"{cur} " if cur else "")

    def fmt(v: float) -> str:
        if cur == "INR" and v >= 100_000:
            return f"{sign}{v / 100_000:.1f}L".replace(".0L", "L")
        if v >= 1_000:
            return f"{sign}{v / 1_000:.0f}k"
        return f"{sign}{v:.0f}"

    span = " – ".join(fmt(v) for v in (a, b) if v is not None) if a != b else fmt(a or 0)
    unit = str(period or "").lower()  # "year", "yearly", "annual", Lever's "per-year-salary", "hourly", ...
    per = " a year" if "year" in unit or "annual" in unit else " a month" if "month" in unit else \
        " an hour" if "hour" in unit else ""
    return (span + per)[:120]


# ---- the listing row ---------------------------------------------------------------------------------------------

# Pictographs some feeds put in titles ("🌎 Backend Developer").
_PICTOGRAPHS = re.compile("[\U0001F000-\U0001FAFF☀-➿️‍]+")
# A remote post titled in Spanish, Portuguese, German or French is for people there ("DESARROLLADOR BACKEND JAVA"),
# whatever its region says.
_FOREIGN_TITLE = re.compile(r"(?<![a-zà-ÿ])(desarrollador[a]?|ingenier[oa]|programador[a]?|remoto|vaga|"
                            r"engenheir[oa]|desenvolvedor[a]?|pleno|entwickler(?:in)?|ingénieur|développeur(?:se)?)"
                            r"(?![a-zà-ÿ])")


def normalize(p: Posting, now: datetime | None = None) -> dict[str, Any] | None:
    """The listing row's fields for a post, or None when it shouldn't be listed. Keywords are added later (they're
    the slow part, and only needed when the text changed)."""
    now = now or datetime.now(UTC)
    title = clean_line(_PICTOGRAPHS.sub("", p.title), 300)
    if not title or not p.url.startswith("https://"):
        return None
    # A post dated in the future (a time-zone slip) is new, not first in the "newest" feed for ever.
    posted = min(p.posted_at or now, now)
    if now - posted > MAX_AGE:
        return None
    locations = [clean_line(x, 120) for x in p.locations if clean_line(x, 120)][:8]
    where = " / ".join(locations)
    workplace = p.workplace or workplace_of(where, title)
    cities = find_cities(where + " " + title)
    in_india = (p.country or "").upper() == "IN" or bool(cities) or mentions_india(where)
    if not in_india:
        if workplace != "remote" or _FOREIGN_TITLE.search(title.lower()):
            return None
        region = remote_region(where)
        if region == "elsewhere" or (region is None and not (p.open_to_india or p.remote_unstated_ok)):
            return None
    description = p.description[:MAX_DESCRIPTION]
    level, exp_min, exp_max = experience_of(title, description)
    if title_level(title) is None and p.level is not None:
        level = p.level
    return {
        "id": listing_id(p.source, p.external_id), "source": p.source, "external_id": p.external_id[:200],
        "board": p.board[:160], "company": clean_line(p.company, 200) or "Unknown company", "title": title,
        "locations": locations, "cities": cities, "country": "IN" if in_india else None, "workplace": workplace,
        "employment_type": p.employment_type or employment_type_of(title), "level": level,
        "exp_min": exp_min, "exp_max": exp_max, "posted_at": posted, "url": p.url,
        "apply_url": p.apply_url if p.apply_url.startswith("https://") else p.url,
        "snippet": snippet_of(description) if description else "", "description": description,
        "salary": p.salary, "dedupe_key": dedupe_key(p.company, title, cities, workplace),
        "text_hash": text_hash(title, description),
    }
