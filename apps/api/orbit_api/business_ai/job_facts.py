"""The job assistant's deterministic reading of a recruiter's few words (D85): title, place, remote or hybrid,
employment type, experience, pay, skills and languages, from the common ways people write them, in English and
Hindi. The assistant (job_fill.py) uses it three ways: as the facts a model's answer is checked against (pay above
all: a salary is only ever one the recruiter wrote), as the whole answer when the model is unavailable, and for the
mock model in development.

Pay formats it reads: "18-28 LPA", "18 to 28 lakh CTC", "12 LPA", "up to 12 LPA", "1.2 Cr", "₹25,000 per month",
"25k/month stipend", "$90-120k", "USD 90,000-120,000", "€60-75k", "£45k", "AED 15,000 a month", "$40/hr", "15 हज़ार
प्रति माह", "4-6 लाख". Indian formats become INR a year ("18-28 LPA" -> 1,800,000-2,800,000). A figure with no
currency and no unit is only pay when a pay word is next to it ("stipend 15000"), in the company's currency, and the
assumption is said.
"""

import re
from dataclasses import dataclass, field

CURRENCIES = ("INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD")
CURRENCY_BY_COUNTRY = {"IN": "INR", "US": "USD", "GB": "GBP", "AE": "AED", "SG": "SGD", "AU": "AUD", "CA": "CAD",
                       **{c: "EUR" for c in ("DE", "FR", "NL", "ES", "IT", "IE", "PT", "BE", "AT", "FI", "GR", "LU",
                                             "SK", "SI", "EE", "LV", "LT", "MT", "CY", "HR")}}
EXPERIENCE_BANDS = ("entry", "junior", "mid", "senior", "lead")
BAND_YEARS = {"entry": "0-1 years", "junior": "1-3 years", "mid": "3-5 years", "senior": "5-8 years",
              "lead": "8+ years"}

COUNTRY_NAMES = {
    "IN": "India", "US": "the United States", "GB": "the United Kingdom", "IE": "Ireland", "DE": "Germany",
    "NL": "the Netherlands", "FR": "France", "ES": "Spain", "PT": "Portugal", "PL": "Poland", "SE": "Sweden",
    "DK": "Denmark", "CH": "Switzerland", "AT": "Austria", "CZ": "Czechia", "IT": "Italy", "BE": "Belgium",
    "FI": "Finland", "NO": "Norway", "RO": "Romania", "CA": "Canada", "AU": "Australia", "NZ": "New Zealand",
    "SG": "Singapore", "AE": "the UAE", "SA": "Saudi Arabia", "QA": "Qatar", "JP": "Japan", "HK": "Hong Kong",
    "MY": "Malaysia", "ID": "Indonesia", "PH": "the Philippines", "TH": "Thailand", "KE": "Kenya", "NG": "Nigeria",
    "EG": "Egypt", "PK": "Pakistan", "BD": "Bangladesh", "LK": "Sri Lanka", "NP": "Nepal", "MX": "Mexico",
    "BR": "Brazil", "ZA": "South Africa",
}
# "Remote, Europe time zones": the countries a European-hours remote job is usually open to (said as an assumption).
EUROPE = ["GB", "IE", "DE", "NL", "FR", "ES", "PT", "IT", "BE", "AT", "CH", "PL", "CZ", "SE", "DK", "FI", "NO",
          "RO"]
_COUNTRY_WORDS: tuple[tuple[str, list[str]], ...] = (
    (r"india|indian\s+time|ist\b|भारत", ["IN"]),
    (r"(?:the\s+)?(?:us|usa|u\.s\.a?\.?|united\s+states|america|north\s+america)(?![\w$])", ["US"]),
    (r"uk|u\.k\.|united\s+kingdom|britain|england", ["GB"]),
    (r"canada", ["CA"]), (r"germany", ["DE"]), (r"netherlands|holland", ["NL"]), (r"france", ["FR"]),
    (r"spain", ["ES"]), (r"portugal", ["PT"]), (r"poland", ["PL"]), (r"ireland", ["IE"]), (r"sweden", ["SE"]),
    (r"australia", ["AU"]), (r"new\s+zealand", ["NZ"]), (r"singapore", ["SG"]), (r"uae|emirates", ["AE"]),
    (r"europe(?:an)?|eu\b|emea|cet|cest|european\s+time\s*zones?", EUROPE),
)

# (alias pattern, canonical city, country). English and Hindi spellings.
_CITIES: tuple[tuple[str, str, str], ...] = (
    (r"bengaluru|bangalore|blr|बेंगलुरु|बेंगलूरु|बंगलौर|बैंगलोर", "Bengaluru", "IN"),
    (r"navi\s+mumbai", "Navi Mumbai", "IN"), (r"thane", "Thane", "IN"),
    (r"mumbai|bombay|मुंबई|मुम्बई", "Mumbai", "IN"),
    (r"delhi\s+ncr|ncr|दिल्ली\s+एनसीआर", "Delhi NCR", "IN"),
    (r"new\s+delhi|delhi|नई\s+दिल्ली|दिल्ली", "Delhi", "IN"),
    (r"gurugram|gurgaon|गुड़गांव|गुरुग्राम|गुडगाँव", "Gurugram", "IN"),
    (r"greater\s+noida", "Greater Noida", "IN"), (r"noida|नोएडा", "Noida", "IN"),
    (r"hyderabad|हैदराबाद", "Hyderabad", "IN"), (r"chennai|madras|चेन्नई", "Chennai", "IN"),
    (r"kolkata|calcutta|कोलकाता", "Kolkata", "IN"), (r"pune|पुणे", "Pune", "IN"),
    (r"ahmedabad|अहमदाबाद", "Ahmedabad", "IN"), (r"jaipur|जयपुर", "Jaipur", "IN"),
    (r"kochi|cochin", "Kochi", "IN"), (r"thiruvananthapuram|trivandrum", "Thiruvananthapuram", "IN"),
    (r"coimbatore", "Coimbatore", "IN"), (r"chandigarh|चंडीगढ़", "Chandigarh", "IN"), (r"mohali", "Mohali", "IN"),
    (r"indore|इंदौर", "Indore", "IN"), (r"lucknow|लखनऊ", "Lucknow", "IN"), (r"nagpur|नागपुर", "Nagpur", "IN"),
    (r"surat", "Surat", "IN"), (r"vadodara|baroda", "Vadodara", "IN"), (r"bhubaneswar", "Bhubaneswar", "IN"),
    (r"visakhapatnam|vizag", "Visakhapatnam", "IN"), (r"mysuru|mysore", "Mysuru", "IN"),
    (r"mangaluru|mangalore", "Mangaluru", "IN"), (r"srinagar|श्रीनगर", "Srinagar", "IN"), (r"jammu", "Jammu", "IN"),
    (r"patna|पटना", "Patna", "IN"), (r"bhopal|भोपाल", "Bhopal", "IN"), (r"goa", "Goa", "IN"),
    (r"dehradun", "Dehradun", "IN"), (r"guwahati", "Guwahati", "IN"), (r"kanpur", "Kanpur", "IN"),
    (r"ludhiana", "Ludhiana", "IN"), (r"nashik", "Nashik", "IN"), (r"raipur", "Raipur", "IN"),
    (r"ranchi", "Ranchi", "IN"),
    (r"london", "London", "GB"), (r"manchester", "Manchester", "GB"), (r"edinburgh", "Edinburgh", "GB"),
    (r"dublin", "Dublin", "IE"), (r"berlin", "Berlin", "DE"), (r"munich|münchen", "Munich", "DE"),
    (r"hamburg", "Hamburg", "DE"), (r"amsterdam", "Amsterdam", "NL"), (r"paris", "Paris", "FR"),
    (r"madrid", "Madrid", "ES"), (r"barcelona", "Barcelona", "ES"), (r"lisbon", "Lisbon", "PT"),
    (r"warsaw", "Warsaw", "PL"), (r"stockholm", "Stockholm", "SE"), (r"copenhagen", "Copenhagen", "DK"),
    (r"zurich|zürich", "Zurich", "CH"), (r"vienna", "Vienna", "AT"), (r"prague", "Prague", "CZ"),
    (r"new\s+york(?:\s+city)?|nyc", "New York", "US"), (r"san\s+francisco|bay\s+area", "San Francisco", "US"),
    (r"seattle", "Seattle", "US"), (r"austin", "Austin", "US"), (r"boston", "Boston", "US"),
    (r"chicago", "Chicago", "US"), (r"los\s+angeles", "Los Angeles", "US"), (r"toronto", "Toronto", "CA"),
    (r"vancouver", "Vancouver", "CA"), (r"montreal", "Montreal", "CA"), (r"sydney", "Sydney", "AU"),
    (r"melbourne", "Melbourne", "AU"), (r"singapore", "Singapore", "SG"), (r"dubai|दुबई", "Dubai", "AE"),
    (r"abu\s+dhabi", "Abu Dhabi", "AE"), (r"riyadh", "Riyadh", "SA"), (r"doha", "Doha", "QA"),
    (r"tokyo", "Tokyo", "JP"), (r"hong\s+kong", "Hong Kong", "HK"), (r"kuala\s+lumpur", "Kuala Lumpur", "MY"),
    (r"jakarta", "Jakarta", "ID"), (r"manila", "Manila", "PH"), (r"bangkok", "Bangkok", "TH"),
    (r"nairobi", "Nairobi", "KE"), (r"lagos", "Lagos", "NG"), (r"cairo", "Cairo", "EG"),
    (r"karachi", "Karachi", "PK"), (r"lahore", "Lahore", "PK"), (r"dhaka", "Dhaka", "BD"),
    (r"colombo", "Colombo", "LK"), (r"kathmandu", "Kathmandu", "NP"),
)
_B = r"(?<![\wऀ-ॿ])"  # a word boundary that also works next to Devanagari
_E = r"(?![\wऀ-ॿ])"
CITIES = tuple((re.compile(_B + p + _E, re.IGNORECASE), c, cc) for p, c, cc in _CITIES)
_COUNTRIES = tuple((re.compile(_B + p + _E, re.IGNORECASE), ccs) for p, ccs in _COUNTRY_WORDS)

_SKILLS: tuple[tuple[str, str], ...] = (
    (r"react\s+native", "React Native"), (r"react(?:\.?js)?", "React"), (r"angular(?:js)?", "Angular"),
    (r"vue(?:\.?js)?", "Vue.js"), (r"next\.?js", "Next.js"), (r"node(?:\.?js)?", "Node.js"),
    (r"typescript|ts(?=\s*/)", "TypeScript"), (r"javascript|js(?=\s*/)", "JavaScript"), (r"python", "Python"),
    (r"django", "Django"), (r"fastapi", "FastAPI"), (r"flask", "Flask"), (r"spring\s*boot", "Spring Boot"),
    (r"java(?!\s*script)", "Java"), (r"kotlin", "Kotlin"), (r"swift", "Swift"), (r"golang", "Go"),
    (r"rust", "Rust"), (r"c\+\+", "C++"), (r"c#", "C#"), (r"\.net|dotnet", ".NET"), (r"php", "PHP"),
    (r"laravel", "Laravel"), (r"ruby\s+on\s+rails|rails", "Ruby on Rails"), (r"ruby", "Ruby"), (r"scala", "Scala"),
    (r"postgres(?:ql)?", "PostgreSQL"), (r"mysql", "MySQL"), (r"mongo(?:db)?", "MongoDB"), (r"redis", "Redis"),
    (r"kafka", "Kafka"), (r"sql", "SQL"), (r"aws", "AWS"), (r"azure", "Azure"), (r"gcp|google\s+cloud", "GCP"),
    (r"docker", "Docker"), (r"kubernetes|k8s", "Kubernetes"), (r"terraform", "Terraform"), (r"linux", "Linux"),
    (r"graphql", "GraphQL"), (r"rest(?:ful)?\s+apis?", "REST APIs"), (r"html5?", "HTML"), (r"css3?", "CSS"),
    (r"tailwind", "Tailwind CSS"), (r"figma", "Figma"), (r"excel|ms\s+excel", "Excel"), (r"power\s*bi", "Power BI"),
    (r"tableau", "Tableau"), (r"salesforce", "Salesforce"), (r"sap", "SAP"), (r"tally", "Tally"), (r"gst", "GST"),
    (r"photoshop", "Photoshop"), (r"seo", "SEO"), (r"flutter", "Flutter"), (r"android", "Android"),
    (r"ios", "iOS"), (r"machine\s+learning|ml(?=\s+engineer)", "Machine learning"), (r"pytorch", "PyTorch"),
    (r"tensorflow", "TensorFlow"), (r"selenium", "Selenium"), (r"jira", "Jira"), (r"crm", "CRM"),
    (r"b2b\s+sales", "B2B sales"), (r"cold\s+calling", "Cold calling"), (r"accounting", "Accounting"),
)
SKILLS = tuple((re.compile(r"(?<![\w.#+])" + p + r"(?![\w#+])", re.IGNORECASE), name) for p, name in _SKILLS)
_GO = re.compile(r"(?<![\w.])Go(?![\w])")  # the language: capitalised, never the verb "go"

_LANGUAGES = ("English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam", "Marathi", "Bengali", "Gujarati",
              "Punjabi", "Urdu", "Odia", "Assamese", "Arabic", "French", "German", "Spanish", "Japanese",
              "Mandarin", "Portuguese", "Italian", "Dutch")
_HINDI_LANG = {"हिंदी": "Hindi", "हिन्दी": "Hindi", "अंग्रेजी": "English", "अंग्रेज़ी": "English"}
_LANG_CUE = re.compile(r"speak|speaking|spoken|fluen|proficien|language|communication|written|verbal|bilingual|"
                       r"read\s+and\s+write|requirement|required|must|बोल", re.IGNORECASE)

DEVANAGARI = re.compile(r"[ऀ-ॿ]")
LATIN = re.compile(r"[A-Za-z]")

# ---- pay -------------------------------------------------------------------------------------------------------

_CUR = (r"₹|rs\.?|inr|rupees?|रु\.?|रुपये|\$|usd|us\$|dollars?|€|eur|euros?|£|gbp|pounds?|aed|dhs?|sgd|s\$|aud|a\$|"
        r"cad|c\$")
_UNIT = r"k|lpa|l\.p\.a\.?|lakhs?|lacs?|lakh|l(?![a-z])|cr|crores?|thousand|हज़ार|हजार|लाख|करोड़"
_NUMBER = r"\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_MONEY = re.compile(
    rf"(?P<c1>{_CUR})?\s*(?P<a>{_NUMBER})\s*(?P<ua>{_UNIT})?(?![\w%])"
    rf"(?:\s*(?:-|–|—|to|se|से|and)\s*(?P<c2>{_CUR})?\s*(?P<b>{_NUMBER})\s*(?P<ub>{_UNIT})?(?![\w%]))?"
    rf"(?:\s*(?P<c3>inr|usd|eur|gbp|aed|sgd|aud|cad|rupees|dollars|रुपये)(?![\w]))?",
    re.IGNORECASE)
_PAY_WORD = re.compile(r"salary|ctc|pay|stipend|compensation|package|remuneration|budget|wage|वेतन|सैलरी|तनख्वाह|"
                       r"स्टाइपेंड|पैकेज", re.IGNORECASE)
_NOT_PAY_AFTER = re.compile(r"^\s*\+?\s*(?:years?|yrs?|yoe|months?|days?|weeks?|hours?\s+(?:a|per)\s+week|%|"
                            r"people|employees|members|users|customers|candidates|openings|positions|roles|"
                            r"साल|वर्ष|महीने|दिन|lpa\s+experience)", re.IGNORECASE)
_PERIOD_MONTH = re.compile(r"^[\s,]*(?:/\s*m(?:o|onth)?\b|p\.?m\.?\b|per\s+month|a\s+month|monthly|/\s*month|"
                           r"प्रति\s*माह|प्रति\s*महीना|महीना|मासिक)", re.IGNORECASE)
_PERIOD_HOUR = re.compile(r"^[\s,]*(?:/\s*h(?:ou)?r\b|per\s+hour|an\s+hour|hourly|ph\b|प्रति\s*घंटा)", re.IGNORECASE)
_PERIOD_YEAR = re.compile(r"^[\s,]*(?:/\s*y(?:ea)?r\b|per\s+(?:annum|year)|a\s+year|annual(?:ly)?|p\.?a\.?\b|ctc\b|"
                          r"प्रति\s*वर्ष|सालाना)", re.IGNORECASE)
_PERIOD_DAY = re.compile(r"^[\s,]*(?:/\s*day|per\s+day|a\s+day|daily|प्रति\s*दिन)", re.IGNORECASE)
_MONTH_WORD_NEAR = re.compile(r"per\s+month|monthly|/\s*month|a\s+month|stipend|प्रति\s*माह|महीना", re.IGNORECASE)
_HIDE_PAY = re.compile(r"(?:don'?t|do\s+not|never)\s+(?:show|display|publish)\s+(?:the\s+)?(?:salary|pay|ctc)|"
                       r"(?:hide|confidential)\s+(?:the\s+)?(?:salary|pay|ctc)|(?:salary|pay|ctc)\s+(?:hidden|"
                       r"confidential|not\s+disclosed)", re.IGNORECASE)
_UPTO = re.compile(r"(?:up\s*to|upto|max(?:imum)?|till|not\s+more\s+than|तक)\s*$", re.IGNORECASE)
_FROM = re.compile(r"(?:from|starting(?:\s+at)?|min(?:imum)?|at\s+least|\bfrom\s+)\s*$", re.IGNORECASE)


def _currency(token: str | None) -> str | None:
    if not token:
        return None
    t = token.lower().rstrip(".")
    if t in {"₹", "rs", "inr", "rupee", "rupees", "रु", "रुपये"}:
        return "INR"
    if t in {"$", "usd", "us$", "dollar", "dollars"}:
        return "USD"
    if t in {"€", "eur", "euro", "euros"}:
        return "EUR"
    if t in {"£", "gbp", "pound", "pounds"}:
        return "GBP"
    if t in {"aed", "dh", "dhs"}:
        return "AED"
    return {"sgd": "SGD", "s$": "SGD", "aud": "AUD", "a$": "AUD", "cad": "CAD", "c$": "CAD"}.get(t)


def _unit(token: str | None) -> tuple[float, bool]:
    """(multiplier, Indian unit)."""
    if not token:
        return 1.0, False
    t = token.lower().replace(".", "")
    if t in {"k", "thousand", "हज़ार", "हजार"}:
        return 1_000.0, False
    if t in {"cr", "crore", "crores", "करोड़"}:
        return 10_000_000.0, True
    return 100_000.0, True  # lpa, lakh(s), lac(s), l, लाख


def _num(text: str) -> float:
    return float(text.replace(",", ""))


@dataclass
class Pay:
    min: int | None
    max: int | None
    currency: str
    period: str  # year | month | hour
    said: str  # the words it came from
    assumptions: list[str] = field(default_factory=list)


def fmt_money(amount: int, currency: str) -> str:
    sym = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}.get(currency, f"{currency} ")
    if currency == "INR":  # Indian grouping: 18,00,000
        s = str(amount)
        head, tail = s[:-3], s[-3:]
        if head:
            head = re.sub(r"(\d)(?=(\d{2})+$)", r"\1,", head)
            return f"{sym}{head},{tail}"
        return f"{sym}{tail}"
    return f"{sym}{amount:,}"


def parse_pay(text: str, default_currency: str = "INR") -> Pay | None:
    """The first pay range or figure in `text`, normalised (see the module docstring); None when there isn't one."""
    for m in _MONEY.finditer(text):
        a, b = m.group("a"), m.group("b")
        ua, ub = m.group("ua"), m.group("ub")
        cur_token = m.group("c1") or m.group("c2") or m.group("c3")
        after = text[m.end():m.end() + 40]
        before = text[max(0, m.start() - 40):m.start()]
        if _NOT_PAY_AFTER.match(after) or re.search(r"\d\s*$", before):
            continue
        if re.match(r"^\s*\+", after) and not (ua or ub or cur_token):
            continue  # "5+" is years, not pay
        unit_token = ua or ub
        currency = _currency(cur_token)
        mult, indian = _unit(unit_token)
        if _PERIOD_DAY.match(after):
            continue  # a day rate: the form has no "per day"
        pay_word = bool(_PAY_WORD.search(before[-25:]) or _PAY_WORD.search(after[:20]) or _PERIOD_MONTH.match(after)
                        or _PERIOD_HOUR.match(after) or (_PERIOD_YEAR.match(after) and not re.match(r"^\s*ctc", after,
                                                                                                     re.I)))
        if not (currency or unit_token or pay_word):
            continue
        if unit_token and unit_token.lower() == "l" and not (currency or pay_word or b):
            continue
        lo = _num(a) * (_unit(ua)[0] if ua else mult)
        hi = _num(b) * (_unit(ub)[0] if ub else mult) if b else None
        if b and ua and not ub:  # "18 lakh to 28" is rare; "18L-28L" handled by both units
            hi = _num(b) * _unit(ua)[0]
        if lo <= 0 and not hi:
            continue
        assumptions: list[str] = []
        if indian and not currency:
            currency = "INR"
        if not currency:
            currency = default_currency if default_currency in CURRENCIES else "INR"
            assumptions.append(f"Assumed {currency} for the pay because no currency was given.")
        if currency not in CURRENCIES:
            continue
        rest = after
        if _PERIOD_HOUR.match(rest):
            period = "hour"
        elif _PERIOD_MONTH.match(rest):
            period = "month"
        elif _PERIOD_YEAR.match(rest) or (unit_token and unit_token.lower().startswith(("lpa", "l.p.a"))):
            period = "year"
        elif _MONTH_WORD_NEAR.search(before[-30:] + after[:30]):
            period = "month"
        elif indian and unit_token and unit_token.lower() not in {"k"}:
            period = "year"
            if not re.search(r"lpa|ctc|annum|year|सालाना", text, re.IGNORECASE):
                assumptions.append("Assumed the lakh figures are a year's pay (CTC).")
        else:
            top = hi or lo
            if currency == "INR" and top < 200_000:
                period = "month"
                assumptions.append("Assumed the pay is per month: a figure that size reads as a monthly salary.")
            elif currency != "INR" and top < 1_000:
                period = "hour"
                assumptions.append("Assumed the pay is per hour: a figure that size reads as an hourly rate.")
            else:
                period = "year"
        lo_i, hi_i = round(lo), round(hi) if hi is not None else None
        if hi_i is not None and hi_i < lo_i:
            lo_i, hi_i = hi_i, lo_i
        if hi_i is None:
            if _UPTO.search(before):
                return Pay(None, lo_i, currency, period, m.group(0).strip(), assumptions)
            if _FROM.search(before):
                return Pay(lo_i, None, currency, period, m.group(0).strip(), assumptions)
            hi_i = lo_i
        return Pay(lo_i, hi_i, currency, period, m.group(0).strip(), assumptions)
    return None


def pay_numbers_grounded(min_v: int | None, max_v: int | None, text: str) -> bool:
    """Each figure of a model's salary is one the recruiter's words give (as written, or times a thousand, a lakh or
    a crore): the check that the model didn't invent pay."""
    said = [_num(x) for x in re.findall(_NUMBER, text)]
    if not said:
        return False
    for v in (min_v, max_v):
        if v is None:
            continue
        if not any(abs(s * k - v) < 0.5 for s in said for k in (1, 1_000, 100_000, 10_000_000)):
            return False
    return min_v is not None or max_v is not None


# ---- experience, place, type -------------------------------------------------------------------------------------

_YEARS = re.compile(r"(?P<a>\d{1,2})(?:\.\d)?\s*(?:\+|plus)?\s*(?:(?:-|–|to|से)\s*(?P<b>\d{1,2})\s*)?\+?\s*"
                    r"(?:years?|yrs?|yoe|साल|वर्ष)", re.IGNORECASE)
_FRESHER = re.compile(r"fresher|freshers|fresh\s+graduates?|no\s+experience(?:\s+needed|\s+required)?|"
                      r"0\s*(?:-\s*1\s*)?(?:years?|yrs?)|entry[- ]level|graduate\s+trainee|फ्रेशर|अनुभव\s+की\s+जरूरत\s+नहीं",
                      re.IGNORECASE)
_LEVEL_WORDS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b(?:intern|internship|trainee)\b", re.IGNORECASE), "entry"),
    (re.compile(r"\b(?:junior|jr\.?|associate)\b", re.IGNORECASE), "junior"),
    (re.compile(r"\b(?:mid[- ]?level|mid[- ]senior|intermediate)\b", re.IGNORECASE), "mid"),
    (re.compile(r"\b(?:senior|sr\.?)\b", re.IGNORECASE), "senior"),
    (re.compile(r"\b(?:lead|principal|staff|head\s+of|director|vp)\b", re.IGNORECASE), "lead"),
)
_REMOTE = re.compile(r"\b(?:remote|wfh|work\s+from\s+home|fully\s+remote|remote[- ]first|anywhere|distributed)\b|"
                     r"रिमोट|घर\s+से\s+काम", re.IGNORECASE)
_HYBRID = re.compile(r"\bhybrid\b|हाइब्रिड", re.IGNORECASE)
_ONSITE = re.compile(r"\b(?:on[- ]?site|in[- ]office|office[- ]based|wfo|work\s+from\s+office|in\s+person)\b|"
                     r"ऑफिस\s+से", re.IGNORECASE)
_ANYWHERE = re.compile(r"\b(?:anywhere|worldwide|global(?:ly)?)\b", re.IGNORECASE)
_EMPLOYMENT: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b(?:internship|intern|interns)\b|इंटर्न", re.IGNORECASE), "internship"),
    (re.compile(r"\bpart[- ]?time\b|पार्ट\s*टाइम", re.IGNORECASE), "part_time"),
    (re.compile(r"\b(?:contract(?:or|ual)?|freelance(?:r)?|c2h|consultant\s+basis)\b", re.IGNORECASE), "contract"),
    (re.compile(r"\b(?:temporary|temp|seasonal|fixed[- ]term)\b", re.IGNORECASE), "temporary"),
    (re.compile(r"\b(?:full[- ]?time|permanent)\b|फुल\s*टाइम", re.IGNORECASE), "full_time"),
)
_NOTICE = re.compile(r"notice\s+period|immediate\s+joiners?|join\s+immediately|immediate\s+joining|"
                     r"नोटिस", re.IGNORECASE)
_IMMEDIATE = re.compile(r"immediate\s+joiners?|join\s+immediately|immediate\s+joining|तुरंत", re.IGNORECASE)
_PROCESS = re.compile(r"\b(?:assignment|take[- ]home|coding\s+test|test\s+round|technical\s+round|hr\s+round|"
                      r"interview\s+rounds?|rounds?\s+of\s+interviews?|\d\s+rounds?|panel\s+interview|"
                      r"hiring\s+process|case\s+study|trial\s+day)\b", re.IGNORECASE)
_NICE_CUE = re.compile(r"(?:nice\s+to\s+have|good\s+to\s+have|bonus|a\s+plus|is\s+a\s+plus|preferred|"
                       r"would\s+be\s+great)", re.IGNORECASE)

_DEPARTMENTS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"product\s+manager|product\s+owner|\bpm\b", re.IGNORECASE), "Product"),
    (re.compile(r"design(?:er)?|ux|ui\b", re.IGNORECASE), "Design"),
    (re.compile(r"engineer|developer|devops|sre\b|programmer|architect|qa\b|tester|data\s+scien|ml\b|"
                r"full[- ]?stack|backend|frontend|front[- ]end|back[- ]end", re.IGNORECASE), "Engineering"),
    (re.compile(r"data\s+analyst|analytics|business\s+analyst", re.IGNORECASE), "Data"),
    (re.compile(r"sales|business\s+development|bde\b|bdm\b|account\s+executive|सेल्स", re.IGNORECASE), "Sales"),
    (re.compile(r"marketing|seo|content|social\s+media|growth", re.IGNORECASE), "Marketing"),
    (re.compile(r"customer\s+(?:support|success|service)|support\s+(?:executive|engineer)|call\s+cent|"
                r"telecaller", re.IGNORECASE), "Customer Support"),
    (re.compile(r"\bhr\b|human\s+resources|recruit|talent", re.IGNORECASE), "People"),
    (re.compile(r"account(?:ant|ing|s)|finance|ca\b|tax|audit", re.IGNORECASE), "Finance"),
    (re.compile(r"operations|logistics|supply\s+chain|warehouse|delivery", re.IGNORECASE), "Operations"),
)

_TITLE_NOISE = re.compile(
    r"^(?:we(?:'re|\s+are)?\s+(?:hiring|looking\s+for|need)|looking\s+for|hiring(?:\s+for)?|need(?:ed)?|"
    r"wanted|urgent(?:ly)?(?:\s+hiring)?|opening\s+for|vacancy\s+for)\s+(?:an?\s+)?|^an?\s+|"
    r"\s+(?:needed|wanted|required|urgently|opening|vacancy|position|role|job)$|\s+(?:in|at|for|from|based)$|"
    r"चाहिए|की\s+(?:जरूरत|ज़रूरत|आवश्यकता)\s+है|आवश्यकता|^(?:में|के\s+लिए|हमें)\s+|\s+(?:में|के\s+लिए)$",
    re.IGNORECASE)
# The word that names the job; what comes after it in a run-on prompt ("Data analyst SQL Excel") isn't the title.
_ROLE_NOUN = re.compile(
    r"\b(?:developer|engineer|analyst|executive|manager|designer|accountant|writer|intern|associate|specialist|"
    r"consultant|architect|administrator|admin|officer|scientist|representative|coordinator|assistant|tester|"
    r"marketer|recruiter|agent|operator|technician|teacher|tutor|nurse|driver|editor|head|director|programmer|"
    r"trainee|clerk|lead|strategist|planner|copywriter|chef|cook|receptionist|telecaller|advisor|partner|"
    r"owner|researcher|counsellor|counselor|pharmacist|doctor|lawyer|electrician|mechanic|supervisor)s?\b",
    re.IGNORECASE)
_SMALL = {"of", "and", "for", "the", "to", "in", "at", "a", "an", "&"}


@dataclass
class Facts:
    """What the recruiter's words state. `None` means they didn't say (a default is an assumption, said so)."""

    title: str = ""
    locations: list[str] = field(default_factory=list)
    workplace: str | None = None
    allowed_countries: list[str] | None = None
    employment_type: str | None = None
    experience: str | None = None
    years_min: int | None = None
    fresher: bool = False
    pay: Pay | None = None
    hide_pay: bool = False
    skills: list[str] = field(default_factory=list)
    nice_skills: list[str] = field(default_factory=list)
    languages: list[str] = field(default_factory=list)
    department: str = ""
    notice: bool = False
    immediate: bool = False
    process: bool = False
    hindi: bool = False
    assumptions: list[str] = field(default_factory=list)


def band_for_years(years: float) -> str:
    if years < 1:
        return "entry"
    if years < 3:
        return "junior"
    if years < 5:
        return "mid"
    if years < 8:
        return "senior"
    return "lead"


def find_cities(text: str) -> list[tuple[int, str, str]]:
    """(position, city, country) for each known city named in `text`, first mention first, no repeats; an alias
    inside a longer match ("Delhi" in "New Delhi", "Mumbai" in "Navi Mumbai") counts once."""
    hits: list[tuple[int, int, str, str]] = []
    for rx, city, cc in CITIES:
        for m in rx.finditer(text):
            if any(s <= m.start() < e for s, e, _, _ in hits):
                continue
            hits.append((m.start(), m.end(), city, cc))
    seen: set[str] = set()
    out = []
    for start, _, city, cc in sorted(hits):
        if city not in seen:
            seen.add(city)
            out.append((start, city, cc))
    return out


def normalise_location(text: str) -> str:
    """"Bangalore, India" -> "Bengaluru, IN"; an unknown place is kept as written, tidied."""
    t = re.sub(r"\s+", " ", text).strip(" ,;/")
    if not t:
        return ""
    cities = find_cities(t)
    if cities:
        _, city, cc = cities[0]
        return f"{city}, {cc}"
    parts = [p.strip() for p in t.split(",") if p.strip()]
    if len(parts) > 1:
        tail = parts[-1]
        for rx, ccs in _COUNTRIES:
            if len(ccs) == 1 and rx.fullmatch(tail):
                parts[-1] = ccs[0]
                break
    return ", ".join(parts)[:120]


def _title_case(text: str) -> str:
    words = text.split()
    out = []
    for i, w in enumerate(words):
        if w.islower() and DEVANAGARI.search(w) is None:
            out.append(w if (i and w in _SMALL) else w[:1].upper() + w[1:])
        else:
            out.append(w)
    return " ".join(out)


def _title_from(text: str) -> str:
    first = re.split(r"[,;\n|()]|\s[-–—]\s|\.\s", text.strip(), maxsplit=1)[0]
    t = first
    for rx, _, _ in CITIES:
        t = rx.sub(" ", t)
    for rx in (_REMOTE, _HYBRID, _ONSITE, _YEARS, _FRESHER):
        t = rx.sub(" ", t)
    t = re.sub(r"\b(?:full[- ]?time|part[- ]?time|contract(?:ual)?|freelance|temporary)\b", " ", t,
               flags=re.IGNORECASE)
    t = _MONEY.sub(lambda m: " " if (m.group("c1") or m.group("ua") or m.group("ub")) else m.group(0), t)
    t = re.sub(r"\s+", " ", t).strip(" -–—:.,/")
    for _ in range(3):
        t = _TITLE_NOISE.sub("", t).strip(" -–—:.,/")
    t = re.sub(r"\s+", " ", t).strip()
    nouns = list(_ROLE_NOUN.finditer(t))
    if nouns and nouns[-1].end() < len(t):
        t = t[:nouns[-1].end()].strip()
    if len(t) < 2 or len(t) > 80 or len(t.split()) > 8:
        return ""
    return _title_case(t)[:160]


def _skills(text: str) -> list[str]:
    out = [name for rx, name in SKILLS if rx.search(text)]
    if _GO.search(text) and "Go" not in out:
        out.append("Go")
    # "React" inside "React Native" only once; "Java" isn't JavaScript; "Ruby" inside "Ruby on Rails".
    if "React Native" in out and not re.search(r"react(?!\s+native)", text, re.IGNORECASE):
        out.remove("React")
    if "Ruby on Rails" in out and "Ruby" in out:
        out.remove("Ruby")
    if "PostgreSQL" in out and "SQL" in out and not re.search(r"(?<![\w])sql(?![\w])", text, re.IGNORECASE):
        out.remove("SQL")
    # In the order they're written.
    def pos(name: str) -> int:
        for rx, n in SKILLS:
            if n == name and (m := rx.search(text)):
                return m.start()
        m = _GO.search(text)
        return m.start() if m and name == "Go" else 10**6
    return sorted(dict.fromkeys(out), key=pos)[:10]


def _languages(text: str) -> list[str]:
    found: list[tuple[int, str]] = []
    for lang in _LANGUAGES:
        for m in re.finditer(rf"\b{lang}\b", text, re.IGNORECASE):
            around = text[max(0, m.start() - 40):m.end() + 40]
            # The title of a Hindi prompt isn't a language requirement; a cue word nearby is.
            if _LANG_CUE.search(around) or re.search(rf"{lang}[- ]speaking", around, re.IGNORECASE):
                found.append((m.start(), lang))
                break
    for word, lang in _HINDI_LANG.items():
        if (i := text.find(word)) >= 0 and _LANG_CUE.search(text[max(0, i - 30):i + 40]):
            found.append((i, lang))
    return list(dict.fromkeys(lang for _, lang in sorted(found)))


def _skill_spans(text: str) -> list[tuple[int, int, str]]:
    spans = [(m.start(), m.end(), name) for rx, name in SKILLS for m in rx.finditer(text)]
    spans += [(m.start(), m.end(), "Go") for m in _GO.finditer(text)]
    return sorted(spans)


def _nice_segment_skills(text: str) -> list[str]:
    """Skills marked as a plus: those just before "a plus" / "preferred" (a chain joined by "or", "and", "/"), or
    after "nice to have:"."""
    nice: list[str] = []
    for seg in re.split(r"[;\n]|\.\s", text):
        if re.search(r"(?:male|female|men|women)", seg, re.IGNORECASE):
            continue
        for cue in _NICE_CUE.finditer(seg):
            if re.match(r"nice|good|bonus", cue.group(0), re.IGNORECASE) and \
                    re.match(r"^\s*(?:to\s+have)?\s*[:-]", seg[cue.end():]):
                nice += [n for _, _, n in _skill_spans(seg[cue.end():])]
                continue
            edge = cue.start()
            for start, end, name in reversed(_skill_spans(seg[:cue.start()])):
                if end > edge:
                    continue
                gap = seg[end:edge]
                first = edge == cue.start()
                if (first and re.fullmatch(r"\s*(?:is|are)?\s*", gap)) or \
                        (not first and re.fullmatch(r"\s*(?:,|/|or|and|&)\s*", gap)):
                    nice.append(name)
                    edge = start
                else:
                    break
    return list(dict.fromkeys(nice))


def read_facts(text: str, *, title: str = "", location: str = "", salary: str = "", experience: str = "",
               default_currency: str = "INR") -> Facts:
    """The facts in the recruiter's words (`text`) and quick fields. Pure and deterministic."""
    f = Facts()
    corpus = "\n".join(x for x in (title, location, salary, experience, text) if x)
    f.hindi = len(DEVANAGARI.findall(text)) > len(LATIN.findall(text))
    f.title = _title_case(title.strip())[:160] if title.strip() else _title_from(text)

    # Place: the quick field first (each part a place), then cities named in the text.
    places: list[str] = []
    for part in re.split(r"[;/|]|\bor\b|,(?=\s*[A-Zऀ-ॿ][a-zऀ-ॿ]+\s*(?:,|$))", location):
        if part.strip() and not (_REMOTE.fullmatch(part.strip()) or _HYBRID.fullmatch(part.strip())):
            loc = normalise_location(part)
            if loc and not _REMOTE.search(loc) and not _HYBRID.search(loc):
                places.append(loc)
    places += [f"{city}, {cc}" for _, city, cc in find_cities(text)]
    f.locations = list(dict.fromkeys(places))[:5]

    if _HYBRID.search(corpus):
        f.workplace = "hybrid"
    elif _REMOTE.search(corpus):
        f.workplace = "remote"
    elif _ONSITE.search(corpus):
        f.workplace = "onsite"
    if f.workplace == "remote":
        countries: list[str] = []
        region_hit = False
        for rx, ccs in _COUNTRIES:
            if rx.search(corpus):
                countries += ccs
                region_hit = region_hit or len(ccs) > 1
        if not countries and f.locations and not _ANYWHERE.search(corpus):
            countries = [loc.rsplit(", ", 1)[-1] for loc in f.locations if re.search(r", [A-Z]{2}$", loc)]
        f.allowed_countries = [] if _ANYWHERE.search(corpus) and not countries else list(dict.fromkeys(countries))
        if region_hit:
            f.assumptions.append("Opened the remote job to European countries because you said Europe; edit the "
                                 "list if it's narrower.")

    for rx, kind in _EMPLOYMENT:
        if rx.search(corpus):
            f.employment_type = kind
            break

    exp_text = "\n".join(x for x in (experience, text) if x)
    if (m := _YEARS.search(exp_text)) is not None:
        f.years_min = int(m.group("a"))
    if _FRESHER.search(exp_text):
        f.fresher = True
        f.years_min = 0 if f.years_min is None or f.years_min == 0 else f.years_min
    level = next((band for rx, band in _LEVEL_WORDS if rx.search(f"{title} {experience} {f.title}")), None)
    if f.employment_type == "internship" or f.fresher:
        f.experience = "entry"
    elif level:
        f.experience = level
    elif f.years_min is not None:
        f.experience = band_for_years(f.years_min)

    f.pay = parse_pay(salary, default_currency) if salary.strip() else None
    if f.pay is None:
        f.pay = parse_pay(text, default_currency)
    f.hide_pay = bool(_HIDE_PAY.search(corpus))

    f.nice_skills = _nice_segment_skills(corpus)
    f.skills = [s for s in _skills(corpus) if s not in f.nice_skills]
    f.languages = _languages(corpus)
    f.department = next((d for rx, d in _DEPARTMENTS if rx.search(f.title or corpus)), "")
    f.notice = bool(_NOTICE.search(corpus))
    f.immediate = bool(_IMMEDIATE.search(corpus))
    f.process = bool(_PROCESS.search(corpus))
    return f
