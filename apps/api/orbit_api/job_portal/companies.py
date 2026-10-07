"""The company job boards the feed reads: companies hiring in India that publish their openings through a public
applicant-tracking-system feed (no key, and every post links straight to the company's own application).

Checked live on 2026-10-07 as "posts / posts in India" (in an Indian city, or remote from India; SmartRecruiters:
posts worldwide / India posts, of which the feed reads the first 300). Extend or trim it without a deploy with
ORBIT_JOBS_BOARDS_JSON, a JSON array of {"ats", "token", "company"} (optional "india_first": true when a remote post
with no stated region is open to India) and {"ats", "token", "off": true} to take a built-in board off. Validated
at startup.
"""

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal, cast, get_args

from orbit_api.config import get_settings

Ats = Literal["greenhouse", "lever", "ashby", "smartrecruiters"]
_TOKEN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")


@dataclass(frozen=True)
class Board:
    ats: Ats
    token: str
    company: str
    # Mostly hires in India: a remote post that names no region is taken as open to India.
    india_first: bool = True


def _b(ats: Ats, company: str, token: str, india_first: bool = True) -> Board:
    return Board(ats, token, company, india_first)


DEFAULT_BOARDS: tuple[Board, ...] = (
    # Greenhouse
    _b("greenhouse", "Razorpay", "razorpaysoftwareprivatelimited"),  # 25 / 22
    _b("greenhouse", "Groww", "groww"),  # 7 / 7
    _b("greenhouse", "InMobi", "inmobi"),  # 70 / 36
    _b("greenhouse", "Glance", "glance"),  # 38 / 22
    _b("greenhouse", "HighRadius", "highradius"),  # 79 / 52
    _b("greenhouse", "PubMatic", "pubmatic"),  # 80 / 34
    _b("greenhouse", "Sigmoid", "sigmoid"),  # 37 / 32
    _b("greenhouse", "HackerRank", "hackerrank"),  # 28 / 26
    _b("greenhouse", "Druva", "druva"),  # 35 / 12
    _b("greenhouse", "Zeta Global", "zetaglobal", False),  # 142 / 41
    _b("greenhouse", "Observe.AI", "observeai"),  # 12 / 5
    _b("greenhouse", "Emergent", "emergentlabsinc"),  # 43 / 35
    _b("greenhouse", "AlphaSense", "alphasenseindia"),  # 31 / 31
    _b("greenhouse", "Zenoti", "zenoti"),  # 50 / 28
    _b("greenhouse", "Mitsogo", "mitsogoinc"),  # 38 / 22
    _b("greenhouse", "DoorDash", "doordashindia"),  # 19 / 19
    _b("greenhouse", "Graviton Research Capital", "gravitonresearchcapital"),  # 21 / 16
    _b("greenhouse", "CloudSEK", "cloudsek"),  # 18 / 16
    _b("greenhouse", "Blenheim Chalcot", "blenheimchalcotindia"),  # 6 / 6
    _b("greenhouse", "Okta", "okta", False),  # 376 / 120
    _b("greenhouse", "Databricks", "databricks", False),  # 885 / 92
    _b("greenhouse", "MongoDB", "mongodb", False),  # 395 / 82
    _b("greenhouse", "Zscaler", "zscaler", False),  # 366 / 72
    _b("greenhouse", "Stripe", "stripe", False),  # 726 / 57
    _b("greenhouse", "Cloudflare", "cloudflare", False),  # 417 / 43
    _b("greenhouse", "Rubrik", "rubrik", False),  # 131 / 34
    _b("greenhouse", "GitLab", "gitlab", False),  # 211 / 28
    _b("greenhouse", "Netskope", "netskope", False),  # 150 / 22
    _b("greenhouse", "Elastic", "elastic", False),  # 408 / 17
    _b("greenhouse", "Twilio", "twilio", False),  # 131 / 13
    _b("greenhouse", "Capco", "capco", False),  # 709 / 163
    _b("greenhouse", "Everpure (Pure Storage)", "purestorage", False),  # 353 / 81
    _b("greenhouse", "WPP", "wpp", False),  # 209 / 63
    _b("greenhouse", "Cohere Health", "coherehealth", False),  # 77 / 42
    _b("greenhouse", "Coupang", "coupang", False),  # 674 / 40
    _b("greenhouse", "Instawork", "instawork", False),  # 58 / 37
    _b("greenhouse", "Tide", "tide", False),  # 93 / 34
    _b("greenhouse", "Payoneer", "payoneer", False),  # 104 / 33
    _b("greenhouse", "Celonis", "celonis", False),  # 223 / 31
    _b("greenhouse", "SonicWall", "sonicwall", False),  # 48 / 30
    _b("greenhouse", "Anaplan", "anaplan", False),  # 143 / 28
    _b("greenhouse", "Arcesium", "arcesiumllc", False),  # 50 / 27
    _b("greenhouse", "Appian", "appian", False),  # 167 / 27
    _b("greenhouse", "OpenFX", "openfx", False),  # 40 / 26
    _b("greenhouse", "Glean", "gleanwork", False),  # 133 / 25
    _b("greenhouse", "GHX", "globalhealthcareexchangeinc", False),  # 51 / 25
    _b("greenhouse", "OneTrust", "onetrust", False),  # 93 / 24
    _b("greenhouse", "OLIVER", "oliverseapac", False),  # 44 / 24
    _b("greenhouse", "DevRev", "devrev", False),  # 51 / 21
    _b("greenhouse", "Smartsheet", "smartsheet", False),  # 92 / 21
    _b("greenhouse", "Energy Exemplar", "energyexemplarllc", False),  # 38 / 20
    _b("greenhouse", "IMC Trading", "imc", False),  # 171 / 17
    _b("greenhouse", "Toast", "toast", False),  # 321 / 16
    _b("greenhouse", "Fivetran", "fivetran", False),  # 196 / 16
    _b("greenhouse", "Commvault", "commvault", False),  # 57 / 15
    _b("greenhouse", "Guidepoint", "guidepoint", False),  # 106 / 14
    _b("greenhouse", "ChargePoint", "chargepoint", False),  # 32 / 14
    _b("greenhouse", "NeuraFlash", "neuraflash", False),  # 74 / 13
    _b("greenhouse", "Skillz", "skillzinc", False),  # 18 / 13
    _b("greenhouse", "Couchbase", "couchbaseinc", False),  # 20 / 12
    _b("greenhouse", "Redwood Software", "redwoodsoftware", False),  # 33 / 12
    _b("greenhouse", "6sense", "6sense", False),  # 32 / 12
    _b("greenhouse", "project44", "project44", False),  # 30 / 12
    _b("greenhouse", "Zinnia", "zinnia", False),  # 20 / 11
    _b("greenhouse", "Zynga", "zyngacareers", False),  # 45 / 11
    _b("greenhouse", "New Relic", "newrelic", False),  # 48 / 10
    _b("greenhouse", "Reltio", "reltio", False),  # 33 / 10
    _b("greenhouse", "JazzX AI", "jazzx-ai", False),  # 15 / 10
    _b("greenhouse", "Showpad", "showpad", False),  # 27 / 7
    # Lever
    _b("lever", "Paytm", "paytm"),  # 176 / 164
    _b("lever", "Meesho", "meesho"),  # 59 / 59
    _b("lever", "Hevo Data", "hevodata"),  # 52 / 50
    _b("lever", "Zeta", "zeta"),  # 25 / 23
    _b("lever", "Mindtickle", "mindtickle"),  # 19 / 18
    _b("lever", "FamPay", "fampay"),  # 16 / 16
    _b("lever", "CRED", "cred"),  # 8 / 8
    _b("lever", "Sprinto", "Sprinto"),  # 34 / 31
    _b("lever", "Stable Money", "stable-money1"),  # 17 / 17
    _b("lever", "Safe Security", "safe"),  # 18 / 15
    _b("lever", "Dozee", "dozee"),  # 18 / 15
    _b("lever", "Gushwork", "gushwork"),  # 12 / 8
    _b("lever", "Brillio", "brillio-2", False),  # 232 / 170
    _b("lever", "HighLevel", "gohighlevel", False),  # 87 / 65
    _b("lever", "AHEAD", "thinkahead", False),  # 148 / 62
    _b("lever", "Extreme Networks", "extremenetworks", False),  # 136 / 42
    _b("lever", "Dun & Bradstreet", "dnb", False),  # 111 / 24
    _b("lever", "JumpCloud", "jumpcloud", False),  # 31 / 16
    _b("lever", "PDI Technologies", "pditechnologies", False),  # 24 / 15
    _b("lever", "Cyderes", "cyderes", False),  # 23 / 15
    _b("lever", "Neuron7", "neuron7", False),  # 18 / 14
    _b("lever", "Endpoint Clinical", "endpointclinical", False),  # 23 / 13
    _b("lever", "Pattern", "pattern", False),  # 98 / 13
    _b("lever", "ION Group", "ion", False),  # 89 / 13
    _b("lever", "GALE", "galepartners", False),  # 14 / 13
    _b("lever", "Kobie", "kobie", False),  # 27 / 11
    _b("lever", "Nium", "nium", False),  # 17 / 9
    _b("lever", "Portcast", "portcast", False),  # 11 / 9
    _b("lever", "ShyftLabs", "shyftlabs", False),  # 23 / 8
    _b("lever", "Everbridge", "everbridge", False),  # 19 / 5
    # Ashby
    _b("ashby", "Sarvam AI", "sarvam"),  # 54 / 54
    _b("ashby", "Tekion", "tekion"),  # 102 / 82
    _b("ashby", "SpotDraft", "spotdraft"),  # 15 / 11
    _b("ashby", "Atlan", "atlan"),  # 6 / 4
    _b("ashby", "Meraki Labs", "Meraki-Labs"),  # 16 / 16
    _b("ashby", "Bolna", "bolna"),  # 7 / 7
    _b("ashby", "Snowflake", "snowflake", False),  # 355 / 12
    _b("ashby", "OpenAI", "openai", False),  # 819 / 10
    _b("ashby", "Atlys", "atlys", False),  # 51 / 33
    _b("ashby", "NETGEAR", "netgear", False),  # 51 / 31
    _b("ashby", "G2", "g2", False),  # 50 / 22
    _b("ashby", "Kandou AI", "kandou-ai", False),  # 38 / 16
    _b("ashby", "Kong", "kong", False),  # 79 / 12
    _b("ashby", "CertifyOS", "certifyos", False),  # 14 / 10
    _b("ashby", "Plane", "plane", False),  # 33 / 10
    _b("ashby", "Wisdom AI", "Wisdom-AI", False),  # 18 / 8
    _b("ashby", "Collinear AI", "collinear-ai", False),  # 15 / 6
    _b("ashby", "Weave", "weave", False),  # 24 / 6
    _b("ashby", "Ontic", "Ontic", False),  # 17 / 5
    # SmartRecruiters (asked for India only: country=in)
    _b("smartrecruiters", "Swiggy", "swiggy"),  # 170 / 168
    _b("smartrecruiters", "PhonePe", "PHONEPELIMITED"),  # 90 / 90
    _b("smartrecruiters", "ServiceNow", "servicenow", False),  # 712 / 76
    _b("smartrecruiters", "NielsenIQ", "nielseniq", False),  # 419 / 70
    _b("smartrecruiters", "Freshworks", "freshworks", False),  # 124 / 31
    _b("smartrecruiters", "ixigo", "ixigo"),  # 10 / 10
    _b("smartrecruiters", "Grab", "grab", False),  # 455 / 10
    _b("smartrecruiters", "Bosch", "boschgroup", False),  # 4859 / 543
    _b("smartrecruiters", "Nagarro", "nagarro1", False),  # 856 / 454
    _b("smartrecruiters", "Eurofins", "Eurofins", False),  # 2557 / 343
    _b("smartrecruiters", "Renesas", "RenesasElectronics", False),  # 949 / 117
    _b("smartrecruiters", "METRO", "METROMAKRO", False),  # 1579 / 57
    _b("smartrecruiters", "Nielsen", "TheNielsenCompany", False),  # 126 / 56
    _b("smartrecruiters", "NEC Software Solutions", "NECSWS", False),  # 92 / 52
    _b("smartrecruiters", "LinkedIn", "LinkedIn3", False),  # 330 / 51
    _b("smartrecruiters", "QAD", "QADInc", False),  # 52 / 38
    _b("smartrecruiters", "Experian", "experian", False),  # 395 / 36
    _b("smartrecruiters", "Miratech", "Miratech1", False),  # 197 / 36
    _b("smartrecruiters", "Avery Dennison", "averydennison", False),  # 489 / 33
    _b("smartrecruiters", "EVERSANA", "EVERSANA1", False),  # 224 / 31
    _b("smartrecruiters", "Wise", "wise", False),  # 399 / 30
    _b("smartrecruiters", "Version 1", "Version1", False),  # 151 / 27
    _b("smartrecruiters", "Arista Networks", "aristanetworks", False),  # 242 / 23
    _b("smartrecruiters", "Blend360", "Blend360", False),  # 167 / 19
    _b("smartrecruiters", "Check Point Software", "CheckPointSoftwareTechnologies2", False),  # 404 / 18
    _b("smartrecruiters", "Jitterbit", "Jitterbit", False),  # 27 / 13
    _b("smartrecruiters", "Nexthink", "Nexthink", False),  # 77 / 12
    _b("smartrecruiters", "MicroStrategy", "MicroStrategy1", False),  # 37 / 11
    _b("smartrecruiters", "Continental", "continental", False),  # 594 / 11
)


def parse_boards(raw: str | None) -> tuple[Board, ...]:
    """The built-in boards with ORBIT_JOBS_BOARDS_JSON applied. Raises ValueError on anything malformed."""
    boards = {(b.ats, b.token.lower()): b for b in DEFAULT_BOARDS}
    if not raw:
        return tuple(boards.values())
    items = json.loads(raw)
    if not isinstance(items, list):
        raise ValueError("ORBIT_JOBS_BOARDS_JSON must be a JSON array")
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            raise ValueError(f"ORBIT_JOBS_BOARDS_JSON[{i}] must be an object")
        token = str(item.get("token") or "")
        if item.get("ats") not in get_args(Ats):
            raise ValueError(f"ORBIT_JOBS_BOARDS_JSON[{i}].ats must be one of {list(get_args(Ats))}")
        ats = cast(Ats, item["ats"])
        if not _TOKEN.match(token):
            raise ValueError(f"ORBIT_JOBS_BOARDS_JSON[{i}].token must be letters, digits, '.', '_' or '-'")
        key = (ats, token.lower())
        if item.get("off"):
            boards.pop(key, None)
            continue
        company = str(item.get("company") or "").strip()
        if not company or len(company) > 120:
            raise ValueError(f"ORBIT_JOBS_BOARDS_JSON[{i}].company is required (up to 120 characters)")
        boards[key] = Board(ats, token, company, bool(item.get("india_first", False)))
    return tuple(boards.values())


@lru_cache(maxsize=4)
def _boards(raw: str | None) -> tuple[Board, ...]:
    return parse_boards(raw)


def boards(ats: Ats | None = None) -> list[Board]:
    out = _boards(get_settings().jobs_boards_json)
    return [b for b in out if ats is None or b.ats == ats]
