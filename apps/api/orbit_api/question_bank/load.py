"""Reading the question bank: every file under companies/ and roles/, checked against schema.py, once per process.

A file that doesn't pass stops the API from starting (and fails the tests and the web build) instead of serving a
half-written guide. Names are compared the way a typed company or role is matched (`key`), so two entries can never
claim the same name.
"""

import json
import re
from functools import cache
from pathlib import Path

from pydantic import BaseModel, ValidationError

from orbit_api.question_bank.schema import CompanyGuide, RolePack

ROOT = Path(__file__).parent
COMPANIES_DIR = ROOT / "companies"
ROLES_DIR = ROOT / "roles"

_SUFFIXES = ("ltd", "limited", "inc", "pvt", "private", "llc", "corp", "corporation", "co")


def key(name: str) -> str:
    """'Tata Consultancy Services Ltd.' → 'tata consultancy services': how a typed name is compared."""
    words = re.findall(r"[a-z0-9]+", name.lower())
    while words and words[-1] in _SUFFIXES:
        words.pop()
    return " ".join(words)


class BankError(ValueError):
    """A question-bank file that doesn't pass its checks: the file and what's wrong."""


def _read[M: BaseModel](folder: Path, model: type[M]) -> list[M]:
    out: list[M] = []
    problems: list[str] = []
    for path in sorted(folder.glob("*.json")):
        try:
            entry = model.model_validate(json.loads(path.read_text(encoding="utf-8")))
        except (ValidationError, json.JSONDecodeError) as e:
            problems.append(f"{path.name}: {e}")
            continue
        if getattr(entry, "slug", None) != path.stem:
            problems.append(f"{path.name}: slug {getattr(entry, 'slug', None)!r} must match the file name")
            continue
        out.append(entry)
    if problems:
        raise BankError("\n".join(problems))
    return out


def _unique_names(entries: list[CompanyGuide] | list[RolePack], what: str) -> None:
    seen: dict[str, str] = {}
    problems: list[str] = []
    for e in entries:
        for name in {key(n) for n in (e.name, e.slug.replace("-", " "), *e.aliases)}:
            if not name:
                problems.append(f"{e.slug}: an empty name or alias")
            elif seen.get(name, e.slug) != e.slug:
                problems.append(f"{what} {e.slug!r} and {seen[name]!r} both answer to {name!r}")
            seen[name] = e.slug
    if problems:
        raise BankError("\n".join(problems))


@cache
def companies() -> tuple[CompanyGuide, ...]:
    """Every company guide, in file-name order."""
    out = _read(COMPANIES_DIR, CompanyGuide)
    _unique_names(out, "company")
    return tuple(out)


@cache
def roles() -> tuple[RolePack, ...]:
    """Every role pack, in file-name order."""
    out = _read(ROLES_DIR, RolePack)
    _unique_names(out, "role")
    return tuple(out)
