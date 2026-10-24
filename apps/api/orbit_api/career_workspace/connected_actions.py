"""Connect reviewed email delivery and transition preparation to the existing Today queue."""
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import case, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api.models import CareerWorkspaceState, GmailAttempt, JobApplication


async def connected_actions(db: AsyncSession, user_id: str, now: datetime) -> tuple[list[dict[str, Any]], bool]:
    items: list[dict[str, Any]] = []
    rows = list((await db.execute(select(GmailAttempt, JobApplication).join(
        JobApplication, GmailAttempt.application_id == JobApplication.id).where(
        GmailAttempt.user_id == user_id, JobApplication.user_id == user_id,
        GmailAttempt.status.in_(("ready", "sending", "uncertain", "rejected")),
        or_(GmailAttempt.status != "ready", JobApplication.status.not_in(("rejected", "withdrawn", "hired"))))
        .order_by(case((GmailAttempt.status.in_(("sending", "uncertain")), 0), else_=1),
                  GmailAttempt.created_at, GmailAttempt.id).limit(101))).all())
    for attempt, job in rows[:100]:
        uncertain = attempt.status in {"sending", "uncertain"}
        items.append({"id": f"gmail:{attempt.id}", "kind": "application", "source_channel": "gmail",
            "source_status": attempt.status, "title": f"{job.title} · {job.company}",
            "detail": "Check Gmail Sent and this attempt's saved result. Do not resend automatically."
                if uncertain else "Review the saved recipient, email and exact attachment before sending."
                if attempt.status == "ready" else "Gmail rejected this request. Review the result and connection.",
            "due_at": None, "overdue": False,
            "source_updated_at": attempt.created_at.isoformat(),
            "path": f"/jobs/mission/{job.id}#gmail-apply",
            "action_label": "Check Gmail delivery" if uncertain else "Review email draft"
                if attempt.status == "ready" else "Review rejected email"})
    plan = await db.get(CareerWorkspaceState, (user_id, "transition"))
    today, horizon = now.date().isoformat(), (now + timedelta(days=7)).date().isoformat()
    if plan:
        for row in plan.data.get("requirements", []):
            due = row.get("due", "")
            if row.get("state") == "demonstrated" or not row.get("nextAction", "").strip() or (due and due > horizon):
                continue
            items.append({"id": f"transition:{row['id']}", "kind": "preparation", "source_channel": "transition",
                "title": row["nextAction"], "detail": f"{plan.data.get('targetRole', 'Target role')}: "
                    f"{row['requirement']}. "
                    + (f"Due {due} (date only; compared in UTC)." if due else "Choose a due date."),
                "due_at": None, "due_date": due or None, "overdue": bool(due and due < today),
                "path": "/learn#transition-planner", "action_label": "Open transition plan"})
    return items, len(rows) > 100
