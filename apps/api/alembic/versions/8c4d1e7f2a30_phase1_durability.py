"""phase 1 durability: usage idempotency, cached-token cost columns, dead letters, durable jobs

Revision ID: 8c4d1e7f2a30
Revises: 7b2e3d5a9c21
Create Date: 2026-09-24 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '8c4d1e7f2a30'
down_revision: str | Sequence[str] | None = '7b2e3d5a9c21'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('usage', schema=None) as batch_op:
        batch_op.add_column(sa.Column('idempotency_key', sa.String(length=128), nullable=True))
        batch_op.create_index('uq_usage_idempotency_key', ['idempotency_key'], unique=True)

    with op.batch_alter_table('provider_requests', schema=None) as batch_op:
        batch_op.add_column(sa.Column('cached_input_tokens', sa.Integer(), nullable=False, server_default='0'))
        # NULL = cost unknown (no price for the model). Existing rows keep their (possibly $0) estimates.
        batch_op.alter_column('estimated_cost_usd', existing_type=sa.Float(), nullable=True)

    op.create_table(
        'failed_writes',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('kind', sa.String(length=64), nullable=False),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('error', sa.Text(), nullable=False),
        sa.Column('replayed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_failed_writes_replayed_at', 'failed_writes', ['replayed_at'])

    op.create_table(
        'jobs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('dedupe_key', sa.String(length=128), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('run_after', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_error', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_jobs_status_run_after', 'jobs', ['status', 'run_after'])
    op.create_index('uq_jobs_dedupe_key', 'jobs', ['dedupe_key'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('uq_jobs_dedupe_key', table_name='jobs')
    op.drop_index('ix_jobs_status_run_after', table_name='jobs')
    op.drop_table('jobs')
    op.drop_index('ix_failed_writes_replayed_at', table_name='failed_writes')
    op.drop_table('failed_writes')
    op.execute("UPDATE provider_requests SET estimated_cost_usd = 0 WHERE estimated_cost_usd IS NULL")
    with op.batch_alter_table('provider_requests', schema=None) as batch_op:
        batch_op.alter_column('estimated_cost_usd', existing_type=sa.Float(), nullable=False)
        batch_op.drop_column('cached_input_tokens')
    with op.batch_alter_table('usage', schema=None) as batch_op:
        batch_op.drop_index('uq_usage_idempotency_key')
        batch_op.drop_column('idempotency_key')
