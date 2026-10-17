"""Orbit's question bank: company interview guides and role packs, written by Orbit, kept as reviewed JSON files.

`companies/<slug>.json` is how a well-known company interviews, as candidates commonly report it: its rounds, what
its interviewers listen for (its published values where it has them), practice questions in that style with what a
good answer covers, and tips. `roles/<slug>.json` is the same for a job (data analyst, nurse, product manager…).

They feed the mock interviewer and the live copilot (live/company_styles.py, live/role_packs.py), the Practice
page's "What to expect" (GET /v1/interview-styles) and the public /companies and /roles pages, which the web build
renders to HTML from these same files (apps/web/src/pages/bank). The format and its checks are in schema.py; run
`uv run python -m orbit_api.question_bank` to check every file after editing one.
"""

from orbit_api.question_bank.load import BankError, companies, key, roles
from orbit_api.question_bank.schema import CompanyGuide, Question, RolePack

__all__ = ["BankError", "CompanyGuide", "Question", "RolePack", "companies", "key", "roles"]
