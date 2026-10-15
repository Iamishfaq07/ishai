"""Company loop memory: the earlier rounds a candidate had with the same company (live sessions and practice), so the
next round knows what was already asked and which of their stories were already told. A hiring loop's interviewers
compare notes, and the same story twice in one loop reads as having only one.

Everything comes from what each session already keeps: its questions, and the story-bank entries its answers cited
(an answer's `sources`, doc_kind "story"). Nothing new is stored. Only the user's own sessions are read.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import Answer, LiveSessionRow, Question, Workspace

MAX_ROUNDS = 6  # the most recent earlier rounds read
MAX_QUESTIONS = 15
MAX_STORIES = 10
SCAN = 80  # the user's most recent sessions looked at to find the company's


def _norm(name: str | None) -> str:
    return " ".join((name or "").lower().replace(".", " ").split())


def same_company(a: str | None, b: str | None) -> bool:
    return bool(_norm(a)) and _norm(a) == _norm(b)


@dataclass
class LoopMemory:
    company: str
    rounds: int = 0
    last_round_at: datetime | None = None
    questions: list[str] = field(default_factory=list)  # newest round first, no repeats
    stories: list[str] = field(default_factory=list)  # story titles already told in this loop

    def prompt_context(self) -> dict[str, Any] | None:
        """What the live answer's reference data carries about earlier rounds (None when there were none)."""
        if not self.rounds:
            return None
        return {"rounds": self.rounds, "questions_already_asked": self.questions, "stories_already_told": self.stories}


async def _company_of(db: AsyncSession, row: LiveSessionRow, workspaces: dict[str, str | None]) -> str | None:
    if row.company:
        return row.company
    if row.workspace_id:
        if row.workspace_id not in workspaces:
            ws = await db.get(Workspace, row.workspace_id)
            workspaces[row.workspace_id] = ws.company if ws is not None and ws.user_id == row.user_id else None
        if workspaces[row.workspace_id]:
            return workspaces[row.workspace_id]
    mock = row.mock_config or {}
    negotiation = mock.get("negotiation")
    company = negotiation.get("company") if isinstance(negotiation, dict) else mock.get("company")
    return company if isinstance(company, str) else None


async def loop_memory(db: AsyncSession, user_id: str, company: str | None,
                      exclude_session_id: str | None = None) -> LoopMemory:
    memory = LoopMemory(company=(company or "").strip())
    if not memory.company:
        return memory
    rows = (await db.scalars(select(LiveSessionRow).where(LiveSessionRow.user_id == user_id)
                             .order_by(LiveSessionRow.created_at.desc()).limit(SCAN))).all()
    workspaces: dict[str, str | None] = {}
    rounds = [r for r in rows if r.id != exclude_session_id and r.status != "created"
              and same_company(await _company_of(db, r, workspaces), memory.company)][:MAX_ROUNDS]
    if not rounds:
        return memory
    memory.rounds = len(rounds)
    memory.last_round_at = rounds[0].ended_at or rounds[0].created_at
    ids = [r.id for r in rounds]
    order = {sid: i for i, sid in enumerate(ids)}

    questions = (await db.execute(select(Question.session_id, Question.text, Question.created_at)
                                  .where(Question.session_id.in_(ids)))).all()
    seen: set[str] = set()
    for _sid, text, _at in sorted(questions, key=lambda q: (order[q[0]], q[2])):
        key = " ".join(text.lower().split())
        if key and key not in seen:
            seen.add(key)
            memory.questions.append(" ".join(text.split())[:300])
        if len(memory.questions) >= MAX_QUESTIONS:
            break

    contents = (await db.scalars(select(Answer.content).where(Answer.session_id.in_(ids),
                                                              Answer.status == "completed"))).all()
    told: set[str] = set()
    for content in contents:
        for src in (content or {}).get("sources") or []:
            title = src.get("document") if isinstance(src, dict) and src.get("doc_kind") == "story" else None
            if isinstance(title, str) and title.strip() and title.strip().lower() not in told:
                told.add(title.strip().lower())
                memory.stories.append(title.strip()[:160])
    memory.stories = memory.stories[:MAX_STORIES]
    return memory
