"""Deterministic next actions from owned records; no model decides urgency or changes state."""
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import Select, select

from orbit_api.models import ApplicationPacket, JobApplication

TERMINAL_JOBS = ("rejected", "hired", "withdrawn")
PACKET_ACTIONS = {
    "needs_answer": ("Add a truthful answer to a required question.", "Answer questions"),
    "review": ("Review the prepared application before approval.", "Review application"),
    "needs_you": ("This application needs your attention before it can proceed.", "Resolve blocker"),
    "handoff": ("Finish this application on the employer's site.", "Review handoff"),
    "failed": ("Check the application result before deciding what to do next.", "Check result"),
    "expired": ("These prepared materials expired. Check the saved result and current job "
                "before choosing whether to retry.",
                "Review expired application"),
}


def attention_packets(user_id: str) -> Select[tuple[ApplicationPacket]]:
    closed = select(JobApplication.id).where(
        (JobApplication.id == ApplicationPacket.application_id)
        | (JobApplication.listing_id == ApplicationPacket.listing_id),
        JobApplication.user_id == user_id, JobApplication.status.in_(TERMINAL_JOBS)).exists()
    return select(ApplicationPacket).where(ApplicationPacket.user_id == user_id,
        ApplicationPacket.status.in_(tuple(PACKET_ACTIONS)), ~closed)


def priority(item: dict[str, Any], now: datetime) -> tuple[int, str, str]:
    """Explain the first choice. Only actual dates create time-based priority."""
    kind = item["kind"]
    due = datetime.fromisoformat(item["due_at"]) if item["due_at"] else None
    if kind == "interview" and item["overdue"]:
        rank, why = 0, "The saved interview date has passed. Record what happened or update the next round."
    elif kind == "interview" and due is not None and due <= now + timedelta(hours=24):
        rank, why = 1, "Your saved interview is within the next 24 hours."
    elif item.get("source_channel") == "gmail":
        uncertain = item["source_status"] in {"sending", "uncertain"}
        rank = 2 if uncertain else 4
        why = "Delivery is unresolved. Check Gmail Sent before any further action." if uncertain else (
            "Your prepared email requires review before sending." if item["source_status"] == "ready"
            else "The rejected Gmail request needs review.")
    elif item.get("source_channel") == "transition":
        rank = 2 if item["overdue"] else 6 if item.get("due_date") else 8
        why = "Your recorded transition action is past its due date." if item["overdue"] else (
            "A transition action is due within seven days." if item.get("due_date")
            else "Schedule a concrete next step in your transition plan.")
    elif item["overdue"]:
        rank, why = 2, "Your saved follow-up date or enabled reminder rule is past due."
    elif kind == "application" and "source_status" in item:
        state = item["source_status"]
        rank = 3 if state == "needs_answer" else 4 if state == "review" else 5
        why = {"needs_answer": "This application is waiting for an answer only you can provide.",
            "review": "Your prepared application is waiting for your review.",
            "needs_you": "This application cannot proceed without your input.",
            "handoff": "Orbit handed this application back to you to finish.",
            "failed": "The saved result needs review before any retry.",
            "expired": "Expired materials need review before a new attempt."}[state]
    elif kind == "application" and item.get("rule"):
        # Workflow-rule suggestions (a saved job to decide on, contacts to find) carry no application packet status,
        # and no date: they come after everything that is actually dated.
        # Finding contacts is always on; the other suggestions come from rules the candidate enabled.
        rank, why = 7, ("No one is saved at this company yet." if item["rule"] == "find_contacts"
                        else "A workflow rule you turned on suggests this step.")
    else:
        rank, why = 6, "This is the next saved date in your seven-day plan."
    item["priority_reason"] = why
    return rank, item["due_at"] or item.get("due_date") or item.get("source_updated_at", ""), item["id"]
