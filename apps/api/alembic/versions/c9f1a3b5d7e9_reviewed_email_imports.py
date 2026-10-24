"""Reviewed email-file provenance and account-scoped duplicate prevention.

Revision ID: c9f1a3b5d7e9
Revises: b8e0f2a4c6d8
"""
import sqlalchemy as sa

from alembic import op

revision = "c9f1a3b5d7e9"
down_revision = "b8e0f2a4c6d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("employer_message_imports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("application_id", sa.String(36), sa.ForeignKey("job_applications.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("source_key", sa.String(64), nullable=False),
        sa.Column("body_digest", sa.String(64), nullable=False),
        sa.Column("sender", sa.String(300), nullable=False),
        sa.Column("subject", sa.String(300), nullable=False),
        sa.Column("sent_at", sa.String(120), nullable=False),
        sa.Column("changes", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "source_key", name="uq_employer_import_owner_source"))
    op.create_index("ix_employer_message_imports_user_id", "employer_message_imports", ["user_id"])
    op.create_index("ix_employer_message_imports_application_id", "employer_message_imports", ["application_id"])


def downgrade() -> None:
    op.drop_table("employer_message_imports")
