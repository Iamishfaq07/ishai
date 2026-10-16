"""payments.currency and payments.amount_minor: prices in US dollars outside India

Revision ID: b4d6f8a0c2e4
Revises: a3c5e7f9b1d3
Create Date: 2026-10-16 23:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'b4d6f8a0c2e4'
down_revision: str | Sequence[str] | None = 'a3c5e7f9b1d3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('payments') as batch:
        batch.add_column(sa.Column('currency', sa.String(length=3), nullable=False, server_default='INR'))
        batch.add_column(sa.Column('amount_minor', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('payments') as batch:
        batch.drop_column('amount_minor')
        batch.drop_column('currency')
