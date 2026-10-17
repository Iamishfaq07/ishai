"""users.grant_started_at, grant_paid, grant_queue: allowance windows from when a grant began, and grants waiting
their turn (DECISIONS D57)

Revision ID: c6e8a0b2d4f6
Revises: b4d6f8a0c2e4
Create Date: 2026-10-18 12:00:00.000000

Backfill: a running grant's start is taken from what made it, whichever came last: the latest approved paid month
(its approval, or its own start if it was added onto the end of an earlier one) or the admin's latest grant (from
the audit log). Neither found: left empty, and the grant keeps its windows counted back from its end, as before.
"""
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa

from alembic import op

revision: str = 'c6e8a0b2d4f6'
down_revision: str | Sequence[str] | None = 'b4d6f8a0c2e4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

users = sa.table("users", sa.column("id", sa.String), sa.column("grant_until", sa.DateTime(timezone=True)),
                 sa.column("grant_started_at", sa.DateTime(timezone=True)), sa.column("grant_paid", sa.Boolean))
payments = sa.table("payments", sa.column("user_id", sa.String), sa.column("status", sa.String),
                    sa.column("days", sa.Integer), sa.column("decided_at", sa.DateTime(timezone=True)))
audit = sa.table("audit_logs", sa.column("action", sa.String), sa.column("target", sa.String),
                 sa.column("created_at", sa.DateTime(timezone=True)))


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def upgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('grant_started_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('grant_paid', sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column('grant_queue', sa.JSON(), nullable=True))
    conn = op.get_bind()
    for uid, until in conn.execute(sa.select(users.c.id, users.c.grant_until)
                                   .where(users.c.grant_until.is_not(None))).all():
        until = _aware(until)
        paid = conn.execute(sa.select(payments.c.decided_at, payments.c.days).where(
            payments.c.user_id == uid, payments.c.status == "approved", payments.c.days > 0,
            payments.c.decided_at.is_not(None), payments.c.decided_at < until)
            .order_by(payments.c.decided_at.desc()).limit(1)).first()
        given = conn.execute(sa.select(audit.c.created_at).where(
            audit.c.action == "admin.access.grant", audit.c.target.like(f"{uid} %"), audit.c.created_at < until)
            .order_by(audit.c.created_at.desc()).limit(1)).first()
        bought_at = _aware(paid[0]) if paid else None
        given_at = _aware(given[0]) if given else None
        if bought_at is not None and (given_at is None or bought_at >= given_at):
            # Added onto the end of an earlier month, it began where that one ended: whichever is earlier.
            start, was_paid = min(bought_at, until - timedelta(days=int(paid[1]))), True
        elif given_at is not None:
            start, was_paid = given_at, False
        else:
            continue
        conn.execute(sa.update(users).where(users.c.id == uid).values(grant_started_at=start, grant_paid=was_paid))


def downgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.drop_column('grant_queue')
        batch.drop_column('grant_paid')
        batch.drop_column('grant_started_at')
