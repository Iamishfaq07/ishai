"""Protected attributes out before ranking (research note §5.2 item 7, §6.2; DECISIONS D83).

`redact_for_ranking()` turns a parsed resume and the screening answers into the only text the ranking sees: the
model's prompt, the deterministic matcher and the evidence check all read this and nothing else. What goes:

- identity: the name (every part of it, wherever it appears), email addresses, phone numbers, links (a profile URL
  carries the name), postal addresses and PIN/ZIP codes, the location line (location rules are checked by a human,
  never scored), honorifics (Mr, Ms, Mrs, Miss, Shri, Smt, Kumari);
- photo references ("photo attached", "[image]");
- gender: "Gender:"/"Sex:" lines, gendered words (male, female, woman, girl...), gendered titles ("chairman" ->
  "chair"), and pronouns, all mapped to one neutral form (he/she -> they; him/her/his/hers -> their) so two resumes
  that differ only in gender read the same;
- age: date of birth, "Age:", "27 years old", "born in 1994", and the year of every education entry (a graduation
  year is an age proxy; experience dates stay, they are what "3+ years" is measured with);
- marital and family status: "Marital status:", married/unmarried/spouse/husband/wife, father's/mother's name;
- religion and caste: "Religion:", "Caste:", "Category: OBC/SC/ST" and the words themselves;
- nationality and origin: "Nationality:", "citizen of", passport details, "mother tongue". Only when the job's
  location rules ask for work authorisation do explicit work-authorisation statements stay ("authorised to work in
  India", "no visa sponsorship needed"), and then only those lines;
- disability, health and pregnancy mentions.

The list is deliberately broad: a word that's dropped by mistake costs a requirement match a human can still see in
the resume; a protected attribute that reaches the ranking can't be taken back.
"""

import re
from dataclasses import dataclass, field

from orbit_api.business_ai.schemas import JobSpec, ParsedResume, ScreeningAnswer
from orbit_api.business_ai.text import clean

REDACTED_NAME = "the candidate"

# A whole line goes when it's one of these personal-details labels (Indian resumes often have a "Personal details"
# block with all of them).
_LABEL_LINE = re.compile(
    r"^\W*(?:d\.?\s?o\.?\s?b\.?|date\s+of\s+birth|birth\s*date|born|age|gender|sex|marital(?:\s+status)?|"
    r"religion|caste|sub[- ]?caste|category|community|nationality|citizenship|passport(?:\s+(?:no|number))?|"
    r"father'?s?\s+name|mother'?s?\s+name|husband'?s?\s+name|wife'?s?\s+name|spouse(?:'s)?\s+name|"
    r"guardian'?s?\s+name|s/o|d/o|w/o|parents?|mother\s+tongue|blood\s+group|height|weight|"
    r"(?:permanent|present|current|residential|postal|home)?\s*address|pin\s*code|zip\s*code|postcode|"
    r"photo(?:graph)?|picture|image|disability|health|differently\s+abled|pwd|"
    r"name|e-?mail|phone|mobile|contact(?:\s+(?:no|number))?|tel(?:ephone)?|whatsapp|linkedin|github|"
    r"location|current\s+location|based\s+in)\s*[:\-–=]",
    re.IGNORECASE)
_PHOTO = re.compile(r"\b(?:photo(?:graph)?s?|passport[- ]size|picture|headshot|selfie)\b|\[(?:image|photo|picture)]",
                    re.IGNORECASE)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL = re.compile(r"(?:https?://|www\.)\S+|\b(?:linkedin|github|behance|dribbble)\.com/\S*", re.IGNORECASE)
_PHONE_LIKE = re.compile(r"(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)")
_DOB = re.compile(r"\b(?:born\s+(?:on|in)?\s*[\w ,.'/-]{0,20}?(?:19|20)\d\d|"
                  r"\d{1,2}[\s-]*(?:years?|yrs?)[\s-]*(?:old|of\s+age)|aged?\s*[:\-]?\s*\d{1,2}\b)", re.IGNORECASE)
# Case-sensitive and before a capitalised word, so "MS Excel" and "miss a deadline" stay.
_HONORIFIC = re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Mx|Shri|Sri|Smt|Kumari|Sushri|MR|MRS|MISS)\b\.?\s+(?=[A-Z][a-z])")
_GENDER_WORDS = re.compile(
    r"\b(?:male|female|man|woman|men|women|boy|girl|boys|girls|gentleman|gentlemen|lady|ladies|transgender|"
    r"trans|non-binary|nonbinary|feminine|masculine|mother|father|mom|dad|son|daughter|brother|sister|"
    r"maternity|paternity|pregnan\w*)\b", re.IGNORECASE)
_PRONOUNS = (
    (re.compile(r"\b(?:he|she|s/he|he/she|she/he)\b", re.IGNORECASE), "they"),
    (re.compile(r"\b(?:himself|herself)\b", re.IGNORECASE), "themselves"),
    (re.compile(r"\b(?:him|her|his|hers)\b", re.IGNORECASE), "their"),
)
_GENDERED_TITLES = (
    (r"chair(?:wo)?man", "chair"), (r"sales(?:wo)?man", "salesperson"), (r"business(?:wo)?man", "businessperson"),
    (r"spokes(?:wo)?man", "spokesperson"), (r"fore(?:wo)?man", "supervisor"), (r"camera(?:wo)?man", "camera operator"),
    (r"waitress|waiter", "server"), (r"actress", "actor"), (r"stewardess|steward", "flight attendant"),
    (r"(?:wo)?manpower", "workforce"), (r"crafts(?:wo)?man", "craftsperson"), (r"post(?:wo)?man", "mail carrier"),
)
_MARITAL = re.compile(r"\b(?:married|unmarried|divorced|divorcee|widow(?:ed|er)?|spouse|husband|wife|fianc[ée]e?|"
                      r"bachelor\s+status|single\s+parent)\b", re.IGNORECASE)
_RELIGION_CASTE = re.compile(
    r"\b(?:hindu(?:ism)?|muslim|islam(?:ic)?|christian(?:ity)?|catholic|protestant|sikh(?:ism)?|jain(?:ism)?|"
    r"buddhis[tm]|parsi|zoroastrian|jewish|judaism|atheist|religious|brahmin|kshatriya|vaishya|shudra|dalit|"
    r"adivasi|scheduled\s+(?:caste|tribe)s?|obc|sc/st|caste)\b", re.IGNORECASE)
_NATIONALITY = re.compile(
    r"\b(?:nationality|citizen(?:ship)?\s+of|citizen|passport\s+(?:no|number|holder)\b[^,;\n]*|mother\s+tongue|"
    r"native\s+of|place\s+of\s+birth|birthplace|(?:indian|american|british|pakistani|bangladeshi|nepali|"
    r"sri\s+lankan|chinese|nigerian|filipino|german|french|canadian|australian)\s+(?:national|citizen|origin))\b",
    re.IGNORECASE)
_DISABILITY = re.compile(r"\b(?:disab(?:led|ility|ilities)|differently[- ]abled|handicap\w*|pwd|wheelchair|"
                         r"medical\s+condition|chronic\s+illness)\b", re.IGNORECASE)
_WORK_AUTH = re.compile(r"\b(?:authori[sz]ed\s+to\s+work|authori[sz]ation\s+to\s+work|work\s+(?:permit|visa|"
                        r"authori[sz]ation)|right\s+to\s+work|visa|sponsorship|green\s+card|h-?1b|"
                        r"permanent\s+resident|eligible\s+to\s+work)\b", re.IGNORECASE)
_CITIZEN = re.compile(r"\b(?:[A-Z]{2,3}|[A-Z][a-z]+)\s+(?:citizen(?:ship)?|national|passport\s+holder|permanent\s+"
                      r"resident)\b|\b(?:citizen|permanent\s+resident)\s+of\s+(?:the\s+)?[A-Z][\w]*(?:\s+[A-Z]\w*)*")
_NEEDS_AUTH = re.compile(r"\b(?:authori[sz]|permit|visa|sponsor|right\s+to\s+work|eligib|citizen|resident)",
                         re.IGNORECASE)


@dataclass
class RedactedProfile:
    """What the ranking may read: `lines` (the resume, one fact per line), `answers` (scrubbed), and `removed`
    (which categories something was taken out of, for the audit log; never the values)."""

    lines: list[str]
    answers: list[ScreeningAnswer]
    total_years: float | None
    removed: list[str] = field(default_factory=list)
    work_authorisation: list[str] = field(default_factory=list)

    def source_lines(self) -> list[str]:
        """Every line evidence may quote: the resume, then each answer."""
        return [*self.lines, *(f"{a.question}: {a.answer}" for a in self.answers), *(a.answer for a in self.answers)]

    def text(self) -> str:
        parts = ["RESUME", *self.lines]
        if self.answers:
            parts += ["", "SCREENING ANSWERS", *(f"Q: {a.question}\nA: {a.answer}" for a in self.answers)]
        return "\n".join(parts)


_ORG_BEFORE = re.compile(r"(?:University|College|Institute|School|State|Bank|Port|Republic)\s+of\s+(?:the\s+)?$")
_ORG_AFTER = re.compile(r"\s*(?:&|and\s+(?:Sons|Co)|University|College|Institute|School|Pvt|Private|Ltd|Limited|Inc|"
                        r"LLC|LLP|GmbH|Group|Industries|Traders|Associates|Technologies|Labs|Foods|Motors|Enterprises|"
                        r"Corporation|Corp|Company|Hospital|Foundation|Trust)\b")


def _name_pattern(name: str | None) -> re.Pattern[str] | None:
    parts = sorted({p for p in re.split(r"[\s.,]+", name or "") if len(p) >= 2}, key=len, reverse=True)
    if not parts:
        return None
    return re.compile(r"\b(?:" + "|".join(re.escape(p) for p in parts) + r")\b", re.IGNORECASE)


class _Scrubber:
    def __init__(self, resume: ParsedResume, keep_work_auth: bool) -> None:
        self.name = _name_pattern(resume.name)
        self.literals = [v for v in (resume.email, resume.phone) if v]
        self.keep_work_auth = keep_work_auth
        self.removed: set[str] = set()
        self.work_auth: list[str] = []

    def _sub(self, pattern: re.Pattern[str], repl: str, text: str, category: str) -> str:
        out, n = pattern.subn(repl, text)
        if n:
            self.removed.add(category)
        return out

    def _phones(self, text: str) -> str:
        def repl(m: re.Match[str]) -> str:
            if 10 <= sum(ch.isdigit() for ch in m.group(0)) <= 15:
                self.removed.add("contact details")
                return " "
            return m.group(0)  # a date range or a figure, not a phone number

        return _PHONE_LIKE.sub(repl, text)

    def _names(self, text: str) -> str:
        """Every part of the name, except where it's part of an organisation's name ("University of Washington",
        "Sundaram Traders"): those read the same whoever applies, and scrubbing them would make two applicants' text
        differ by their names."""
        assert self.name is not None

        def repl(m: re.Match[str]) -> str:
            if _ORG_BEFORE.search(text, 0, m.start()) or _ORG_AFTER.match(text, m.end()):
                return m.group(0)
            self.removed.add("name")
            return REDACTED_NAME

        return self.name.sub(repl, text)

    def line(self, raw: str, *, names: bool = True) -> str:
        """One line without protected attributes; "" when nothing job-related is left. `names=False` for a company or
        school field (an organisation's name stays as written)."""
        text = clean(raw).replace("\n", " ")
        if not text:
            return ""
        auth_line = self.keep_work_auth and bool(_WORK_AUTH.search(text))
        if self.keep_work_auth:
            # Citizenship is a nationality, but here (the job needs work authorisation) it's the statement: just it.
            self.work_auth += [m.group(0) for m in _CITIZEN.finditer(text)]
        if _LABEL_LINE.match(text):
            self.removed.add("personal details")
            return ""
        for lit in self.literals:
            if lit in text:
                text = text.replace(lit, " ")
                self.removed.add("contact details")
        text = self._sub(_EMAIL, " ", text, "contact details")
        text = self._sub(_URL, " ", text, "contact details")
        text = self._phones(text)
        text = self._sub(_PHOTO, " ", text, "photo")
        text = self._sub(_DOB, " ", text, "age")
        text = self._sub(_HONORIFIC, "", text, "gender")
        if self.name is not None and names:
            text = self._names(text)
        for pattern, repl in _GENDERED_TITLES:
            text = self._sub(re.compile(rf"\b{pattern}\b", re.IGNORECASE), repl, text, "gender")
        text = self._sub(_GENDER_WORDS, " ", text, "gender")
        for rx, repl in _PRONOUNS:
            text = self._sub(rx, repl, text, "gender")
        text = self._sub(_MARITAL, " ", text, "marital status")
        text = self._sub(_RELIGION_CASTE, " ", text, "religion or caste")
        text = self._sub(_NATIONALITY, " ", text, "nationality")
        text = self._sub(_DISABILITY, " ", text, "health or disability")
        text = re.sub(r"\(\s*[,;/]*\s*\)", " ", text)
        text = re.sub(r"\s+([,.;:!?])", r"\1", re.sub(r"\s{2,}", " ", text)).strip(" ,;|-–")
        text = text if any(ch.isalnum() for ch in text) else ""
        if auth_line and text:
            self.work_auth.append(text)  # the scrubbed line: "Authorised to work in India", nothing else personal
        return text


def _years(v: float | None) -> str:
    return f"{v:g}" if v is not None else "not stated"


def redact_for_ranking(resume: ParsedResume, answers: list[ScreeningAnswer],
                       job: JobSpec | None = None) -> RedactedProfile:
    """The resume and answers as the ranking may see them (see the module docstring for what's removed)."""
    keep_auth = bool(job and job.location_rules and _NEEDS_AUTH.search(job.location_rules))
    s = _Scrubber(resume, keep_auth)
    lines: list[str] = []
    if resume.headline and (h := s.line(resume.headline)):
        lines.append(f"Headline: {h}")
    lines.append(f"Total experience (years): {_years(resume.total_years)}")
    skills = [x for x in (s.line(k) for k in resume.skills) if x]
    if skills:
        lines.append("Skills: " + ", ".join(dict.fromkeys(skills)))
    for e in resume.experience:
        title, company = s.line(e.title), s.line(e.company, names=False)
        dates = " – ".join(d for d in (s.line(e.start or ""), s.line(e.end or "")) if d)
        head = " at ".join(x for x in (title, company) if x)
        if head or dates:
            lines.append(f"Role: {head}" + (f" ({dates})" if dates else ""))
        for sentence in re.split(r"(?<=[.;])\s+|\n+|\s+[•▪●]\s*", e.summary or ""):
            if (t := s.line(sentence)):
                lines.append(t)
    if resume.education:
        s.removed.add("age")  # education years are never shown
    for ed in resume.education:
        text = " – ".join(x for x in (s.line(ed.degree), s.line(ed.school, names=False)) if x)
        if text:
            lines.append(f"Education: {text}")
    if resume.location:
        s.removed.add("location")
    if resume.name:
        s.removed.add("name")
    clean_answers = []
    for a in answers:
        q = s.line(a.question)
        ans = " ".join(x for x in (s.line(part) for part in clean(a.answer).split("\n")) if x)
        if q:
            clean_answers.append(ScreeningAnswer(question=q, answer=ans))
    work_auth = [w for w in dict.fromkeys(s.work_auth)] if keep_auth else []
    if keep_auth:
        lines += [f"Work authorisation: {w}" for w in work_auth]
    return RedactedProfile(lines=lines, answers=clean_answers, total_years=resume.total_years,
                           removed=sorted(s.removed), work_authorisation=work_auth)
