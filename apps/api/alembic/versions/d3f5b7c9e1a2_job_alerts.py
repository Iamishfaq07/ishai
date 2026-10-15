"""job_search_profiles.alert, .alert_sent_at, .alert_token: job alerts by email

Revision ID: d3f5b7c9e1a2
Revises: c2e4a6b8d0f1
Create Date: 2026-10-15 15:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd3f5b7c9e1a2'
down_revision: str | Sequence[str] | None = 'c2e4a6b8d0f1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('job_search_profiles') as batch:
        batch.add_column(sa.Column('alert', sa.String(length=8), server_default='off', nullable=False))
        batch.add_column(sa.Column('alert_sent_at', sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column('alert_token', sa.String(length=64), nullable=True))
        batch.create_unique_constraint('uq_job_search_profiles_alert_token', ['alert_token'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('job_search_profiles') as batch:
        batch.drop_constraint('uq_job_search_profiles_alert_token', type_='unique')
        batch.drop_column('alert_token')
        batch.drop_column('alert_sent_at')
        batch.drop_column('alert')
