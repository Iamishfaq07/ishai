"""Explicit, content-bound Business policy reading receipts."""

import sqlalchemy as sa

from alembic import op

revision = "ef93a6c7d041"
down_revision = "de82f4b5c930"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "biz_knowledge_receipts",
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("biz_knowledge_documents.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column("published_revision", sa.Integer(), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("biz_knowledge_receipts")
