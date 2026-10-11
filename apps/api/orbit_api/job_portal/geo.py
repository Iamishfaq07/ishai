"""Where a job post is, worldwide: the country and cities its location text names, and for a remote post, who it's
open to (anywhere, some countries, or a region like EMEA). India's cities stay in postings.CITIES, with their many
spellings; this adds the main job cities elsewhere, country names, US states and Canadian provinces, and regions.

Matching is on whole words, case-insensitively. A post that names nothing recognizable has no country.
"""

import re
from functools import lru_cache

# Canonical city -> (country, other ways posts write it). The cities most jobs are posted in, per country.
WORLD_CITIES: dict[str, tuple[str, tuple[str, ...]]] = {
    # United States
    "New York": ("US", ("new york city", "nyc", "manhattan", "brooklyn")),
    "San Francisco": ("US", ("sf", "san francisco bay area", "bay area")),
    "San Jose": ("US", ()), "Palo Alto": ("US", ()), "Mountain View": ("US", ()), "Sunnyvale": ("US", ()),
    "Menlo Park": ("US", ()), "Redwood City": ("US", ()), "Santa Clara": ("US", ()), "Oakland": ("US", ()),
    "Seattle": ("US", ()), "Bellevue": ("US", ()), "Redmond": ("US", ()), "Los Angeles": ("US", ()),
    "San Diego": ("US", ()), "Austin": ("US", ()), "Dallas": ("US", ()), "Houston": ("US", ()),
    "Chicago": ("US", ()), "Boston": ("US", ("cambridge, ma",)), "Washington": ("US", ("washington, dc", "dc")),
    "Atlanta": ("US", ()), "Denver": ("US", ()), "Boulder": ("US", ()), "Miami": ("US", ()),
    "Philadelphia": ("US", ()), "Phoenix": ("US", ()), "Portland": ("US", ()), "Salt Lake City": ("US", ()),
    "Minneapolis": ("US", ()), "Detroit": ("US", ()), "Pittsburgh": ("US", ()), "Raleigh": ("US", ("durham",)),
    "Charlotte": ("US", ()), "Nashville": ("US", ()), "Columbus": ("US", ()), "St. Louis": ("US", ("st louis",)),
    "Irvine": ("US", ()), "Jersey City": ("US", ()), "Indianapolis": ("US", ()),
    # Canada
    "Toronto": ("CA", ()), "Vancouver": ("CA", ()), "Montreal": ("CA", ("montréal",)), "Ottawa": ("CA", ()),
    "Calgary": ("CA", ()), "Waterloo": ("CA", ("kitchener",)), "Edmonton": ("CA", ()),
    # United Kingdom and Ireland
    "London": ("GB", ()), "Manchester": ("GB", ()), "Edinburgh": ("GB", ()), "Birmingham": ("GB", ()),
    "Bristol": ("GB", ()), "Leeds": ("GB", ()), "Glasgow": ("GB", ()), "Cambridge": ("GB", ()),
    "Oxford": ("GB", ()), "Belfast": ("GB", ()), "Reading": ("GB", ()),
    "Dublin": ("IE", ()), "Cork": ("IE", ()), "Galway": ("IE", ()),
    # Europe
    "Berlin": ("DE", ()), "Munich": ("DE", ("münchen", "muenchen")), "Hamburg": ("DE", ()),
    "Frankfurt": ("DE", ()), "Cologne": ("DE", ("köln",)), "Stuttgart": ("DE", ()),
    "Düsseldorf": ("DE", ("dusseldorf",)),
    "Paris": ("FR", ()), "Lyon": ("FR", ()), "Toulouse": ("FR", ()),
    "Amsterdam": ("NL", ()), "Rotterdam": ("NL", ()), "Utrecht": ("NL", ()), "Eindhoven": ("NL", ()),
    "The Hague": ("NL", ("den haag",)),
    "Madrid": ("ES", ()), "Barcelona": ("ES", ()), "Valencia": ("ES", ()), "Málaga": ("ES", ("malaga",)),
    "Lisbon": ("PT", ("lisboa",)), "Porto": ("PT", ()),
    "Milan": ("IT", ("milano",)), "Rome": ("IT", ("roma",)), "Turin": ("IT", ("torino",)),
    "Brussels": ("BE", ("bruxelles", "brussel")), "Antwerp": ("BE", ()),
    "Zurich": ("CH", ("zürich",)), "Geneva": ("CH", ("genève",)), "Basel": ("CH", ()), "Lausanne": ("CH", ()),
    "Vienna": ("AT", ("wien",)), "Stockholm": ("SE", ()), "Gothenburg": ("SE", ("göteborg",)),
    "Oslo": ("NO", ()), "Copenhagen": ("DK", ("københavn",)), "Helsinki": ("FI", ()),
    "Warsaw": ("PL", ("warszawa",)), "Kraków": ("PL", ("krakow", "cracow")), "Wrocław": ("PL", ("wroclaw",)),
    "Gdańsk": ("PL", ("gdansk",)), "Prague": ("CZ", ("praha",)), "Brno": ("CZ", ()),
    "Bucharest": ("RO", ("bucurești", "bucuresti")), "Cluj-Napoca": ("RO", ("cluj",)), "Athens": ("GR", ()),
    "Istanbul": ("TR", ()), "Ankara": ("TR", ()),
    # Middle East and Africa
    "Dubai": ("AE", ()), "Abu Dhabi": ("AE", ()), "Riyadh": ("SA", ()), "Jeddah": ("SA", ()), "Doha": ("QA", ()),
    "Kuwait City": ("KW", ()), "Muscat": ("OM", ()), "Manama": ("BH", ()), "Tel Aviv": ("IL", ("tel aviv-yafo",)),
    "Cairo": ("EG", ()), "Johannesburg": ("ZA", ()), "Cape Town": ("ZA", ()), "Lagos": ("NG", ()),
    "Nairobi": ("KE", ()), "Accra": ("GH", ()),
    # Asia-Pacific
    "Singapore": ("SG", ()), "Kuala Lumpur": ("MY", ()), "Jakarta": ("ID", ()), "Manila": ("PH", ("makati",)),
    "Bangkok": ("TH", ()), "Ho Chi Minh City": ("VN", ("saigon",)), "Hanoi": ("VN", ()), "Tokyo": ("JP", ()),
    "Osaka": ("JP", ()), "Seoul": ("KR", ()), "Shanghai": ("CN", ()), "Beijing": ("CN", ()), "Shenzhen": ("CN", ()),
    "Hong Kong": ("HK", ()), "Taipei": ("TW", ()), "Karachi": ("PK", ()), "Lahore": ("PK", ()),
    "Islamabad": ("PK", ()), "Dhaka": ("BD", ()), "Colombo": ("LK", ()), "Kathmandu": ("NP", ()),
    "Sydney": ("AU", ()), "Melbourne": ("AU", ()), "Brisbane": ("AU", ()), "Perth": ("AU", ()),
    "Adelaide": ("AU", ()), "Canberra": ("AU", ()), "Auckland": ("NZ", ()), "Wellington": ("NZ", ()),
    # Latin America
    "São Paulo": ("BR", ("sao paulo",)), "Rio de Janeiro": ("BR", ()),
    "Mexico City": ("MX", ("cdmx", "ciudad de méxico")),
    "Guadalajara": ("MX", ()), "Monterrey": ("MX", ()), "Buenos Aires": ("AR", ()), "Santiago": ("CL", ()),
    "Bogotá": ("CO", ("bogota",)), "Medellín": ("CO", ("medellin",)), "Lima": ("PE", ()),
}

# Ways posts name a country (lowercase) -> its ISO code. Bare two-letter codes are left out (too many false hits),
# except the few that posts really use.
COUNTRY_WORDS: dict[str, str] = {
    "india": "IN", "bharat": "IN",
    "united states": "US", "united states of america": "US", "usa": "US", "u.s.": "US", "u.s.a.": "US", "us": "US",
    "canada": "CA", "united kingdom": "GB", "uk": "GB", "u.k.": "GB", "england": "GB",
    "scotland": "GB", "wales": "GB", "northern ireland": "GB", "great britain": "GB", "britain": "GB",
    "ireland": "IE", "germany": "DE", "deutschland": "DE", "france": "FR", "netherlands": "NL", "holland": "NL",
    "the netherlands": "NL", "spain": "ES", "españa": "ES", "portugal": "PT", "italy": "IT", "italia": "IT",
    "belgium": "BE", "switzerland": "CH", "austria": "AT", "sweden": "SE", "norway": "NO", "denmark": "DK",
    "finland": "FI", "poland": "PL", "czechia": "CZ", "czech republic": "CZ", "romania": "RO", "greece": "GR",
    "turkey": "TR", "türkiye": "TR", "united arab emirates": "AE", "uae": "AE", "saudi arabia": "SA", "ksa": "SA",
    "qatar": "QA", "kuwait": "KW", "oman": "OM", "bahrain": "BH", "israel": "IL", "egypt": "EG",
    "south africa": "ZA", "nigeria": "NG", "kenya": "KE", "ghana": "GH", "singapore": "SG", "malaysia": "MY",
    "indonesia": "ID", "philippines": "PH", "thailand": "TH", "vietnam": "VN", "viet nam": "VN", "japan": "JP",
    "south korea": "KR", "korea": "KR", "china": "CN", "hong kong": "HK", "taiwan": "TW", "pakistan": "PK",
    "bangladesh": "BD", "sri lanka": "LK", "nepal": "NP", "australia": "AU", "new zealand": "NZ", "brazil": "BR",
    "brasil": "BR", "mexico": "MX", "méxico": "MX", "argentina": "AR", "chile": "CL", "colombia": "CO", "peru": "PE",
}

# Not "IN": "Pune, IN" is India far more often than Indiana here (Indianapolis is in the cities).
_US_STATES = frozenset("""AL AK AZ AR CA CO CT DE FL GA HI ID IL IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY
NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC""".split())
_US_STATE_NAMES = frozenset("""alabama alaska arizona arkansas california colorado connecticut delaware florida georgia
hawaii idaho illinois iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi
missouri montana nebraska nevada ohio oklahoma oregon pennsylvania tennessee texas utah vermont virginia wisconsin
wyoming""".split()) | {"new hampshire", "new jersey", "new mexico", "north carolina", "north dakota", "rhode island",
                         "south carolina", "south dakota", "west virginia"}
_CA_PROVINCES = frozenset("ON QC BC AB MB NS SK NB NL PE".split())
_CA_PROVINCE_NAMES = frozenset({"ontario", "quebec", "québec", "british columbia", "alberta", "manitoba",
                                "nova scotia", "saskatchewan", "new brunswick", "newfoundland"})

# Regions a remote post may be open to -> the countries in them. "*": anywhere.
REGIONS: dict[str, frozenset[str]] = {
    "EU": frozenset("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split()),
    "EUROPE": frozenset("""AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE GB CH NO IS
UA RS BA AL MK ME MD TR""".split()),
    "EMEA": frozenset("""AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE GB CH NO IS
UA RS TR AE SA QA KW OM BH IL EG ZA NG KE GH MA TN JO LB""".split()),
    "MENA": frozenset("AE SA QA KW OM BH IL EG JO LB MA TN DZ IQ".split()),
    "APAC": frozenset("IN SG MY ID PH TH VN JP KR CN HK TW PK BD LK NP AU NZ".split()),
    "ASIA": frozenset("IN SG MY ID PH TH VN JP KR CN HK TW PK BD LK NP AE SA QA KW OM BH IL".split()),
    "SOUTH ASIA": frozenset("IN PK BD LK NP".split()),
    "ANZ": frozenset("AU NZ".split()),
    "NORTH AMERICA": frozenset("US CA MX".split()),
    "AMERICAS": frozenset("US CA MX BR AR CL CO PE".split()),
    "LATAM": frozenset("MX BR AR CL CO PE".split()),
    "AFRICA": frozenset("ZA NG KE GH EG MA TN".split()),
    "UK & EU": frozenset("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE GB".split()),
}
_REGION_WORDS: dict[str, str] = {
    "eu": "EU", "european union": "EU", "europe": "EUROPE", "emea": "EMEA", "mena": "MENA", "middle east": "MENA",
    "apac": "APAC", "asia pacific": "APAC", "asia-pacific": "APAC", "asia": "ASIA", "south asia": "SOUTH ASIA",
    "anz": "ANZ", "oceania": "ANZ", "north america": "NORTH AMERICA", "americas": "AMERICAS", "latam": "LATAM",
    "latin america": "LATAM", "south america": "LATAM", "africa": "AFRICA", "dach": "EUROPE", "nordics": "EUROPE",
    "cet": "EUROPE", "est": "NORTH AMERICA", "pst": "NORTH AMERICA", "cst": "NORTH AMERICA",
    "ist": "SOUTH ASIA",
}
_ANYWHERE = re.compile(r"(?<![a-z])(anywhere|worldwide|world ?wide|global(?:ly)?|international|any country|"
                       r"all countries)(?![a-z])")

_CITY_OF: dict[str, str] = {}
for _name, (_cc, _aliases) in WORLD_CITIES.items():
    for _alias in (_name.lower(), *_aliases):
        _CITY_OF[_alias] = _name


def _words(table: dict[str, str]) -> re.Pattern[str]:
    return re.compile(r"(?<![a-z0-9])(" + "|".join(sorted(map(re.escape, table), key=len, reverse=True))
                      + r")(?![a-z0-9])")


_CITY_RE = _words(_CITY_OF)
_COUNTRY_RE = _words(COUNTRY_WORDS)
_REGION_RE = _words(_REGION_WORDS)
_STATE_RE = re.compile(r",\s*([A-Z]{2})\b")


def world_cities(text: str) -> list[str]:
    """The world (non-Indian) cities a location text names, canonical and in order."""
    out: list[str] = []
    for m in _CITY_RE.finditer(text.lower()):
        city = _CITY_OF[m.group(1)]
        if city not in out:
            out.append(city)
    return out


def city_country(city: str) -> str | None:
    hit = WORLD_CITIES.get(city)
    return hit[0] if hit else None


@lru_cache(maxsize=64)
def cities_in(country: str) -> tuple[str, ...]:
    """The canonical world cities of a country, in table order (the biggest job markets first)."""
    return tuple(name for name, (cc, _) in WORLD_CITIES.items() if cc == country.upper())


def countries_in(text: str) -> list[str]:
    """The countries a location text places a job in, in order: named outright, by a known city, or by a US state or
    Canadian province ("Austin, TX", "Toronto, ON")."""
    low = text.lower()
    out: list[str] = []

    def add(code: str) -> None:
        if code not in out:
            out.append(code)

    spans: list[tuple[int, str]] = []
    spans += [(m.start(), COUNTRY_WORDS[m.group(1)]) for m in _COUNTRY_RE.finditer(low)
              if not (m.group(1) == "us" and not _looks_like_us(text, m.start()))]
    spans += [(m.start(), WORLD_CITIES[_CITY_OF[m.group(1)]][0]) for m in _CITY_RE.finditer(low)]
    for m in _STATE_RE.finditer(text):
        code = m.group(1)
        if code in _US_STATES:
            spans.append((m.start(), "US"))
        elif code in _CA_PROVINCES:
            spans.append((m.start(), "CA"))
    for name in _US_STATE_NAMES:
        i = low.find(name)
        if i >= 0 and re.match(r"(?<![a-z])" + re.escape(name) + r"(?![a-z])", low[i:]):
            spans.append((i, "US"))
    for name in _CA_PROVINCE_NAMES:
        i = low.find(name)
        if i >= 0:
            spans.append((i, "CA"))
    for _, code in sorted(spans):
        add(code)
    return out


def _looks_like_us(text: str, at: int) -> bool:
    """"US" as a place ("Remote - US", "US only", "(US)"), not the word "us" ("join us")."""
    return text[at:at + 2] == "US"


def remote_scope(text: str) -> list[str]:
    """Who a remote post is open to, as its location text says: ["*"] for anywhere, else country codes and region
    names ("EMEA"); [] when it doesn't say."""
    low = text.lower()
    if _ANYWHERE.search(low):
        return ["*"]
    out = countries_in(text)
    for m in _REGION_RE.finditer(low):
        region = _REGION_WORDS[m.group(1)]
        if region not in out:
            out.append(region)
    return out


def open_to(scope: list[str] | tuple[str, ...] | None, country: str) -> bool:
    """Whether a remote post with this scope is open to someone in `country`."""
    if not scope:
        return False
    c = country.upper()
    return any(s == "*" or s == c or c in REGIONS.get(s, frozenset()) for s in scope)
