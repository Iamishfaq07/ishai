"""Opt-in Business hiring-capacity monitoring."""

import sqlalchemy as sa

from alembic import op

revision = "f1b5c9e3a726"
down_revision = "f0a4b8d2e615"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "biz_capacity_watches",
        sa.Column(
            "requisition_id", sa.String(36), sa.ForeignKey("biz_requisitions.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("owner_id", sa.String(36)),
        sa.Column("episode_key", sa.String(64)),
        sa.Column("notified_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_biz_capacity_watch_company_enabled", "biz_capacity_watches", ["company_id", "enabled"])


def downgrade() -> None:
    op.drop_table("biz_capacity_watches")
