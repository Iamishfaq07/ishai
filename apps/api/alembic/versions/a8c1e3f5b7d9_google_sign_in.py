"""Google sign-in: a stable Google account id, and whether a password was ever set.

Revision ID: a8c1e3f5b7d9
Revises: b1c2d3e4f5a6
Create Date: 2026-10-13 13:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a8c1e3f5b7d9"
down_revision: str | Sequence[str] | None = "b1c2d3e4f5a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("has_password", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("users", sa.Column("google_sub", sa.String(255), nullable=True))
    op.create_index("ix_users_google_sub", "users", ["google_sub"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_google_sub", table_name="users")
    op.drop_column("users", "google_sub")
    op.drop_column("users", "has_password")
