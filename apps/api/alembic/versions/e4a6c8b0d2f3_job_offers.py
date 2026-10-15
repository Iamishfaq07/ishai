"""job_offers: Offer AI's offers (pay a year, the take-home settings, the negotiation plan)

Revision ID: e4a6c8b0d2f3
Revises: d3f5b7c9e1a2
Create Date: 2026-10-15 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e4a6c8b0d2f3'
down_revision: str | Sequence[str] | None = 'd3f5b7c9e1a2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'job_offers',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('company', sa.String(length=200), nullable=False),
        sa.Column('role', sa.String(length=200), nullable=False),
        sa.Column('city', sa.String(length=120), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('fixed', sa.Integer(), nullable=False),
        sa.Column('variable', sa.Integer(), nullable=False),
        sa.Column('joining_bonus', sa.Integer(), nullable=False),
        sa.Column('equity_per_year', sa.Integer(), nullable=False),
        sa.Column('other', sa.Integer(), nullable=False),
        sa.Column('pf', sa.String(length=8), nullable=False),
        sa.Column('employer_costs_in_ctc', sa.Boolean(), nullable=False),
        sa.Column('deadline', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=12), nullable=False),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('plan', sa.JSON(), nullable=True),
        sa.Column('plan_hash', sa.String(length=64), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_job_offers_user_id', 'job_offers', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_job_offers_user_id', table_name='job_offers')
    op.drop_table('job_offers')
