"""What interviews for a job usually test, for the mock interviewer and the live copilot: the question bank's role
packs (question_bank/roles/*.json), matched to the role a session names.

A role is typed freely ("Senior Software Engineer II, Payments", "SDE-2", "Data Analyst Intern"), so matching drops
the level words first and then looks for a pack's name or alias in what's left. A one-word alias ("sde", "nurse")
has to be the whole role: "SAP Consultant" isn't management consulting, and "Staff Engineer" isn't any one pack.
"""

from orbit_api import question_bank
from orbit_api.question_bank.schema import RolePack

PACKS: tuple[RolePack, ...] = question_bank.roles()

# Level and type words that say nothing about which job it is.
_LEVEL = frozenset({
    "senior", "sr", "junior", "jr", "lead", "principal", "staff", "chief", "head", "intern", "internship", "trainee",
    "fresher", "graduate", "entry", "level", "mid", "i", "ii", "iii", "iv", "1", "2", "3", "4", "5", "remote",
    "contract", "temporary", "part", "time", "full", "hybrid",
})

_BY_KEY: dict[str, RolePack] = {}
for _p in PACKS:
    for _n in (_p.name, _p.slug.replace("-", " "), *_p.aliases):
        _BY_KEY[question_bank.key(_n)] = _p


def match(role: str | None) -> RolePack | None:
    """The pack for a typed role, or None when none fits."""
    if not role:
        return None
    whole = question_bank.key(role)
    if whole in _BY_KEY:
        return _BY_KEY[whole]
    words = [w for w in whole.split() if w not in _LEVEL]
    if not words:
        return None
    if (bare := " ".join(words)) in _BY_KEY:
        return _BY_KEY[bare]
    # The longest run of two or more words that names a pack ("java backend developer" → "backend developer").
    for size in range(len(words) - 1, 1, -1):
        for start in range(len(words) - size + 1):
            hit = _BY_KEY.get(" ".join(words[start:start + size]))
            if hit is not None:
                return hit
    return None


def interviewer_brief(pack: RolePack) -> str:
    """For the mock interviewer: what interviews for this job usually test, as the questions' subject matter."""
    examples = " / ".join(q.text for q in pack.questions if q.type == "role")
    return (f"Interviews for {pack.name.lower()} roles usually check: {'; '.join(pack.looks_for)}. Cover those in "
            f"your questions, at the candidate's level (for example: {examples[:400]}), and don't name the skill "
            "you're testing.")


def copilot_hint(pack: RolePack) -> str:
    """For the live copilot: what interviewers for this job listen for, so an answer can show it."""
    return (f"Interviewers for {pack.name.lower()} roles usually check: {'; '.join(pack.looks_for)}. Where it fits "
            "naturally, let the answer show the skill this question tests; never name it.")
