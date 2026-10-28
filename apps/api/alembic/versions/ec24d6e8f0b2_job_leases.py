"""Fence background job ownership and serialize superseding payloads."""
import sqlalchemy as sa

from alembic import op

revision = "ec24d6e8f0b2"
down_revision = "f2a4b6c8d0e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("jobs", sa.Column("lease_token", sa.String(36), nullable=True))
    op.add_column("jobs", sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("jobs", sa.Column("rerun_requested", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("jobs", "rerun_requested")
    op.drop_column("jobs", "lease_until")
    op.drop_column("jobs", "lease_token")
