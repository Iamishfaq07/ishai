"""The opt-in weekly tips and offers email: who chose it, and its stop link."""

import sqlalchemy as sa

from alembic import op

revision = "b8d2f4a6c1e3"
down_revision = "f1b5c9e3a726"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "newsletter_choices",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("subscribed", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("token", sa.String(64), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_newsletter_choices_token", "newsletter_choices", ["token"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_newsletter_choices_token", table_name="newsletter_choices")
    op.drop_table("newsletter_choices")
