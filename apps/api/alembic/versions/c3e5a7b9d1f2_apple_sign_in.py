"""Sign in with Apple (the iOS app): Apple's stable account id.

Revision ID: c3e5a7b9d1f2
Revises: b8d2f4a6c1e3
"""
import sqlalchemy as sa

from alembic import op

revision = "c3e5a7b9d1f2"
down_revision = "b8d2f4a6c1e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("apple_sub", sa.String(255), nullable=True))
    op.create_index("ix_users_apple_sub", "users", ["apple_sub"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_apple_sub", table_name="users")
    op.drop_column("users", "apple_sub")
