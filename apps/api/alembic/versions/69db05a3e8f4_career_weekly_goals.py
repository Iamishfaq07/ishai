"""Persistent personal career targets.

Revision ID: 69db05a3e8f4
Revises: 58ca94f2d7e3
"""
import sqlalchemy as sa

from alembic import op

revision = "69db05a3e8f4"
down_revision = "58ca94f2d7e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("career_weekly_goals",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("applications", sa.Integer(), nullable=False),
        sa.Column("practice", sa.Integer(), nullable=False),
        sa.Column("contacts", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))


def downgrade() -> None:
    op.drop_table("career_weekly_goals")
