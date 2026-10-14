"""Support handoff tickets: each "talk to a person" Inbox ticket names the chat it copies (one per chat), and goes
when the chat goes (V3-01, V3-05).

Existing tickets are linked from their `context.support_thread_id`. A ticket whose chat no longer exists is a copy
of a chat deleted with its account, so it is deleted now, as it would have been. Where a chat made several tickets
(a double tap before this change), the first is kept and the others' replies and notes are folded into it.

Revision ID: c3e5a7b9d1f2
Revises: a8c1e3f5b7d9
Create Date: 2026-10-14 19:00:00.000000

"""
import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

revision: str = "c3e5a7b9d1f2"
down_revision: str | Sequence[str] | None = "a8c1e3f5b7d9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return None
    return value


def upgrade() -> None:
    with op.batch_alter_table("contact_messages", schema=None) as batch_op:
        batch_op.add_column(sa.Column("source_support_thread_id", sa.String(length=36), nullable=True))

    conn = op.get_bind()
    threads = {r[0] for r in conn.execute(sa.text("SELECT id FROM support_threads"))}
    rows = conn.execute(sa.text(
        "SELECT id, context, replies, admin_note, created_at FROM contact_messages ORDER BY created_at, id")).all()
    by_thread: dict[str, list[Any]] = {}
    for row in rows:
        context = _json(row.context)
        thread_id = context.get("support_thread_id") if isinstance(context, dict) else None
        if isinstance(thread_id, str) and thread_id:
            by_thread.setdefault(thread_id, []).append(row)

    for thread_id, tickets in by_thread.items():
        if thread_id not in threads:
            for t in tickets:
                conn.execute(sa.text("DELETE FROM contact_messages WHERE id = :id"), {"id": t.id})
            continue
        keep, extra = tickets[0], tickets[1:]
        replies = list(_json(keep.replies) or [])
        notes = [keep.admin_note] if keep.admin_note else []
        for t in extra:
            replies.extend(_json(t.replies) or [])
            if t.admin_note:
                notes.append(t.admin_note)
            conn.execute(sa.text("DELETE FROM contact_messages WHERE id = :id"), {"id": t.id})
        params: dict[str, Any] = {"id": keep.id, "thread": thread_id}
        sets = "source_support_thread_id = :thread"
        if extra:
            sets += ", replies = :replies, admin_note = :note"
            params["replies"] = json.dumps(replies) if replies else None
            params["note"] = "\n\n".join(notes) or None
        conn.execute(sa.text(f"UPDATE contact_messages SET {sets} WHERE id = :id"), params)  # noqa: S608

    with op.batch_alter_table("contact_messages", schema=None) as batch_op:
        batch_op.create_index("ux_contact_messages_source_thread", ["source_support_thread_id"], unique=True)
        batch_op.create_foreign_key("fk_contact_messages_source_thread", "support_threads",
                                    ["source_support_thread_id"], ["id"], ondelete="CASCADE")


def downgrade() -> None:
    with op.batch_alter_table("contact_messages", schema=None) as batch_op:
        batch_op.drop_constraint("fk_contact_messages_source_thread", type_="foreignkey")
        batch_op.drop_index("ux_contact_messages_source_thread")
        batch_op.drop_column("source_support_thread_id")
