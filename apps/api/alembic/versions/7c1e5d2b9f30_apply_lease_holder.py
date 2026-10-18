"""Orbit Apply: application_packets.lease_holder, the device a packet is leased to (a repeated GET /v1/apply/next
from it returns the same packet)

Revision ID: 7c1e5d2b9f30
Revises: 4a93a7c927ef
Create Date: 2026-10-19 18:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '7c1e5d2b9f30'
down_revision: str | Sequence[str] | None = '4a93a7c927ef'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """One nullable column: nothing existing changes."""
    with op.batch_alter_table('application_packets') as batch:
        batch.add_column(sa.Column('lease_holder', sa.String(64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('application_packets') as batch:
        batch.drop_column('lease_holder')
