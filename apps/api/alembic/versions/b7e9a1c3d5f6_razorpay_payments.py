"""razorpay payments: credit packs bought through Razorpay's checkout

Adds to `payments`: `method` ("upi", as every payment so far was, or "razorpay"), and Razorpay's `gateway_order_id`
and `gateway_payment_id` (both unique, so one Razorpay payment is credited once). Nothing existing changes.

Revision ID: b7e9a1c3d5f6
Revises: a6d8f0b2c4e5
Create Date: 2026-10-12 10:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b7e9a1c3d5f6'
down_revision: str | Sequence[str] | None = 'a6d8f0b2c4e5'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('payments') as batch:
        batch.add_column(sa.Column('method', sa.String(length=16), nullable=False, server_default='upi'))
        batch.add_column(sa.Column('gateway_order_id', sa.String(length=40), nullable=True))
        batch.add_column(sa.Column('gateway_payment_id', sa.String(length=40), nullable=True))
        batch.create_unique_constraint('uq_payments_gateway_order_id', ['gateway_order_id'])
        batch.create_unique_constraint('uq_payments_gateway_payment_id', ['gateway_payment_id'])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('payments') as batch:
        batch.drop_constraint('uq_payments_gateway_payment_id', type_='unique')
        batch.drop_constraint('uq_payments_gateway_order_id', type_='unique')
        batch.drop_column('gateway_payment_id')
        batch.drop_column('gateway_order_id')
        batch.drop_column('method')
