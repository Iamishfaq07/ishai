"""Business requisition requests, sequential approvals and retained decision history."""

import sqlalchemy as sa

from alembic import op

revision = "be39d8a2f710"
down_revision = "ad418a8cecb0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "biz_requisitions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("requester_id", sa.String(36), nullable=False),
        sa.Column("state", sa.String(16), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("approvers", sa.JSON(), nullable=False),
        sa.Column("approved_by", sa.JSON(), nullable=False),
        sa.Column("job_id", sa.String(36), sa.ForeignKey("biz_jobs.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_biz_requisitions_company_created", "biz_requisitions", ["company_id", "created_at", "id"])
    op.create_table(
        "biz_requisition_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "requisition_id", sa.String(36), sa.ForeignKey("biz_requisitions.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("actor_id", sa.String(36), nullable=False),
        sa.Column("actor_name", sa.String(200), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("snapshot", sa.JSON()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_biz_requisition_events_request_revision", "biz_requisition_events", ["requisition_id", "revision"]
    )


def downgrade() -> None:
    op.drop_table("biz_requisition_events")
    op.drop_table("biz_requisitions")
