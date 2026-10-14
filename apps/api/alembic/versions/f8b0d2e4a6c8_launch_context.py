"""Persist prep context and protect cancelled resume writes.

Revision ID: f8b0d2e4a6c8
Revises: e7a9c1d3f5b6
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "f8b0d2e4a6c8"
down_revision: str | Sequence[str] | None = "e7a9c1d3f5b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table("launch_access_claims",
                    sa.Column("id", sa.String(36), primary_key=True),
                    sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"),
                              nullable=False, unique=True),
                    sa.Column("contact_id", sa.String(36), sa.ForeignKey("contact_messages.id", ondelete="CASCADE"),
                              nullable=False),
                    sa.Column("country", sa.String(2), nullable=False),
                    sa.Column("pack", sa.String(32), nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    with op.batch_alter_table("resumes") as batch:
        batch.add_column(sa.Column("last_client_id", sa.String(64), nullable=True))
        batch.add_column(sa.Column("client_revision", sa.Integer(), nullable=False, server_default="0"))
    with op.batch_alter_table("sessions") as batch:
        batch.add_column(sa.Column("company", sa.String(120), nullable=True))
        batch.add_column(sa.Column("interview_stage", sa.String(80), nullable=True))
        batch.add_column(sa.Column("tech_stack", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("key_requirements", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_table("launch_access_claims")
    with op.batch_alter_table("sessions") as batch:
        for name in ("key_requirements", "tech_stack", "interview_stage", "company"):
            batch.drop_column(name)
    with op.batch_alter_table("resumes") as batch:
        batch.drop_column("client_revision")
        batch.drop_column("last_client_id")
