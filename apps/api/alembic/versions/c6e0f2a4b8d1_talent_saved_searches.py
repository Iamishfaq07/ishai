"""Bounded shared talent search criteria without candidate snapshots."""

import sqlalchemy as sa

from alembic import op

revision = "c6e0f2a4b8d1"
down_revision = "b5d9e1f3a7c0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "biz_talent_searches",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pool_id", sa.String(36), sa.ForeignKey("biz_talent_pools.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("query", sa.String(80), nullable=False),
        sa.Column("terms_revision", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("request_sha256", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_biz_talent_searches_company_id", "biz_talent_searches", ["company_id"])
    op.create_index("ix_biz_talent_searches_pool_id", "biz_talent_searches", ["pool_id"])


def downgrade() -> None:
    op.drop_table("biz_talent_searches")
