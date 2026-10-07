"""The company job boards the feed reads: companies hiring in India that publish their openings through a public
applicant-tracking-system feed (no key, and every post links straight to the company's own application).

Checked live on 2026-10-07 as "posts / posts in Indian cities". Extend or trim it without a deploy with
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
    # Lever
    _b("lever", "Paytm", "paytm"),  # 176 / 164
    _b("lever", "Meesho", "meesho"),  # 59 / 59
    _b("lever", "Hevo Data", "hevodata"),  # 52 / 50
    _b("lever", "Zeta", "zeta"),  # 25 / 23
    _b("lever", "Mindtickle", "mindtickle"),  # 19 / 18
    _b("lever", "FamPay", "fampay"),  # 16 / 16
    _b("lever", "CRED", "cred"),  # 8 / 8
    # Ashby
    _b("ashby", "Sarvam AI", "sarvam"),  # 54 / 54
    _b("ashby", "Tekion", "tekion"),  # 102 / 82
    _b("ashby", "SpotDraft", "spotdraft"),  # 15 / 11
    _b("ashby", "Atlan", "atlan"),  # 6 / 4
    _b("ashby", "Snowflake", "snowflake", False),  # 355 / 12
    _b("ashby", "OpenAI", "openai", False),  # 819 / 10
    # SmartRecruiters (asked for India only: country=in)
    _b("smartrecruiters", "Swiggy", "swiggy"),  # 170 / 168
    _b("smartrecruiters", "ServiceNow", "servicenow", False),  # 712 / 76
    _b("smartrecruiters", "NielsenIQ", "nielseniq", False),  # 419 / 70
    _b("smartrecruiters", "Freshworks", "freshworks", False),  # 124 / 31
    _b("smartrecruiters", "ixigo", "ixigo"),  # 10 / 10
    _b("smartrecruiters", "Grab", "grab", False),  # 455 / 10
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
