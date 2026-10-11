"""Matching an interview question to the answer bank (kept free of the API layer, for live/context_builder)."""

import re

from orbit_api.retrieval.index import IndexedChunk
from orbit_api.retrieval.lexical import stem

DOC_KIND = "answer"  # IndexedChunk.doc_kind for answer-bank facts
LABEL = "Your answer: "
SAME_QUESTION = 0.6  # share of the longer question's words the other must have to count as the same question
# Words that don't change what a question asks ("So, could you tell me a bit about yourself?"). The search's stoplist
# is no use here: it drops "why", "tell" and "time", which tell questions apart.
_FILLER = frozenset("""
a an the so and or could can would will you me us we i i'd let's lets please just bit little maybe quickly briefly
now then okay ok um uh like to of about do does did is are be your go ahead first kind sort really
""".split())


def question_words(text: str) -> set[str]:
    return {stem(w) for w in re.findall(r"[a-z0-9']+", text.lower()) if w not in _FILLER}


def same_question(a: str, b: str) -> bool:
    """Whether two questions ask the same thing in near enough the same words ("Tell me about yourself." / "So, tell
    me a bit about yourself?"), so a saved answer to one answers the other."""
    wa, wb = question_words(a), question_words(b)
    if not wa or not wb:
        return a.strip().lower() == b.strip().lower()
    return len(wa & wb) / max(len(wa), len(wb)) >= SAME_QUESTION


def chunk_question(c: IndexedChunk) -> str:
    """The question an answer-bank chunk answers (its label without the prefix)."""
    return c.label.removeprefix(LABEL)
