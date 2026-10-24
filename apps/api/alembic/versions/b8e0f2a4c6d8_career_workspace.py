"""Career workspaces, stage history, reviewer excerpts and posting versions.

Revision ID: b8e0f2a4c6d8
Revises: a7d9f1b3c5e8
"""
import sqlalchemy as sa

from alembic import op

revision = "b8e0f2a4c6d8"
down_revision = "a7d9f1b3c5e8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("career_workspace_states",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("kind", sa.String(24), primary_key=True),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))

    op.create_table("application_stage_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("application_id", sa.String(36), sa.ForeignKey("job_applications.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("from_status", sa.String(16)),
        sa.Column("to_status", sa.String(16), nullable=False),
        sa.Column("source", sa.String(24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_application_stage_events_user_id", "application_stage_events", ["user_id"])
    op.create_index("ix_application_stage_events_application_id", "application_stage_events", ["application_id"])

    op.create_table("career_evidence_shares",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_career_evidence_shares_user_id", "career_evidence_shares", ["user_id"])

    op.create_table("job_posting_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("listing_id", sa.String(36), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False))
    op.create_index("ix_job_posting_versions_listing_id", "job_posting_versions", ["listing_id"])


def downgrade() -> None:
    op.drop_table("job_posting_versions")
    op.drop_table("career_evidence_shares")
    op.drop_table("application_stage_events")
    op.drop_table("career_workspace_states")
