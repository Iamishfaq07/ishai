"""admin console: suspended accounts, private admin notes, a reason on each adjustment by hand, longer audit targets

- users.suspended_at / suspended_reason: a suspended account can't sign in or use the API (auth/security.py).
- users.admin_note: the admin's private notes on the account.
- credit_entries.note: the admin's own words for an adjustment ("refund for a dropped call"), so the account's history
  explains every credit added or removed by hand.
- audit_logs.target 128 -> 400: an admin action on an account records the account's id and email (up to 320), so the
  entry still says who it was after the account is deleted. Widening a varchar is a catalog-only change on Postgres
  (no table rewrite). SQLite doesn't enforce VARCHAR lengths, so it's left as it is there.
- ix_audit_logs_created_at: the audit log page reads the newest entries first.

All new columns are nullable with no default: adding them is instant on Postgres and existing rows are unchanged.

Revision ID: f3a9c1e7b5d4
Revises: e9b4c6a2d8f1
Create Date: 2026-10-07 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f3a9c1e7b5d4'
down_revision: str | Sequence[str] | None = 'e9b4c6a2d8f1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('suspended_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('users', sa.Column('suspended_reason', sa.String(length=300), nullable=True))
    op.add_column('users', sa.Column('admin_note', sa.Text(), nullable=True))
    op.add_column('credit_entries', sa.Column('note', sa.String(length=300), nullable=True))
    if op.get_bind().dialect.name == 'postgresql':
        op.alter_column('audit_logs', 'target', existing_type=sa.String(length=128), type_=sa.String(length=400),
                        existing_nullable=True)
    op.create_index('ix_audit_logs_created_at', 'audit_logs', ['created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_audit_logs_created_at', table_name='audit_logs')
    if op.get_bind().dialect.name == 'postgresql':
        op.alter_column('audit_logs', 'target', existing_type=sa.String(length=400), type_=sa.String(length=128),
                        existing_nullable=True, postgresql_using='left(target, 128)')
    # Plain DROP COLUMN (SQLite has it since 3.35): none of these columns is indexed, and rebuilding credit_entries in
    # batch mode could lose its partial unique index's WHERE clause.
    op.drop_column('credit_entries', 'note')
    op.drop_column('users', 'admin_note')
    op.drop_column('users', 'suspended_reason')
    op.drop_column('users', 'suspended_at')
