"""Custom vocabulary for the speech-to-text: the words this interview will use that a general model mishears.

Deepgram's keyterm prompting works per term ("Kubernetes", "gRPC", "Northwind"), so whole resume lines ("Languages:
Python, Go, TypeScript") don't help. This pulls individual terms from the resume's skills, tech names from the
resume and job post, and the company and role, most useful first.
"""

import re
from collections.abc import Iterable

from orbit_api.retrieval.index import IndexedChunk

MAX_KEYTERMS = 50  # Deepgram caps keyterm prompting at about 500 tokens
_MAX_TERM = 30

# Separators inside a skills line: "Python, Go; AWS (EKS, Lambda) | SAST/DAST • Terraform and Ansible".
# (?<!\s): start only where a run of spaces begins, so a long run costs one pass instead of one per space.
_SPLIT = re.compile(r"(?<!\s)\s*(?:[,;|•·()\[\]]|/(?!\w{1,2}\b)|\band\b|&)\s*")
_LABEL = re.compile(r"^[^:]{1,40}:\s*")  # "Infrastructure: …"
# Tech-shaped words in running text: PostgreSQL, gRPC, BigQuery, AWS, EC2, Node.js, C++, C#, .NET, K8s.
_TECH = re.compile(
    r"(?<![\w.])(?:[A-Z][a-z]+[A-Z][\w]*|[a-z]+[A-Z][\w]*|[A-Z]{2,6}\d*s?|[A-Za-z]+\.js|[A-Za-z]\+\+|[A-Za-z]#"
    r"|\.NET|[A-Za-z]+\d+[A-Za-z\d]*)(?![\w])"
)
# A capitalized word inside a sentence is a name: a product, language or company ("with Go or Rust", "for Stripe").
_NAME = re.compile(r"(?<=[a-z0-9,;] )[A-Z][a-z]{2,}(?:[A-Z][a-z]+)*\b")
_STOP = frozenset({"and", "or", "the", "with", "for", "you", "our", "we", "a", "an", "of", "to", "in", "on", "etc",
                   "ok", "us", "it", "i", "id", "tbd", "faq", "ceo", "cto", "hr", "pto", "usa", "uk", "eu", "corp",
                   "inc", "ltd", "llc", "gmbh", "co", "group",
                   # job-title words: common English the model already knows
                   "engineer", "engineering", "developer", "backend", "frontend", "senior", "staff", "lead",
                   "principal", "manager", "intern", "junior", "team", "role", "remote", "hybrid"})


def _clean(term: str) -> str:
    return term.strip(" .:-–—*\t").strip()


def _skill_terms(line: str) -> list[str]:
    body = _LABEL.sub("", line)
    out = []
    for part in _SPLIT.split(body):
        term = _clean(part)
        if 2 <= len(term) <= _MAX_TERM and any(ch.isalpha() for ch in term) and len(term.split()) <= 3:
            out.append(term)
    return out


def tech_terms(text: str) -> list[str]:
    return [m.group(0) for m in _TECH.finditer(text)] + [m.group(0) for m in _NAME.finditer(text)]


def extract_keyterms(chunks: Iterable[IndexedChunk], *, company: str | None = None,
                     role: str | None = None) -> list[str]:
    """The session's vocabulary, deduplicated (case-insensitive), most useful first: company and role, the resume's
    skills, then tech names found in the job post and the rest of the documents."""
    chunks = list(chunks)
    ranked: list[str] = []
    if company:
        ranked.append(company)
    if role:
        ranked += [m.group(0) for m in _TECH.finditer(role)]  # "SRE", "iOS": not "Senior" or "Engineer"
    ranked += [t for c in chunks if c.category == "skill" for t in _skill_terms(c.text)]
    ranked += [t for c in chunks if c.doc_kind == "job_description" for t in tech_terms(c.text)]
    ranked += [t for c in chunks if c.doc_kind != "job_description" and c.category != "skill"
               for t in tech_terms(c.text)]
    seen: set[str] = set()
    out: list[str] = []
    for term in ranked:
        key = term.lower()
        if key in seen or key in _STOP or not (2 <= len(term) <= _MAX_TERM):
            continue
        seen.add(key)
        out.append(term)
        if len(out) >= MAX_KEYTERMS:
            break
    return out


def shaped_terms(text: str) -> list[str]:
    """Only the tech-shaped words (PostgreSQL, gRPC, AWS, Node.js), not capitalized names: safe to read as skills
    without mistaking a sentence's first word for a tool."""
    return [m.group(0) for m in _TECH.finditer(text)]
