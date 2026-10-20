"""Keep the posting used to prepare each application.

Revision ID: 7fc84a231d90
Revises: 69db05a3e8f4
"""
import sqlalchemy as sa

from alembic import op

revision = "7fc84a231d90"
down_revision = "69db05a3e8f4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Legacy packets have no archive. Never backfill them with a newer posting and imply it was the original.
    op.add_column("application_packets", sa.Column("posting_text", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("application_packets", "posting_text")
