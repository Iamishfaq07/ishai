"""Optional personal follow-up playbooks.

Revision ID: 82ac6d705f91
Revises: 7fc84a231d90
"""
import sqlalchemy as sa

from alembic import op

revision = "82ac6d705f91"
down_revision = "7fc84a231d90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("career_playbooks",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("follow_up_days", sa.Integer(), nullable=True),
        sa.Column("prep_hours", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))


def downgrade() -> None:
    op.drop_table("career_playbooks")
