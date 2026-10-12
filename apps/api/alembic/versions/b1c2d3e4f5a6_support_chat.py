"""Support chat: a bot thread a person can take over.

Revision ID: b1c2d3e4f5a6
Revises: b7e9a1c3d5f6
Create Date: 2026-10-12 04:40:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b1c2d3e4f5a6"
down_revision: str | Sequence[str] | None = "b7e9a1c3d5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "support_threads",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("name", sa.String(120), nullable=False, server_default=""),
        sa.Column("email", sa.String(320), nullable=False, server_default=""),
        sa.Column("status", sa.String(16), nullable=False, server_default="bot"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_support_threads_user_id", "support_threads", ["user_id"])
    op.create_index("ix_support_threads_status_updated", "support_threads", ["status", "updated_at"])
    op.create_table(
        "support_messages",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("thread_id", sa.String(36), sa.ForeignKey("support_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(8), nullable=False),
        sa.Column("text", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_support_messages_thread_id", "support_messages", ["thread_id"])
    op.create_index("ix_support_messages_thread_created", "support_messages", ["thread_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_support_messages_thread_created", table_name="support_messages")
    op.drop_index("ix_support_messages_thread_id", table_name="support_messages")
    op.drop_table("support_messages")
    op.drop_index("ix_support_threads_status_updated", table_name="support_threads")
    op.drop_index("ix_support_threads_user_id", table_name="support_threads")
    op.drop_table("support_threads")
