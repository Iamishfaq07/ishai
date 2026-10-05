"""usage.pool: the balance a session's minutes came out of (the credits, or a plan's own allowance)

Interview time used on a plan with its own allowance (a Pro or Unlimited grant) was also counted against the
account's credits, so when the grant ended the credits were gone; and credits spent earlier in a month ate into a Pro
allowance. Usage rows now say which balance they were drawn from (entitlements.usage_pool), and each balance counts
only its own rows.

Existing interview rows are given the balance they were most likely metered on. A row written while the account had
an admin grant running gets that grant's plan: the grants are replayed from the audit log the way
admin/routes.set_access applied them (the same plan again extends a running grant, another plan replaces it, a revoke
ends it). A row from an account with an active subscription (none are sold any more) gets the subscription's plan,
from when it started. Everything else came out of the credits: the Free plan was the only other way to have
interview time (the admin's own account is unlimited and its credits are never read). So time spent on a grant gives
the credits back.

Revision ID: 45a95e374d53
Revises: c4f6a8b0d2e1
Create Date: 2026-10-05 20:00:00.000000

"""
from collections.abc import Iterable, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '45a95e374d53'
down_revision: str | Sequence[str] | None = 'c4f6a8b0d2e1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

INTERVIEW = ("live_seconds", "mock_seconds")
CREDITS = "credits"


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)  # SQLite returns naive datetimes


def grant_windows(events: Iterable[Sequence[Any]]) -> dict[str, list[list[Any]]]:
    """Each account's grants as [start, end, plan], from (at, action, target) audit rows in time order. The target is
    "<user id> <plan> <hours>h" for a grant and "<user id>" for a revoke."""
    windows: dict[str, list[list[Any]]] = {}
    for at, action, target in events:
        parts = str(target or "").split()
        if not parts:
            continue
        when = _aware(at)
        spans = windows.setdefault(parts[0], [])
        running = spans[-1] if spans and spans[-1][1] > when else None
        if action == "admin.access.grant" and len(parts) == 3:
            try:
                hours = timedelta(hours=float(parts[2].removesuffix("h")))
            except ValueError:
                continue
            if running is not None and running[2] == parts[1]:
                running[1] += hours  # more time on the plan already running
                continue
            if running is not None:
                running[1] = when  # another plan replaces it from now
            spans.append([when, when + hours, parts[1]])
        elif action == "admin.access.revoke" and running is not None:
            running[1] = when
    return windows


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('usage', schema=None) as batch_op:
        batch_op.add_column(sa.Column('pool', sa.String(length=16), nullable=True))

    bind = op.get_bind()
    usage = sa.table('usage', sa.column('id', sa.String), sa.column('user_id', sa.String),
                     sa.column('metric', sa.String), sa.column('pool', sa.String),
                     sa.column('created_at', sa.DateTime(timezone=True)))
    audit = sa.table('audit_logs', sa.column('action', sa.String), sa.column('target', sa.String),
                     sa.column('created_at', sa.DateTime(timezone=True)))
    subs = sa.table('subscriptions', sa.column('user_id', sa.String), sa.column('plan', sa.String),
                    sa.column('status', sa.String), sa.column('created_at', sa.DateTime(timezone=True)))
    interview = usage.c.metric.in_(INTERVIEW)

    windows = grant_windows(bind.execute(
        sa.select(audit.c.created_at, audit.c.action, audit.c.target)
        .where(audit.c.action.in_(('admin.access.grant', 'admin.access.revoke')))
        .order_by(audit.c.created_at)).all())
    # The newest active subscription, as entitlements.plan_for picks it (ascending, so the newest is kept).
    subscribed = {uid: (_aware(at), plan) for uid, plan, at in bind.execute(
        sa.select(subs.c.user_id, subs.c.plan, subs.c.created_at).where(subs.c.status == 'active')
        .order_by(subs.c.created_at)).all()}
    by_pool: dict[str, list[str]] = {}
    for uid in set(windows) | set(subscribed):
        for row_id, at in bind.execute(sa.select(usage.c.id, usage.c.created_at)
                                       .where(usage.c.user_id == uid, interview)).all():
            when = _aware(at)
            pool = next((plan for start, end, plan in windows.get(uid, ()) if start <= when < end), None)
            if pool is None and uid in subscribed and when >= subscribed[uid][0]:
                pool = subscribed[uid][1]
            if pool is not None:
                by_pool.setdefault(pool, []).append(row_id)
    for pool, ids in by_pool.items():
        for i in range(0, len(ids), 500):
            bind.execute(usage.update().where(usage.c.id.in_(ids[i:i + 500])).values(pool=pool))
    bind.execute(usage.update().where(interview, usage.c.pool.is_(None)).values(pool=CREDITS))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('usage', schema=None) as batch_op:
        batch_op.drop_column('pool')
