"""Interview-theme query expansion for the lexical/hash retrievers.

Interviewers ask about themes ("stakeholder conflict", "a failure"); resumes describe events ("resolved release
disagreements", "shipped late because I underestimated…"). The words rarely overlap. Each theme maps generic
trigger words to the vocabulary that describes such events on a resume. It's generic interview knowledge, not tuned
to any one document, and applied to queries only.
"""

import re

_THEMES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\b(conflict|disagree\w*|dispute|stakeholder|push ?back|difficult (colleague|person|stakeholder))"),
     "disagreement disagreements dispute resolve resolved negotiated conflict aligned compromise"),
    (re.compile(r"\b(trade-?offs?|decision|decide|chose|choice|pick\w*|versus|vs)\b"),
     "chose over instead accepting tradeoff decided because"),
    (re.compile(r"\b(fail\w*|mistake|wrong|missed|deadline|late|regret|learn\w*)\b"),
     "late underestimated mistake failed missed learned afterwards"),
    (re.compile(r"\b(mentor\w*|coach\w*|grow|develop (others|people)|teach\w*|junior)\b"),
     "mentored coached pairing junior promoted taught"),
    (re.compile(r"\b(ownership|owned|own(ed)? it|nobody|initiative|step(ped)? up)\b"),
     "took ownership owned abandoned nobody maintained initiative"),
    (re.compile(r"\b(incident|outage|pressure|on-?call|crisis|emergency|production issue|went down)\b"),
     "incident outage restored postmortem commander on-call"),
    (re.compile(r"\b(challenge|challenging|hardest|difficult|complex|toughest)\b"),
     "migration migrated redesign rebuilt scaled cutting"),
    (re.compile(r"\b(scale|traffic|volume|throughput|how big|size)\b"),
     "transactions per second million users throughput requests"),
    (re.compile(r"\b(study|studied|degree|education|university|college|school)\b"),
     "education degree university b.tech bachelor master college"),
    (re.compile(r"\b(cost|costs|cheaper|save money|budget|spend)\b"),
     "reduced costs saving right-sizing cheaper"),
]


def expand(query: str) -> str:
    q = query.lower()
    extra = [words for pattern, words in _THEMES if pattern.search(q)]
    return f"{query} {' '.join(extra)}" if extra else query
