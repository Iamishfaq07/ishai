"""Fairness checks shared by the job description writer and the ranking.

- `inclusive()`: gendered, age-coded and exclusionary wording replaced with neutral wording ("rockstar" ->
  "skilled", "manpower" -> "workforce", "digital native" -> "comfortable with digital tools", "he/she" -> "they"),
  each change reported so the recruiter sees what was changed and why.
- `discriminatory()`: a requirement or a line that screens on a protected characteristic (gender, age, marital
  status, religion, caste, appearance, nationality beyond work authorisation, disability, pregnancy). These are
  removed from drafts and never scored.
- `asks_protected()`: a screening question that asks about one of them (or about salary history, which several US
  states ban asking).
- `no_reject()`: AI text that recommends rejecting or not advancing someone is replaced; decisions are a human's.
"""

import re

# (pattern, replacement, note). Replacement "" removes the word. English, then Hindi.
_LEXICON: tuple[tuple[str, str, str], ...] = (
    (r"rock\s?stars?", "skilled professional", "'rockstar' is informal and male-coded"),
    (r"ninjas?|jedis?|wizards?|gurus?", "expert", "'ninja'/'guru'-style titles are male-coded"),
    (r"superstars?|hotshots?", "high performer", "'superstar' is informal and exclusionary"),
    (r"digital natives?", "comfortable with digital tools", "'digital native' is age-coded"),
    (r"(?<!&\s)(?<!and\s)young(?:\s+and)?(?=\s+(?:dynamic|energetic|enthusiastic|team|people|professionals?|"
     r"talent|minds?))", "", "'young' is age-coded"),
    (r"youthful", "", "'youthful' is age-coded"),
    (r"(?<!&\s)(?<!and\s)young", "", "'young' is age-coded"),  # not "Ernst & Young"
    (r"fresh\s+blood", "new perspectives", "'fresh blood' is age-coded"),
    (r"recent\s+graduates?", "early-career candidates", "'recent graduate' is age-coded"),
    (r"energetic", "motivated", "'energetic' is often read as age-coded"),
    (r"(?:wo)?manpower", "workforce", "'manpower' is gendered"),
    (r"man[- ]hours?", "person-hours", "'man-hours' is gendered"),
    (r"manning", "staffing", "'manning' is gendered"),
    (r"chair(?:wo)?man", "chair", "gendered job title"),
    (r"sales(?:wo)?man|salesmen", "salesperson", "gendered job title"),
    (r"business(?:wo)?man|businessmen", "businessperson", "gendered job title"),
    (r"fore(?:wo)?man", "supervisor", "gendered job title"),
    (r"camera(?:wo)?man", "camera operator", "gendered job title"),
    (r"crafts(?:wo)?man", "craftsperson", "gendered job title"),
    (r"waitress", "server", "gendered job title"),
    (r"(?:man|girl)\s+friday", "assistant", "gendered job title"),
    (r"he\s*/\s*she|she\s*/\s*he|s/he|he\s+or\s+she|she\s+or\s+he", "they", "gendered pronouns"),
    (r"his\s*/\s*her|her\s*/\s*his|his\s+or\s+her|her\s+or\s+his", "their", "gendered pronouns"),
    (r"him\s*/\s*her|him\s+or\s+her|her\s+or\s+him", "them", "gendered pronouns"),
    (r"guys", "everyone", "'guys' is gendered"),
    (r"native\s+(english\s+)?speakers?(\s+of\s+english)?", "fluent English speaker",
     "'native speaker' excludes by national origin; ask for fluency"),
    (r"aggressive(?:ly)?", "ambitious", "'aggressive' is male-coded"),
    (r"able[- ]bodied", "", "'able-bodied' excludes people with disabilities"),
    (r"युवा", "", "'युवा' (young) is age-coded"),
    (r"मैनपावर", "कार्यबल", "'मैनपावर' is gendered"),
)
_LEX = tuple((re.compile(rf"(?<![\w-]){p}(?![\w-])", re.IGNORECASE), r, n) for p, r, n in _LEXICON)

# A requirement that screens on a protected characteristic.
_DISCRIMINATORY = re.compile(
    r"\b(?:male|female|men|women|boys?|girls?|ladies|gents)\s+(?:candidates?\s+)?(?:only|preferred|required)\b|"
    r"\b(?:only|prefer(?:ably)?|preferred)\s+(?:male|female|men|women|boys?|girls?|ladies|gents)\b|"
    r"\bage\s*(?:limit|bar|criteria|:|between|below|under|above|over|up\s*to|not\s+(?:more|less))|"
    r"\b(?:below|under|above|over|less\s+than|not\s+(?:more|older)\s+than)\s+(?:the\s+age\s+of\s+)?\d{2}\s*"
    r"(?:years?|yrs?)?\s*(?:of\s+age|old)\b|\b\d{2}\s*(?:-|–|to)\s*\d{2}\s*(?:years?|yrs?)\s*(?:of\s+age|old)\b|"
    r"\bborn\s+(?:after|before|between)\b|\b(?:un)?married\b|\bsingle\s+(?:candidates?|only|preferred)\b|"
    r"\bno\s+(?:kids|children|family)\b|\b(?:hindu|muslim|christian|sikh|jain|buddhist|parsi|jewish)s?\b|"
    r"\bcaste\b|\breligio(?:n|us)\b|\b(?:good|pleasant)[- ]looking\b|\battractive\b|\bfair\s+(?:skin|complexion)\b|"
    r"\b(?:height|weight)\s*(?::|of|above|below|minimum|min)|\bphoto(?:graph)?\s+(?:required|mandatory|must)\b|"
    r"\bwith\s+photo\b|\bpregnan\w*\b|\bnationality\b|\b(?:citizens?|nationals?)\s+only\b|\bmother\s+tongue\b|"
    r"\bnative\s+(?:of|to|state)\b|\b(?:no|without)\s+disabilit\w*|\bphysically\s+(?:fit|able)\s+(?:male|female)\b|"
    r"केवल\s+(?:पुरुष|महिला)|आयु\s*सीमा|अविवाहित|विवाहित|धर्म|जाति",
    re.IGNORECASE)

_PROTECTED_QUESTION = re.compile(
    r"\b(?:age|how old|date of birth|dob|born|gender|sex|married|marital|spouse|husband|wife|"
    r"(?:have|any|how many)\s+(?:children|kids)|pregnan\w*|religio\w*|caste|(?:caste|reservation|social)\s+category|"
    r"nationality|citizenship|race|ethnic\w*|disab\w*|health\s+(?:condition|issues?|problems?|status)|"
    r"medical\s+(?:condition|history|issues?)|photo\w*|height|weight|current\s+(?:salary|ctc|pay|compensation)|"
    r"salary\s+history|previous\s+salary|last\s+drawn|father|mother)\b|आयु|उम्र|धर्म|जाति|विवाह|लिंग|वेतन\s+इतिहास",
    re.IGNORECASE)
_WORK_AUTH_Q = re.compile(r"authori[sz]ed\s+to\s+work|right\s+to\s+work|work\s+permit|visa|sponsorship|eligible\s+"
                          r"to\s+work", re.IGNORECASE)

_REJECT = re.compile(
    r"\b(?:reject\w*|decline\s+(?:the\s+)?(?:candidate|applicant)|not\s+(?:a\s+)?(?:good\s+|strong\s+)?(?:fit|match)\b|"
    r"unsuitable|not\s+suitable|unqualified|not\s+qualified|do\s+not\s+(?:hire|proceed|advance|shortlist|move)|"
    r"don'?t\s+(?:hire|proceed|advance|shortlist|move)|should\s+not\s+(?:be\s+)?(?:hired|advanced|shortlisted|"
    r"considered|move)|disqualif\w*|screen(?:ed)?\s+(?:them\s+)?out|pass\s+on\s+(?:this|them|the)|"
    r"not\s+recommended|no[- ]hire|weed\s+out)\b", re.IGNORECASE)
_PROTECTED_WORDS = re.compile(
    r"\b(?:age|aged|old|young|older|younger|gender|male|female|man|woman|married|marital|religio\w*|caste|"
    r"nationality|citizen\w*|pregnan\w*|disab\w*|health|name|photo\w*|ethnic\w*|race|accent)\b", re.IGNORECASE)


def inclusive(text: str) -> tuple[str, list[str]]:
    """`text` with exclusionary wording replaced, and a note per kind of change ("'rockstar' -> 'skilled ...'")."""
    notes: list[str] = []
    for rx, repl, note in _LEX:
        def sub(m: re.Match[str], repl: str = repl, note: str = note) -> str:
            said = m.group(0).strip()
            entry = f"'{said}' → '{repl}': {note}" if repl else f"'{said}' removed: {note}"
            if entry not in notes:
                notes.append(entry)
            if repl and said[:1].isupper():
                return repl[:1].upper() + repl[1:]
            return repl
        text = rx.sub(sub, text)
    text = re.sub(r"[ \t]{2,}", " ", re.sub(r"[ \t]+([,.;:!?])", r"\1", text))
    text = re.sub(r"\b(an?)\s+(?=[,.;:])", "", text)
    text = re.sub(r"\b(an?|the)\s*,\s+", r"\1 ", text, flags=re.IGNORECASE)  # "a young, keen" -> "a keen"
    return text, notes


def discriminatory(text: str) -> bool:
    return bool(_DISCRIMINATORY.search(text))


def asks_protected(question: str) -> bool:
    if _WORK_AUTH_Q.search(question) and not re.search(r"\bnationality|citizenship\b", question, re.IGNORECASE):
        return False  # "Are you authorised to work in India?" is allowed; "What's your nationality?" isn't
    return bool(_PROTECTED_QUESTION.search(question))


def recommends_rejection(text: str) -> bool:
    return bool(_REJECT.search(text))


def mentions_protected(text: str) -> bool:
    return bool(_PROTECTED_WORDS.search(text))


def no_reject(text: str) -> str:
    """`text` without any sentence that recommends rejecting or not advancing (a human decides that)."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return " ".join(s for s in sentences if s and not recommends_rejection(s)).strip()


def discriminatory_terms(text: str) -> list[str]:
    """The words in `text` that make it discriminatory (see `discriminatory`)."""
    return [m.group(0) for m in _DISCRIMINATORY.finditer(text)]
