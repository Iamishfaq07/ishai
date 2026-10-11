"""The country a user is applying for jobs in (ISO 3166-1 alpha-2), which sets the currency, sample salaries, job
search and wording they see. India, the first market, keeps its own conventions (₹, LPA, campus rounds, Naukri);
everywhere else gets worldwide ones.
"""

# Every officially assigned ISO 3166-1 alpha-2 code.
_CODES = frozenset("""
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC
CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD
GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH
KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW
MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC
SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY
UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW
""".split())
INDIA = "IN"


def country_code(value: str | None) -> str | None:
    """A valid ISO 3166-1 alpha-2 code, uppercased ("gb" → "GB", "UK" → "GB"), or None."""
    code = (value or "").strip().upper()
    if code == "UK":
        code = "GB"
    return code if code in _CODES else None


def is_india(country: str | None) -> bool:
    return (country or "").upper() == INDIA

# Names for the countries people most often apply in; any other valid code is named by its code in prompts.
NAMES: dict[str, str] = {
    "IN": "India", "US": "the United States", "GB": "the United Kingdom", "CA": "Canada", "AU": "Australia",
    "NZ": "New Zealand", "IE": "Ireland", "DE": "Germany", "FR": "France", "NL": "the Netherlands", "ES": "Spain",
    "IT": "Italy", "PT": "Portugal", "BE": "Belgium", "CH": "Switzerland", "AT": "Austria", "SE": "Sweden",
    "NO": "Norway", "DK": "Denmark", "FI": "Finland", "PL": "Poland", "CZ": "Czechia", "RO": "Romania",
    "GR": "Greece", "AE": "the United Arab Emirates", "SA": "Saudi Arabia", "QA": "Qatar", "KW": "Kuwait",
    "OM": "Oman", "BH": "Bahrain", "IL": "Israel", "TR": "Türkiye", "EG": "Egypt", "SG": "Singapore",
    "MY": "Malaysia", "ID": "Indonesia", "PH": "the Philippines", "TH": "Thailand", "VN": "Vietnam", "JP": "Japan",
    "KR": "South Korea", "CN": "China", "HK": "Hong Kong", "TW": "Taiwan", "PK": "Pakistan", "BD": "Bangladesh",
    "LK": "Sri Lanka", "NP": "Nepal", "ZA": "South Africa", "NG": "Nigeria", "KE": "Kenya", "GH": "Ghana",
    "BR": "Brazil", "MX": "Mexico", "AR": "Argentina", "CL": "Chile", "CO": "Colombia", "PE": "Peru",
}
# The variety of business English a message is written in.
_ENGLISH = {"IN": "plain Indian-English business style", "GB": "plain British business English",
            "IE": "plain British business English", "AU": "plain Australian business English",
            "NZ": "plain British business English", "US": "plain American business English",
            "CA": "plain Canadian business English"}


def country_name(country: str | None) -> str | None:
    code = country_code(country)
    return NAMES.get(code, code) if code else None


def localize(prompt: str, country: str | None) -> str:
    """Fill a prompt's place markers for the country the user applies in: `__IN_COUNTRY__` (" in India", or nothing
    when unknown) and `__ENGLISH__` (the variety of business English to write in)."""
    code = country_code(country)
    name = country_name(code)
    return (prompt.replace("__IN_COUNTRY__", f" in {name}" if name else "")
            .replace("__ENGLISH__", _ENGLISH.get(code or "", "plain, international business English")))
