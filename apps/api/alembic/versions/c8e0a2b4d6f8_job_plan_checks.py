"""job_plan_checks: ticked items of a tracked job's interview prep plan

Revision ID: c8e0a2b4d6f8
Revises: b7d9f1a3c5e7
Create Date: 2026-10-16 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c8e0a2b4d6f8'
down_revision: str | Sequence[str] | None = 'b7d9f1a3c5e7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'job_plan_checks',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('application_id', sa.String(length=36), nullable=False),
        sa.Column('item_key', sa.String(length=64), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['application_id'], ['job_applications.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('application_id', 'item_key', name='uq_job_plan_checks_item'),
    )
    op.create_index('ix_job_plan_checks_user_id', 'job_plan_checks', ['user_id'])
    op.create_index('ix_job_plan_checks_application_id', 'job_plan_checks', ['application_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_job_plan_checks_application_id', table_name='job_plan_checks')
    op.drop_index('ix_job_plan_checks_user_id', table_name='job_plan_checks')
    op.drop_table('job_plan_checks')
