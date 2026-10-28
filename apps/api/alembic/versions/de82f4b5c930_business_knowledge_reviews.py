"""Business knowledge review ownership, decisions and opt-in internal reminders."""

import sqlalchemy as sa

from alembic import op

revision = "de82f4b5c930"
down_revision = "cd71e3a4b820"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in (
        sa.Column("review_owner_id", sa.String(36), nullable=True),
        sa.Column("review_reminders", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("review_needs_update", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("review_reminder_key", sa.String(64), nullable=True),
        sa.Column("review_reminded_at", sa.DateTime(timezone=True), nullable=True),
    ):
        op.add_column("biz_knowledge_documents", column)
    op.create_index(
        "ix_biz_knowledge_review_sweep", "biz_knowledge_documents", ["review_reminders", "archived", "company_id"]
    )
    op.execute(
        sa.text("""UPDATE biz_knowledge_documents SET review_owner_id = created_by
        WHERE EXISTS (SELECT 1 FROM biz_members m JOIN users u ON u.id = m.user_id
                      WHERE m.company_id = biz_knowledge_documents.company_id
                      AND m.user_id = biz_knowledge_documents.created_by
                      AND m.role IN ('owner', 'admin') AND u.suspended_at IS NULL)""")
    )


def downgrade() -> None:
    op.drop_index("ix_biz_knowledge_review_sweep", table_name="biz_knowledge_documents")
    for name in (
        "review_reminded_at",
        "review_reminder_key",
        "review_needs_update",
        "review_reminders",
        "review_owner_id",
    ):
        op.drop_column("biz_knowledge_documents", name)
