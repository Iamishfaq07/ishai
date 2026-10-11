""""Search on LinkedIn / Naukri / Indeed / …": links to each portal's own search, prefilled from the profile.

No data is fetched from these sites (their terms forbid it, docs/DECISIONS.md D43): these are plain links that open
the portal's search for the same title, city, recency, work mode and experience, in a new tab. Each portal writes
cities its own way, so `_city` keeps a small table per portal and falls back to the plain name.

The portals follow the country the user applies in: LinkedIn, Indeed (its site for that country), Wellfound and
Google Jobs everywhere; Naukri, Foundit, Instahyre, Cutshort, Hirist and Internshala in India only.
"""

import re
from dataclasses import dataclass
from urllib.parse import quote_plus, urlencode

from orbit_api.job_portal.postings import Level
from orbit_api.region import country_name

# Display order, and the ones shown until the user picks.
PORTALS: dict[str, str] = {
    "linkedin": "LinkedIn", "naukri": "Naukri", "indeed": "Indeed", "foundit": "Foundit", "instahyre": "Instahyre",
    "cutshort": "Cutshort", "hirist": "Hirist", "wellfound": "Wellfound", "internshala": "Internshala",
    "google": "Google Jobs",
}
DEFAULT_PORTALS: tuple[str, ...] = ("linkedin", "naukri", "indeed", "foundit", "instahyre", "google")
INDIA_ONLY = frozenset({"naukri", "foundit", "instahyre", "cutshort", "hirist", "internshala"})
# Indeed's site per country (others search indeed.com with the country as the place).
_INDEED_HOST = {
    "IN": "in.indeed.com", "US": "www.indeed.com", "GB": "uk.indeed.com", "CA": "ca.indeed.com",
    "AU": "au.indeed.com", "NZ": "nz.indeed.com", "IE": "ie.indeed.com", "DE": "de.indeed.com",
    "FR": "fr.indeed.com", "NL": "nl.indeed.com", "ES": "es.indeed.com", "IT": "it.indeed.com",
    "BE": "be.indeed.com", "CH": "ch.indeed.com", "AT": "at.indeed.com", "PL": "pl.indeed.com",
    "SG": "sg.indeed.com", "MY": "malaysia.indeed.com", "PH": "ph.indeed.com", "AE": "ae.indeed.com",
    "SA": "sa.indeed.com", "ZA": "za.indeed.com", "PK": "pk.indeed.com", "JP": "jp.indeed.com",
    "BR": "br.indeed.com", "MX": "mx.indeed.com", "AR": "ar.indeed.com",
}


def portals_for(country: str | None) -> dict[str, str]:
    """The portals there are links to in this country, in display order."""
    india = (country or "IN").upper() == "IN"
    return {k: v for k, v in PORTALS.items() if india or k not in INDIA_ONLY}
LINKEDIN_INDIA_GEO = "102713980"
_LINKEDIN_TPR = {1: "r86400", 3: "r259200", 7: "r604800", 30: "r2592000"}
_LINKEDIN_WT = {"onsite": "1", "remote": "2", "hybrid": "3"}
_LINKEDIN_E = {"fresher": "1,2", "junior": "2,3", "mid": "3,4", "senior": "4"}
_NAUKRI_AGE = {1: 1, 3: 3, 7: 7, 30: 30}
_NAUKRI_WFH = {"onsite": "0", "remote": "2", "hybrid": "3"}
_INDEED_AGE = {1: 1, 3: 3, 7: 7}  # Indeed offers 1, 3, 7 or 14 days; "30" is its default (no filter)
_FOUNDIT_AGE = {1: 1, 3: 3, 7: 7, 30: 30}

# The city as each portal's URLs spell it (canonical name -> slug); others use the lowercased canonical name.
_NAUKRI_CITY = {"Bengaluru": "bangalore", "Gurugram": "gurgaon", "Delhi": "delhi-ncr", "Thiruvananthapuram":
                "trivandrum", "Mysuru": "mysore", "Visakhapatnam": "visakhapatnam", "Mangaluru": "mangalore"}
_COMMON_CITY = {"Bengaluru": "bangalore", "Gurugram": "gurgaon", "Thiruvananthapuram": "trivandrum",
                "Mysuru": "mysore", "Mangaluru": "mangalore", "Delhi": "delhi"}
_CUTSHORT_CITY = {"Bengaluru": "bangalore-bengaluru", "Gurugram": "gurugram", "Delhi": "delhi-ncr-gurgaon-and-noida",
                  "Noida": "noida", "Mumbai": "mumbai", "Pune": "pune", "Hyderabad": "hyderabad",
                  "Chennai": "chennai", "Kolkata": "kolkata"}
# Internshala's job categories: only these slugs exist (others 404), so a title maps to one or to the plain list.
_INTERNSHALA = (
    (r"\b(python|django)\b", "python-django"), (r"\bjava\b", "java"), (r"\b(android)\b", "android-app-development"),
    (r"\b(data scien|machine learning|ml\b|ai\b)", "data-science"), (r"\bdata analy", "data-analytics"),
    (r"\b(front ?end|react|angular)", "front-end-development"), (r"\b(back ?end)", "back-end-development"),
    (r"\bfull ?stack", "full-stack-development"), (r"\b(web develop)", "web-development"),
    (r"\b(software|developer|engineer|sde)\b", "software-development"),
    (r"\b(digital marketing|seo|performance marketing)", "digital-marketing"), (r"\bmarketing\b", "marketing"),
    (r"\b(content|copy) ?writ", "content-writing"), (r"\bgraphic design", "graphic-design"),
    (r"\b(ui|ux|product design)", "ui-ux-design"), (r"\b(human resources|hr|recruit)", "human-resources-hr"),
    (r"\bfinance|accounts?\b|accountant", "finance"), (r"\bsales\b", "sales"),
    (r"\bbusiness develop", "business-development"), (r"\boperations?\b", "operations"),
    (r"\bcustomer (service|support|success)", "customer-service"),
)


@dataclass(frozen=True)
class PortalLink:
    id: str
    name: str
    url: str


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:80]


def _city(table: dict[str, str], city: str | None) -> str | None:
    return (table.get(city) or _slug(city)) if city else None


def _years_range(level: Level | None, years: float | None) -> tuple[int, int] | None:
    if years is not None:
        y = round(years)
        return (0, 1) if y < 1 else (max(y - 1, 0), y + 2)
    return {"fresher": (0, 1), "junior": (1, 3), "mid": (3, 6), "senior": (6, 12)}.get(level or "")


def portal_links(*, keywords: str, city: str | None, posted_within: int, workplace: list[str],
                 level: Level | None, years: float | None, portals: list[str] | None = None,
                 country: str = "IN") -> list[PortalLink]:
    """The search links for these filters, for the chosen portals (in display order) that there are in `country`.
    `city` is a canonical city or None for the whole country; `workplace` the modes the user wants (all three = no
    filter)."""
    if country.upper() != "IN":
        return _world_links(keywords=keywords, city=city, posted_within=posted_within, workplace=workplace,
                            level=level, portals=portals, country=country.upper())
    kw = re.sub(r"\s+", " ", keywords).strip()[:100] or "jobs"
    modes = [m for m in ("onsite", "remote", "hybrid") if m in workplace]
    only_some = 0 < len(modes) < 3
    remote_only = modes == ["remote"]
    span = _years_range(level, years)
    out: dict[str, str] = {}

    li: dict[str, str] = {"keywords": kw, "sortBy": "DD", "f_TPR": _LINKEDIN_TPR.get(posted_within, "r604800")}
    if city:
        li["location"] = f"{city}, India"
    else:
        li |= {"location": "India", "geoId": LINKEDIN_INDIA_GEO}
    if only_some:
        li["f_WT"] = ",".join(_LINKEDIN_WT[m] for m in modes)
    if level:
        li["f_E"] = _LINKEDIN_E[level]
    out["linkedin"] = "https://www.linkedin.com/jobs/search/?" + urlencode(li)

    naukri_city = _city(_NAUKRI_CITY, city)
    path = _slug(kw) + "-jobs" + (f"-in-{naukri_city}" if naukri_city else "")
    nk: list[tuple[str, str]] = [("k", kw)]
    if city:
        nk.append(("l", naukri_city or city.lower()))
    if span is not None:  # the candidate's own years
        nk.append(("experience", str(round(years)) if years is not None else str(span[0])))
    nk.append(("jobAge", str(_NAUKRI_AGE.get(posted_within, 7))))
    if only_some:
        nk += [("wfhType", _NAUKRI_WFH[m]) for m in modes]
    out["naukri"] = f"https://www.naukri.com/{path}?" + urlencode(nk)

    ind = {"q": kw, "l": "Remote" if remote_only else (city or "India"), "sort": "date"}
    if posted_within in _INDEED_AGE:
        ind["fromage"] = str(_INDEED_AGE[posted_within])
    out["indeed"] = "https://in.indeed.com/jobs?" + urlencode(ind)

    fd = {"query": kw, "locations": city or "India", "jobFreshness": str(_FOUNDIT_AGE.get(posted_within, 7))}
    if span is not None:
        fd["experienceRanges"] = f"{span[0]}~{span[1]}"
    out["foundit"] = "https://www.foundit.in/srp/results?" + urlencode(fd)

    common = _city(_COMMON_CITY, city)
    out["instahyre"] = f"https://www.instahyre.com/{_slug(kw)}-jobs" + (f"-in-{common}" if common else "") + "/"
    cut = _city(_CUTSHORT_CITY, city)
    out["cutshort"] = f"https://cutshort.io/jobs/{_slug(kw)}-jobs" + (f"-in-{cut}" if cut else "")
    out["hirist"] = f"https://www.hirist.tech/k/{_slug(kw)}-jobs" + (f"-in-{common}" if common else "")
    # Wellfound has a page per common role ("backend-engineer", "python-developer"); a long or odd title has none.
    role = _slug(kw)
    out["wellfound"] = (f"https://wellfound.com/role/l/{role}/{common or 'india'}" if len(kw.split()) <= 3
                        else f"https://wellfound.com/location/{common or 'india'}")
    category = next((slug for pattern, slug in _INTERNSHALA if re.search(pattern, kw.lower())), None)
    kind = "internships" if level == "fresher" else "jobs"
    unit = "internship" if kind == "internships" else "jobs"
    if category:
        out["internshala"] = f"https://internshala.com/{kind}/{category}-{unit}" + (f"-in-{common}" if common else "") \
            + "/"
    else:
        out["internshala"] = f"https://internshala.com/{kind}/" + (f"{unit}-in-{common}/" if common else "")
    where = f" in {city}" if city else " in India"
    remote = " remote" if remote_only else ""
    out["google"] = "https://www.google.com/search?" + urlencode({"q": f"{kw}{remote} jobs{where}", "udm": "8"},
                                                                 quote_via=quote_plus)
    wanted = [p for p in PORTALS if portals is None or p in portals]
    return [PortalLink(p, PORTALS[p], out[p]) for p in wanted]



def _world_links(*, keywords: str, city: str | None, posted_within: int, workplace: list[str], level: Level | None,
                 portals: list[str] | None, country: str) -> list[PortalLink]:
    """Outside India: LinkedIn, Indeed (its site for the country), Wellfound and Google Jobs."""
    kw = re.sub(r"\s+", " ", keywords).strip()[:100] or "jobs"
    name = (country_name(country) or country).removeprefix("the ")
    modes = [m for m in ("onsite", "remote", "hybrid") if m in workplace]
    only_some = 0 < len(modes) < 3
    remote_only = modes == ["remote"]
    out: dict[str, str] = {}

    li: dict[str, str] = {"keywords": kw, "sortBy": "DD", "f_TPR": _LINKEDIN_TPR.get(posted_within, "r604800"),
                          "location": f"{city}, {name}" if city else name}
    if only_some:
        li["f_WT"] = ",".join(_LINKEDIN_WT[m] for m in modes)
    if level:
        li["f_E"] = _LINKEDIN_E[level]
    out["linkedin"] = "https://www.linkedin.com/jobs/search/?" + urlencode(li)

    host = _INDEED_HOST.get(country)
    place = "Remote" if remote_only else (city or (name if host is None else ""))
    ind = {"q": kw, "sort": "date"} | ({"l": place} if place else {})
    if posted_within in _INDEED_AGE:
        ind["fromage"] = str(_INDEED_AGE[posted_within])
    out["indeed"] = f"https://{host or 'www.indeed.com'}/jobs?" + urlencode(ind)

    where = _slug(city or name)
    role = _slug(kw)
    out["wellfound"] = (f"https://wellfound.com/role/l/{role}/{where}" if len(kw.split()) <= 3
                        else f"https://wellfound.com/location/{where}")
    remote = " remote" if remote_only else ""
    out["google"] = "https://www.google.com/search?" + urlencode(
        {"q": f"{kw}{remote} jobs in {city or name}", "udm": "8"}, quote_via=quote_plus)
    wanted = [p for p in out if portals is None or p in portals] or ["linkedin", "indeed", "google"]
    return [PortalLink(p, PORTALS[p], out[p]) for p in PORTALS if p in wanted]
