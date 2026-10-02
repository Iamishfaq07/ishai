"""credit_entries + payments.resume_credits/interview_minutes: credits instead of a monthly free allowance

Every existing account gets the welcome credits (1 resume-AI credit, 20 interview minutes); a running Resume Pro
grant (the 30-day plan this replaces) becomes 50 resume credits.

Revision ID: f8c2d4e6a1b3
Revises: e7b3c9d1f5a2
Create Date: 2026-10-02 18:00:00.000000

"""
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f8c2d4e6a1b3'
down_revision: str | Sequence[str] | None = 'e7b3c9d1f5a2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

WELCOME_RESUME = 1
WELCOME_INTERVIEW_S = 20 * 60
RESUME_PRO_CREDITS = 50


def upgrade() -> None:
    """Upgrade schema."""
    entries = op.create_table(
        'credit_entries',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('amount', sa.Integer(), nullable=False),
        sa.Column('reason', sa.String(length=20), nullable=False),
        sa.Column('payment_id', sa.String(length=36), nullable=True),
        sa.Column('ip_hash', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_credit_entries_user_id', 'credit_entries', ['user_id'])
    op.create_index('ix_credit_entries_welcome', 'credit_entries', ['reason', 'ip_hash', 'created_at'])
    op.add_column('payments', sa.Column('resume_credits', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('payments', sa.Column('interview_minutes', sa.Integer(), nullable=False, server_default='0'))

    bind = op.get_bind()
    now = datetime.now(UTC)
    users = sa.table('users', sa.column('id', sa.String), sa.column('grant_plan', sa.String),
                     sa.column('grant_until', sa.DateTime(timezone=True)))
    rows = []
    for (uid,) in bind.execute(sa.select(users.c.id)).all():
        rows.append({'id': str(uuid.uuid4()), 'user_id': uid, 'kind': 'resume', 'amount': WELCOME_RESUME,
                     'reason': 'welcome', 'created_at': now})
        rows.append({'id': str(uuid.uuid4()), 'user_id': uid, 'kind': 'interview_seconds',
                     'amount': WELCOME_INTERVIEW_S, 'reason': 'welcome', 'created_at': now})
    for (uid,) in bind.execute(sa.select(users.c.id).where(users.c.grant_plan == 'resume_pro')).all():
        rows.append({'id': str(uuid.uuid4()), 'user_id': uid, 'kind': 'resume', 'amount': RESUME_PRO_CREDITS,
                     'reason': 'admin', 'created_at': now})
    if rows:
        op.bulk_insert(entries, rows)
    bind.execute(users.update().where(users.c.grant_plan == 'resume_pro').values(grant_plan=None, grant_until=None))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('payments') as batch:
        batch.drop_column('interview_minutes')
        batch.drop_column('resume_credits')
    op.drop_index('ix_credit_entries_welcome', table_name='credit_entries')
    op.drop_index('ix_credit_entries_user_id', table_name='credit_entries')
    op.drop_table('credit_entries')
