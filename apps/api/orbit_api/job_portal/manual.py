"""Jobs found elsewhere (Naukri, LinkedIn, a campus portal, a company's own site), tracked by hand.

Their tracker entry has `listing_id = "ext:<32 hex>"` and `source = "manual"`: `JobApplication.listing_id` is a plain
String(36), not a foreign key, so no migration is needed, and an "ext:" id can never be a feed listing's (those are
"j" + 35 hex, postings.listing_id).

Nothing is fetched from the link here. `read_link` reads the address itself: which site it is, and the title, company
and city where the site writes them into its addresses (Naukri, LinkedIn, foundit, Internshala, Instahyre, Shine,
apna, the companies' own ATS boards). Those are guesses for the user to check, never facts. Reading the page is
prep/job_link.py's job (`POST /v1/prep/import-link`, SSRF-safe), which the client may call first.
"""

import re
import uuid
from dataclasses import dataclass
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit

from orbit_api.job_portal.postings import CITIES, find_cities

EXT_PREFIX = "ext:"
SOURCE = "manual"
MAX_URL = 2_000


def new_listing_id() -> str:
    """36 characters, the column's size: "ext:" and a uuid4's 32 hex digits."""
    return EXT_PREFIX + uuid.uuid4().hex


def is_manual(listing_id: str) -> bool:
    return listing_id.startswith(EXT_PREFIX)


class LinkError(ValueError):
    """A message safe to show the user as-is."""


@dataclass(frozen=True)
class JobLink:
    url: str  # tidied: no fragment, no tracking parameters, the site's own short form where it has one
    site: str  # "Naukri", "LinkedIn", or the host ("careers.example.com")
    title: str = ""
    company: str = ""
    location: str = ""


# ---- the address ---------------------------------------------------------------------------------------------------

# Query parameters that only say where a click came from: dropped, so the same job pasted twice is the same link.
_TRACKING = re.compile(r"^(?:utm_.*|src|source|ref|refid|referer|referrer|trk|trackingid|lipi|sid|xid|xp|px|"
                       r"fbclid|gclid|gad_source|mc_cid|mc_eid|_ga|igshid|si|from|campaign|share_id|shareid|"
                       r"originalsubdomain|eboutsource)$", re.IGNORECASE)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def normalize_url(raw: str) -> str:
    """The link as Orbit keeps it, or LinkError. A bare "naukri.com/..." gets https://. Only http(s) with a real host
    name; no user name or password in it."""
    text = _CONTROL.sub("", raw or "").strip()
    if not text:
        raise LinkError("Paste the job's link.")
    if len(text) > MAX_URL:
        raise LinkError("That link is too long to be a job's address.")
    if not re.match(r"^[a-z][a-z0-9+.-]*://", text, re.IGNORECASE):
        if re.match(r"^[a-z][a-z0-9+.-]*:", text, re.IGNORECASE) and not re.match(r"^[\w.-]+:\d", text):
            raise LinkError("That isn't a web link. Paste an address starting with https://.")
        text = "https://" + text.lstrip("/")
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError as e:
        raise LinkError("That link doesn't look right. Copy it again from the job's page.") from e
    if parts.scheme.lower() not in ("http", "https"):
        raise LinkError("That isn't a web link. Paste an address starting with https://.")
    if parts.username or parts.password:
        raise LinkError("Links with a user name or password in them can't be saved.")
    host = (parts.hostname or "").rstrip(".").lower()
    if "." not in host or not re.fullmatch(r"[a-z0-9.-]+", host) or host.startswith(".") or ".." in host:
        raise LinkError("That link doesn't have a website in it. Copy it again from the job's page.")
    default = {"http": 80, "https": 443}[parts.scheme.lower()]
    netloc = host if port in (None, default) else f"{host}:{port}"
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not _TRACKING.match(k)])
    path = quote(unquote(parts.path), safe="/%:@!$&'()*+,;=-._~") or "/"
    return urlunsplit((parts.scheme.lower(), netloc, path, query, ""))


# ---- which site --------------------------------------------------------------------------------------------------

# Host (or the end of one) -> the name people know it by.
SITES: tuple[tuple[str, str], ...] = (
    ("naukri.com", "Naukri"), ("linkedin.com", "LinkedIn"), ("lnkd.in", "LinkedIn"), ("indeed.com", "Indeed"),
    ("foundit.in", "foundit"),
    ("monsterindia.com", "foundit"), ("internshala.com", "Internshala"), ("instahyre.com", "Instahyre"),
    ("cutshort.io", "Cutshort"), ("wellfound.com", "Wellfound"), ("angel.co", "Wellfound"), ("unstop.com", "Unstop"),
    ("apna.co", "apna"), ("hirist.tech", "Hirist"), ("hirist.com", "Hirist"), ("iimjobs.com", "iimjobs"),
    ("shine.com", "Shine"), ("timesjobs.com", "TimesJobs"), ("glassdoor.co.in", "Glassdoor"),
    ("glassdoor.com", "Glassdoor"), ("greenhouse.io", "Greenhouse"), ("lever.co", "Lever"),
    ("ashbyhq.com", "Ashby"), ("myworkdayjobs.com", "Workday"), ("smartrecruiters.com", "SmartRecruiters"),
    ("freshersworld.com", "Freshersworld"), ("workindia.in", "WorkIndia"), ("google.com", "Google"),
)


def site_of(host: str) -> str:
    host = host.lower().removeprefix("www.")
    for suffix, name in SITES:
        if host == suffix or host.endswith("." + suffix):
            return name
    return host


# ---- reading the address -------------------------------------------------------------------------------------------

# Words a job title ends on: in a Naukri-style address ("software-engineer-razorpay-bengaluru") the title is what comes
# up to the last of them, the company what follows.
_ROLE_WORDS = frozenset("""
engineer engineers developer developers analyst analysts manager managers executive executives associate associates
intern interns internship trainee trainees consultant consultants specialist specialists designer designers lead
architect officer representative administrator admin tester scientist coordinator assistant advisor adviser agent
writer editor accountant recruiter programmer technician operator supervisor sde sdet devops owner strategist expert
counsellor counselor teacher tutor faculty professor nurse pharmacist telecaller caller marketer partner head director
fresher freshers apprentice graduate auditor buyer planner investigator underwriter process support sales
""".split())
# What may follow the last role word and still be the title ("Software Engineer II", "SDE 2", "Lead - Backend").
_LEVEL_WORDS = frozenset("i ii iii iv v 1 2 3 4 l1 l2 l3 l4 sr jr".split())
_UPPER = frozenset("""
sde sdet ui ux qa hr it bpo kpo ai ml sql aws gcp api ios php seo sem crm erp sap ca cs mba bba bca mca b2b b2c
saas devops dba etl bi gis vlsi rtl plc cad cnc hvac l1 l2 l3 l4 ii iii iv cto ceo cfo vp avp ar ap nlp llm qa
""".split())
_SMALL = frozenset("and of the for in at to with or".split())
# The Indian cities as single words, and the words around them in an address ("mumbai-all-areas", "delhi-ncr").
_CITY_WORDS = frozenset(w for name, aliases in CITIES.items() for a in (*aliases, name.lower()) for w in a.split())
_PLACE_FILLER = frozenset("all areas india remote hybrid new navi greater other cities work from home anywhere".split())


def _words(slug: str) -> list[str]:
    return [w for w in re.split(r"[-_+\s]+", unquote(slug).lower()) if w]


def _title_case(words: list[str]) -> str:
    out = []
    for i, w in enumerate(words):
        if w in _UPPER:
            out.append(w.upper())
        elif w in _SMALL and 0 < i < len(words) - 1:
            out.append(w)
        elif re.fullmatch(r"[a-z]+", w):
            out.append(w.capitalize())
        else:
            out.append(w.upper() if re.fullmatch(r"[a-z]\d|\d[a-z]", w) else w)
    return re.sub(r"\s+", " ", " ".join(out)).strip()[:300]


def _place(words: list[str]) -> tuple[list[str], str]:
    """Trailing city words off an address's words: (the rest, "Bengaluru, Pune" or "Remote")."""
    end = len(words)
    while end > 0 and (words[end - 1] in _CITY_WORDS or words[end - 1] in _PLACE_FILLER):
        end -= 1
    tail = " ".join(words[end:])
    cities = find_cities(tail)
    where = ", ".join(cities[:3])
    if not where and re.search(r"\b(remote|work from home|anywhere)\b", tail):
        where = "Remote"
    return words[:end], where


def _title_company(words: list[str]) -> tuple[str, str]:
    """"senior java developer tata consultancy services" -> ("Senior Java Developer", "Tata Consultancy Services"):
    the title runs to the last role word that still leaves a word for the company. ("", "") when there's none."""
    cut = -1
    for i, w in enumerate(words[:-1]):
        if w in _ROLE_WORDS:
            cut = i
    if cut < 0:
        # Only a title ("...-java-developer"): no company in the address.
        return (_title_case(words), "") if words and words[-1] in _ROLE_WORDS else ("", "")
    while cut + 1 < len(words) - 1 and words[cut + 1] in _LEVEL_WORDS:
        cut += 1
    return _title_case(words[:cut + 1]), _title_case(words[cut + 1:])


def _strip_years(words: list[str]) -> list[str]:
    """"... 2 to 5 years" / "... 0 to 1 yrs" / "... 3 5 years" off the end of Naukri-style words."""
    text = " ".join(words)
    text = re.sub(r"\s+\d{1,2}(?:\s+to)?\s+\d{1,2}\s+(?:years?|yrs?)$", "", text)
    text = re.sub(r"\s+\d{1,2}\s+(?:years?|yrs?)$", "", text)
    return text.split()


def _naukri(path: str) -> tuple[str, str, str]:
    m = re.match(r"^/job-listings-(.+?)-\d{6,}/?$", path)
    if not m:
        return "", "", ""
    rest, where = _place(_strip_years(_words(m.group(1))))
    title, company = _title_company(rest)
    return title, company, where


def _foundit(path: str) -> tuple[str, str, str]:
    m = re.match(r"^/job/(.+?)-\d{5,}/?$", path)
    if not m:
        return "", "", ""
    rest, where = _place(_words(m.group(1)))
    title, company = _title_company(rest)
    return title, company, where


def _linkedin(path: str) -> tuple[str, str, str]:
    m = re.match(r"^/jobs/view/(?:(.+?)-)?\d{6,}/?$", path)
    if not m or not m.group(1) or "-at-" not in m.group(1):
        return "", "", ""
    title, company = m.group(1).rsplit("-at-", 1)
    return _title_case(_words(title)), _title_case(_words(company)), ""


def _internshala(path: str) -> tuple[str, str, str]:
    m = re.match(r"^/(?:internship|job)/detail/(.+?)\d{6,}/?$", path)
    if not m or "-at-" not in m.group(1):
        return "", "", ""
    head, company = m.group(1).rsplit("-at-", 1)
    where = ""
    if head.startswith("work-from-home-"):
        head, where = head.removeprefix("work-from-home-"), "Remote"
    if "-in-" in head:
        head, place = head.rsplit("-in-", 1)
        where = ", ".join(find_cities(place.replace("-", " "))[:3]) or where
    head = re.sub(r"-job$", "", head)
    return _title_case(_words(head)), _title_case(_words(company)), where


def _instahyre(path: str) -> tuple[str, str, str]:
    m = re.match(r"^/job-\d+-(.+?)/?$", path)
    if not m or "-at-" not in m.group(1):
        return "", "", ""
    title, rest = m.group(1).rsplit("-at-", 1)
    company_words, where = _place(_words(rest))
    return _title_case(_words(title)), _title_case(company_words), where


def _shine(path: str) -> tuple[str, str, str]:
    m = re.match(r"^/jobs/([^/]+)/([^/]+)/\d+/?$", path)
    if not m:
        return "", "", ""
    return _title_case(_words(m.group(1))), _title_case(_words(m.group(2))), ""


def _apna(path: str) -> tuple[str, str, str]:
    m = re.match(r"^/job/([^/]+)/(.+?)-\d{5,}/?$", path)
    if not m:
        return "", "", ""
    return _title_case(_words(m.group(2))), "", ", ".join(find_cities(m.group(1).replace("-", " "))[:3])


def _board(host: str, path: str) -> tuple[str, str, str]:
    """A company's own ATS board: its name is in the address (and on Workday and SmartRecruiters, the title too)."""
    segments = [s for s in path.split("/") if s]
    if host.endswith("greenhouse.io") and len(segments) >= 2 and segments[1] == "jobs":
        return "", _title_case(_words(segments[0])), ""
    if (host.endswith("lever.co") or host.endswith("ashbyhq.com")) and len(segments) >= 2:
        return "", _title_case(_words(segments[0])), ""
    if host.endswith("smartrecruiters.com") and len(segments) >= 2:
        m = re.match(r"^\d+-(.+)$", segments[1])
        return _title_case(_words(m.group(1))) if m else "", _title_case(_words(segments[0])), ""
    if host.endswith("myworkdayjobs.com"):
        # acme.wd5.myworkdayjobs.com/en-US/External/job/Bengaluru-Karnataka-India/Software-Engineer_R12345
        company = _title_case(_words(host.split(".", 1)[0]))
        after = segments[segments.index("job") + 1:] if "job" in segments else []
        if not after:
            return "", company, ""
        title_slug = re.sub(r"_[A-Za-z0-9-]+$", "", after[-1])
        where = ", ".join(find_cities(after[0].replace("-", " "))[:3]) if len(after) > 1 else ""
        return _title_case(_words(title_slug)), company, where
    return "", "", ""


def _canonical(site: str, url: str) -> str:
    """The site's own short form of a job's address, where there is one (LinkedIn's /jobs/view/<id>/)."""
    parts = urlsplit(url)
    if site == "LinkedIn":
        m = re.match(r"^/jobs/view/(?:.+-)?(\d{6,})/?$", parts.path)
        job = m.group(1) if m else dict(parse_qsl(parts.query)).get("currentJobId", "")
        if job.isdigit():
            return f"https://www.linkedin.com/jobs/view/{job}/"
    if site == "Naukri" and parts.path.startswith("/job-listings-"):
        return urlunsplit(("https", "www.naukri.com", parts.path, "", ""))
    return url


def read_link(raw: str) -> JobLink:
    """What a job's address says about it, without opening it. LinkError if it isn't a usable link."""
    url = normalize_url(raw)
    parts = urlsplit(url)
    host = (parts.hostname or "").removeprefix("www.")
    site = site_of(host)
    path = unquote(parts.path).lower() if site not in ("Workday", "SmartRecruiters") else unquote(parts.path)
    readers = {"Naukri": _naukri, "foundit": _foundit, "LinkedIn": _linkedin, "Internshala": _internshala,
               "Instahyre": _instahyre, "Shine": _shine, "apna": _apna}
    if site in readers:
        title, company, where = readers[site](path)
    else:
        title, company, where = _board(host, path)
    return JobLink(url=_canonical(site, url), site=site, title=title[:300], company=company[:200],
                   location=where[:300])


def clean_text(value: str, limit: int) -> str:
    """A typed line: control characters out, whitespace collapsed, cut to the column's size."""
    return re.sub(r"\s+", " ", _CONTROL.sub(" ", value or "")).strip()[:limit]


def clean_notes(value: str, limit: int = 4_000) -> str:
    """Typed notes: line breaks kept, other control characters out."""
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value or "").strip()[:limit]
