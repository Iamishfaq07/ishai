"""referral_codes, referrals, payments.referral_code_id/discount_minor: invite links, creator and campus codes

Revision ID: 467956f519dd
Revises: c6e8a0b2d4f6
Create Date: 2026-10-18 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '467956f519dd'
down_revision: str | Sequence[str] | None = 'c6e8a0b2d4f6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'referral_codes',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('code', sa.String(length=32), nullable=False),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('owner_user_id', sa.String(length=36), nullable=True),
        sa.Column('label', sa.String(length=120), nullable=True),
        sa.Column('discount_percent', sa.Integer(), nullable=True),
        sa.Column('commission_percent', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('max_uses', sa.Integer(), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code'),
        sa.UniqueConstraint('owner_user_id'),
    )
    op.create_table(
        'referrals',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('code_id', sa.String(length=36), nullable=True),
        sa.Column('kind', sa.String(length=10), nullable=False),
        sa.Column('referrer_user_id', sa.String(length=36), nullable=True),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('reason', sa.String(length=20), nullable=True),
        sa.Column('via', sa.String(length=10), nullable=False),
        sa.Column('email_hash', sa.String(length=64), nullable=False),
        sa.Column('ip_hash', sa.String(length=64), nullable=True),
        sa.Column('first_payment_id', sa.String(length=36), nullable=True),
        sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reward_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('clawed_back_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('clawback_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('flag', sa.String(length=200), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['code_id'], ['referral_codes.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id'),
        sa.UniqueConstraint('first_payment_id'),
    )
    op.create_index('ix_referrals_code_id', 'referrals', ['code_id'])
    op.create_index('ix_referrals_email_hash', 'referrals', ['email_hash'])
    op.create_index('ix_referrals_referrer_status_paid', 'referrals', ['referrer_user_id', 'status', 'paid_at'])
    with op.batch_alter_table('payments') as batch:
        batch.add_column(sa.Column('referral_code_id', sa.String(length=36), nullable=True))
        batch.add_column(sa.Column('discount_minor', sa.Integer(), nullable=True))
        batch.create_index('ix_payments_referral_code_id', ['referral_code_id'])


def downgrade() -> None:
    with op.batch_alter_table('payments') as batch:
        batch.drop_index('ix_payments_referral_code_id')
        batch.drop_column('discount_minor')
        batch.drop_column('referral_code_id')
    op.drop_index('ix_referrals_referrer_status_paid', table_name='referrals')
    op.drop_index('ix_referrals_email_hash', table_name='referrals')
    op.drop_index('ix_referrals_code_id', table_name='referrals')
    op.drop_table('referrals')
    op.drop_table('referral_codes')
