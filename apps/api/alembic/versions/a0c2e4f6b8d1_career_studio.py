"""Durable job preparation and debrief retries.

Revision ID: a0c2e4f6b8d1
Revises: f8b0d2e4a6c8
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a0c2e4f6b8d1"
down_revision: str | Sequence[str] | None = "f8b0d2e4a6c8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("resumes") as batch:
        batch.add_column(sa.Column("prep_context", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("pending_suggestions", sa.JSON(), nullable=True))
    op.create_table("career_preparations",
                    sa.Column("id", sa.String(36), primary_key=True),
                    sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
                    sa.Column("listing_id", sa.String(36), nullable=False),
                    sa.Column("source_resume_id", sa.String(36), sa.ForeignKey("resumes.id", ondelete="CASCADE"),
                              nullable=False), sa.Column("source_revision", sa.Integer(), nullable=False),
                    sa.Column("resume_id", sa.String(36), sa.ForeignKey("resumes.id", ondelete="SET NULL")),
                    sa.Column("document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="SET NULL")),
                    sa.Column("resume_document_id", sa.String(36), sa.ForeignKey("documents.id", ondelete="SET NULL")),
                    sa.Column("status", sa.String(12), nullable=False), sa.Column("context", sa.JSON()),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
                    sa.UniqueConstraint("user_id", "listing_id", "source_resume_id", "source_revision",
                                        name="uq_career_preparation_source"))
    op.create_index("ix_career_preparations_user_id", "career_preparations", ["user_id"])
    op.create_table("debrief_attempts", sa.Column("id", sa.String(36), primary_key=True),
                    sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
                    sa.Column("question_id", sa.String(36), sa.ForeignKey("questions.id", ondelete="CASCADE"),
                              nullable=False), sa.Column("answer", sa.Text(), nullable=False),
                    sa.Column("result", sa.JSON(), nullable=False),
                    sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_debrief_attempts_user_id", "debrief_attempts", ["user_id"])
    op.create_index("ix_debrief_attempts_question_id", "debrief_attempts", ["question_id"])


def downgrade() -> None:
    op.drop_table("debrief_attempts")
    op.drop_table("career_preparations")
    with op.batch_alter_table("resumes") as batch:
        batch.drop_column("pending_suggestions")
        batch.drop_column("prep_context")
