"""The company job boards the feed reads: companies that publish their openings through a public
applicant-tracking-system feed (no key, and every post links straight to the company's own application). First the
ones hiring in India, then well-known employers hiring in the US, the UK, Canada, Germany and the rest of Europe, and
Australia. Each user's feed keeps the posts in the country they apply in (postings.py), so a board's posts elsewhere
cost refresh time and nothing else.

The India list was checked live on 2026-10-07 as "posts / posts in India" (in an Indian city, or remote from India;
SmartRecruiters: posts worldwide / India posts, of which the feed reads the first 300). The rest on 2026-10-17 as
"posts / listed: the countries most are in" (listed: posted in the last 30 days, and in a country or remote and open
to one; SmartRecruiters: posts worldwide / posts in the countries it's asked for). Extend or trim it without a deploy
with ORBIT_JOBS_BOARDS_JSON, a JSON array of {"ats", "token", "company"} (optional "india_first": true when a remote
post with no stated region is open to India) and {"ats", "token", "off": true} to take a built-in board off.
Validated at startup.
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
    # Mostly hires in India: a remote post that names no region is taken as open to India, and SmartRecruiters is
    # asked for India's posts only. That's all it changes: the feed doesn't rank by it.
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
    # SmartRecruiters (asked one country at a time: India, and for the boards not India-first also each of
    # ORBIT_JOBS_BOARD_COUNTRIES)
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
    # ---- Hiring mostly outside India: the US, the UK, Canada, Germany and the rest of Europe, Australia, and
    # remote. Their posts in India are listed too.
    # Greenhouse
    _b("greenhouse", "Anthropic", "anthropic", False),  # 653 / 181: US 138, GB 12, DE 6
    _b("greenhouse", "Airbnb", "airbnb", False),  # 171 / 70: US 42, BR 5, CA 4
    _b("greenhouse", "Lyft", "lyft", False),  # 174 / 52: CA 23, US 23, MX 6
    _b("greenhouse", "Pinterest", "pinterest", False),  # 156 / 84: US 63, SG 5, BR 3
    _b("greenhouse", "Robinhood", "robinhood", False),  # 152 / 69: US 57, CA 7, GB 5
    _b("greenhouse", "Coinbase", "coinbase", False),  # 225 / 74: US 57, GB 5, AE 4
    _b("greenhouse", "Discord", "discord", False),  # 47 / 16: US 15, PT 1
    _b("greenhouse", "Figma", "figma", False),  # 141 / 34: US 28, BR 2, GB 2
    _b("greenhouse", "Reddit", "reddit", False),  # 149 / 36: US 29, NL 3, GB 3
    _b("greenhouse", "Duolingo", "duolingo", False),  # 64 / 14: US 12, IN 1, GB 1
    _b("greenhouse", "Instacart", "instacart", False),  # 123 / 52: US 31, CA 20, IL 1
    _b("greenhouse", "Datadog", "datadog", False),  # 430 / 108: US 69, SG 6, NL 5
    _b("greenhouse", "Asana", "asana", False),  # 103 / 47: US 27, CA 12, PL 5
    _b("greenhouse", "Brex", "brex", False),  # 260 / 75: US 59, CA 9, BR 7
    _b("greenhouse", "Gusto", "gusto", False),  # 103 / 42: US 42
    _b("greenhouse", "Affirm", "affirm", False),  # 212 / 82: US 39, CA 33, GB 7
    _b("greenhouse", "Chime", "chime", False),  # 72 / 37: US 37
    _b("greenhouse", "Samsara", "samsara", False),  # 259 / 69: US 48, CA 9, GB 4
    _b("greenhouse", "Flexport", "flexport", False),  # 211 / 61: US 29, NL 9, CN 8
    _b("greenhouse", "Twitch", "twitch", False),  # 46 / 18: US 18
    _b("greenhouse", "Roblox", "roblox", False),  # 261 / 88: US 82, IN 2, NL 1
    _b("greenhouse", "Scale AI", "scaleai", False),  # 183 / 23: US 17, GB 4, MX 1
    _b("greenhouse", "Vercel", "vercel", False),  # 93 / 18: US 17, GB 1
    _b("greenhouse", "Waymo", "waymo", False),  # 362 / 117: US 95, GB 8, PL 5
    _b("greenhouse", "DoorDash", "doordashusa", False),  # 455 / 144: US 144
    _b("greenhouse", "Relativity", "relativity", False),  # 366 / 137: US 137
    _b("greenhouse", "Riot Games", "riotgames", False),  # 174 / 63: US 39, CN 12, AU 5
    _b("greenhouse", "Epic Games", "epicgames", False),  # 137 / 34: US 22, CA 8, PT 2
    _b("greenhouse", "Klaviyo", "klaviyo", False),  # 153 / 63: US 46, GB 6, AU 5
    _b("greenhouse", "Verkada", "verkada", False),  # 319 / 70: US 52, GB 4, CA 3
    _b("greenhouse", "Nuro", "nuro", False),  # 110 / 22: US 22
    _b("greenhouse", "SoFi", "sofi", False),  # 49 / 22: US 22
    _b("greenhouse", "Peloton", "peloton", False),  # 53 / 21: US 15, TW 3, PL 2
    _b("greenhouse", "Mixpanel", "mixpanel", False),  # 49 / 21: US 15, SG 4, GB 1
    _b("greenhouse", "LaunchDarkly", "launchdarkly", False),  # 51 / 20: US 15, IN 2, AU 1, remote 1
    _b("greenhouse", "PagerDuty", "pagerduty", False),  # 61 / 29: US 20, CA 5, PT 3
    _b("greenhouse", "Carta", "carta", False),  # 76 / 27: US 12, GB 7, CA 6
    _b("greenhouse", "Ripple", "ripple", False),  # 102 / 34: US 21, GB 7, SG 2
    _b("greenhouse", "Justworks", "justworks", False),  # 99 / 40: US 36, MX 2, CA 2
    _b("greenhouse", "Oscar Health", "oscar", False),  # 242 / 61: US 61
    _b("greenhouse", "Faire", "faire", False),  # 78 / 34: US 27, CA 6, GB 1
    _b("greenhouse", "ZoomInfo", "zoominfo", False),  # 106 / 37: US 17, CA 9, IN 8
    _b("greenhouse", "Mozilla", "mozilla", False),  # 98 / 39: US 9, CA 8, DE 7
    _b("greenhouse", "Grafana Labs", "grafanalabs", False),  # 106 / 43: US 17, GB 5, CA 4
    _b("greenhouse", "Intercom", "intercom", False),  # 107 / 23: US 10, IE 7, GB 4
    _b("greenhouse", "Tripadvisor", "tripadvisor", False),  # 96 / 22: GB 14, ES 3, NL 2
    _b("greenhouse", "Sigma Computing", "sigmacomputing", False),  # 75 / 12: US 10, GB 2
    _b("greenhouse", "Attentive", "attentive", False),  # 26 / 12: US 12
    _b("greenhouse", "Gemini", "gemini", False),  # 31 / 9: US 9
    _b("greenhouse", "Deliveroo", "deliveroo", False),  # 228 / 217: GB 148, IT 23, AE 16
    _b("greenhouse", "Monzo", "monzo", False),  # 71 / 22: GB 16, IE 4, ES 2
    _b("greenhouse", "GoCardless", "gocardless", False),  # 32 / 10: GB 5, PT 3, AU 1
    _b("greenhouse", "Ebury", "ebury", False),  # 143 / 80: ES 25, GB 8, DE 7
    _b("greenhouse", "HelloFresh", "hellofresh", False),  # 405 / 173: US 48, CA 44, DE 35
    _b("greenhouse", "GetYourGuide", "getyourguide", False),  # 70 / 35: DE 25, CH 4, BR 2
    _b("greenhouse", "N26", "n26", False),  # 35 / 12: DE 6, ES 5, FR 1
    _b("greenhouse", "SumUp", "sumup", False),  # 335 / 79: BR 19, GB 16, DE 15
    _b("greenhouse", "Contentful", "contentful", False),  # 22 / 13: US 8, GB 4, DE 1
    _b("greenhouse", "Raisin", "raisin", False),  # 39 / 14: DE 10, GB 2, US 2
    _b("greenhouse", "Staffbase", "staffbase", False),  # 23 / 14: CA 7, DE 6, GB 1
    _b("greenhouse", "Helsing", "helsing", False),  # 156 / 30: DE 18, GB 7, US 3
    _b("greenhouse", "Isar Aerospace", "isaraerospace", False),  # 119 / 36: DE 31, CA 4, SE 1
    _b("greenhouse", "Doctolib", "doctolib", False),  # 149 / 56: FR 27, DE 25, IT 3
    _b("greenhouse", "IONOS", "ionos", False),  # 39 / 9: DE 9
    _b("greenhouse", "Adyen", "adyen", False),  # 250 / 83: NL 39, US 17, SG 9
    _b("greenhouse", "Catawiki", "catawiki", False),  # 42 / 18: NL 15, BE 1, IT 1
    _b("greenhouse", "Algolia", "algolia", False),  # 37 / 13: FR 7, US 3, NL 2
    _b("greenhouse", "Culture Amp", "cultureamp", False),  # 31 / 17: AU 9, US 6, GB 1
    _b("greenhouse", "Prospa", "prospa", False),  # 8 / 4: AU 4
    # Lever
    _b("lever", "Spotify", "spotify", False),  # 82 / 37: US 15, GB 10, SE 4
    _b("lever", "Zoox", "zoox", False),  # 241 / 60: US 60
    _b("lever", "Crypto.com", "crypto", False),  # 89 / 48: US 14, HK 11, GB 5
    _b("lever", "Match Group", "matchgroup", False),  # 66 / 19: US 16, CA 3
    _b("lever", "Zopa", "zopa", False),  # 35 / 15: GB 15
    # Ashby
    _b("ashby", "Notion", "notion", False),  # 129 / 31: US 21, IE 5, JP 3
    _b("ashby", "Ramp", "ramp", False),  # 165 / 49: US 46, GB 3
    _b("ashby", "Plaid", "plaid", False),  # 128 / 51: US 44, GB 7
    _b("ashby", "Vanta", "vanta", False),  # 85 / 33: US 18, GB 9, IE 4
    _b("ashby", "Perplexity", "perplexity", False),  # 132 / 29: US 23, GB 5, DE 1
    _b("ashby", "Cursor", "cursor", False),  # 133 / 30: US 12, AU 4, JP 4
    _b("ashby", "Harvey", "harvey", False),  # 342 / 139: US 78, IE 17, GB 17
    _b("ashby", "Sierra", "sierra", False),  # 186 / 40: US 31, SG 4, JP 2
    _b("ashby", "Decagon", "decagon", False),  # 141 / 24: US 17, GB 3, AU 2
    _b("ashby", "Writer", "writer", False),  # 47 / 47: US 35, GB 12
    _b("ashby", "LangChain", "langchain", False),  # 102 / 51: US 37, GB 7, SG 3
    _b("ashby", "Replit", "replit", False),  # 65 / 17: US 17
    _b("ashby", "Modal", "modal", False),  # 43 / 15: US 13, SE 2
    _b("ashby", "Sentry", "sentry", False),  # 46 / 19: US 14, CA 4, AT 1
    _b("ashby", "Benchling", "benchling", False),  # 56 / 23: US 17, GB 4, CH 2
    _b("ashby", "Temporal", "temporal", False),  # 71 / 29: US 28, CA 1
    _b("ashby", "Docker", "docker", False),  # 68 / 28: US 10, CA 9, GB 7
    _b("ashby", "Snyk", "snyk", False),  # 27 / 27: US 18, GB 3, RO 2
    _b("ashby", "Cohere", "cohere", False),  # 118 / 25: US 8, CA 7, GB 3
    _b("ashby", "1Password", "1password", False),  # 74 / 47: US 35, GB 7, CA 3
    _b("ashby", "Wealthsimple", "wealthsimple", False),  # 47 / 21: CA 21
    _b("ashby", "incident.io", "incident", False),  # 34 / 16: GB 8, US 8
    _b("ashby", "Lovable", "lovable", False),  # 81 / 22: SE 12, GB 7, US 2
    _b("ashby", "Synthesia", "synthesia", False),  # 47 / 12: GB 6, US 2, DE 2
    _b("ashby", "Multiverse", "multiverse", False),  # 31 / 18: GB 18
    _b("ashby", "ElevenLabs", "elevenlabs", False),  # 156 / 103: US 42, GB 19, IN 6
    _b("ashby", "Supabase", "supabase", False),  # 54 / 12: remote 12
    _b("ashby", "n8n", "n8n", False),  # 42 / 25: DE 16, US 8, GB 1
    _b("ashby", "Wayve", "wayve", False),  # 174 / 174: US 76, GB 54, DE 22
    _b("ashby", "Granola", "granola", False),  # 22 / 9: GB 6, US 3
    _b("ashby", "Pleo", "pleo", False),  # 27 / 14: PT 6, GB 5, DK 2
    _b("ashby", "Airwallex", "airwallex", False),  # 496 / 142: US 49, SG 28, GB 12
    _b("ashby", "Faculty", "faculty", False),  # 77 / 31: GB 31
    _b("ashby", "Lendable", "lendable", False),  # 67 / 29: GB 26, PL 2, MX 1
    _b("ashby", "Enpal", "enpal", False),  # 156 / 53: DE 48, IT 5
    _b("ashby", "Jobber", "jobber", False),  # 43 / 21: CA 19, US 2
    _b("ashby", "Motorway", "motorway", False),  # 17 / 11: GB 11
    _b("ashby", "Alan", "alan", False),  # 125 / 62: FR 48, BE 5, ES 4
    _b("ashby", "Qonto", "qonto", False),  # 53 / 44: FR 27, ES 8, DE 5
    # SmartRecruiters
    _b("smartrecruiters", "Ubisoft", "Ubisoft2", False),  # 331 / CA 136, DE 7, GB 5
    _b("smartrecruiters", "Canva", "Canva", False),  # 111 / AU 30, US 20, GB 6
    _b("smartrecruiters", "Western Digital", "WesternDigital", False),  # 333 / US 90, DE 7
    _b("smartrecruiters", "Delivery Hero", "DeliveryHero", False),  # 941 / DE 21
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
