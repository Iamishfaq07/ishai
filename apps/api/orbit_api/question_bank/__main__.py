"""`uv run python -m orbit_api.question_bank [file …]`: check every question-bank file (or just the ones named) and
say what the bank holds."""

import json
import sys
from pathlib import Path

from pydantic import ValidationError

from orbit_api.question_bank.load import COMPANIES_DIR, BankError, companies, roles
from orbit_api.question_bank.schema import CompanyGuide, RolePack


def _one(path: Path) -> str | None:
    """What's wrong with one file, or None."""
    model = CompanyGuide if path.resolve().parent == COMPANIES_DIR.resolve() else RolePack
    try:
        entry = model.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (ValidationError, json.JSONDecodeError, OSError) as e:
        return f"{path.name}: {e}"
    return None if entry.slug == path.stem else f"{path.name}: slug {entry.slug!r} must match the file name"


def main(args: list[str]) -> int:
    if args:
        problems = [p for p in (_one(Path(a)) for a in args) if p]
        print("\n".join(problems) if problems else f"{len(args)} file(s) pass.", file=sys.stderr if problems else None)
        return 1 if problems else 0
    try:
        guides, packs = companies(), roles()
    except BankError as e:
        print(e, file=sys.stderr)
        return 1
    questions = sum(len(g.questions) for g in guides) + sum(len(p.questions) for p in packs)
    print(f"{len(guides)} company guides, {len(packs)} role packs, {questions} questions: all pass.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
