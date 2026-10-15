"""job_listings.visa and .relocation: what a post says about visa sponsorship and relocation help

Revision ID: c2e4a6b8d0f1
Revises: b1d3f5a7c9e2
Create Date: 2026-10-15 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c2e4a6b8d0f1'
down_revision: str | Sequence[str] | None = 'b1d3f5a7c9e2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('job_listings', sa.Column('visa', sa.String(length=12), nullable=True))
    op.add_column('job_listings', sa.Column('relocation', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('job_listings', 'relocation')
    op.drop_column('job_listings', 'visa')
