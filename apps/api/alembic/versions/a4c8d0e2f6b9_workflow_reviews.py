"""Independent human review rounds for optional workflow checkpoints."""

import sqlalchemy as sa

from alembic import op

revision = "a4c8d0e2f6b9"
down_revision = "f2b6c8d0e5a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "biz_workflow_reviews",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("biz_workflow_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_id", sa.String(40), nullable=False),
        sa.Column("requester_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("reviewer_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("request_sha256", sa.String(64), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("request_note", sa.String(1200), nullable=False),
        sa.Column("response_note", sa.String(1200), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("invalidated_at", sa.DateTime(timezone=True)),
        sa.Column("invalidation_reason", sa.String(80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    for col in ("company_id", "run_id"):
        op.create_index(f"ix_biz_workflow_reviews_{col}", "biz_workflow_reviews", [col])
    op.create_index(
        "ix_biz_workflow_reviews_inbox", "biz_workflow_reviews", ["company_id", "reviewer_id", "status", "created_at"]
    )


def downgrade() -> None:
    op.drop_table("biz_workflow_reviews")
