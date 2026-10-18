"""Hiring loop: a rejection reason on each application, and an interview kit on each job.

Revision ID: a1c3e5b7d9f2
Revises: 25f71d009e96
Create Date: 2026-10-19 04:20:00.000000

Additive. Existing rows get a null reason and an empty kit.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a1c3e5b7d9f2"
down_revision: str | Sequence[str] | None = "25f71d009e96"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("biz_applications") as batch:
        batch.add_column(sa.Column("rejection_reason", sa.String(length=32), nullable=True))
    with op.batch_alter_table("biz_jobs") as batch:
        batch.add_column(sa.Column("interview_kit", sa.JSON(), server_default="[]", nullable=False))


def downgrade() -> None:
    with op.batch_alter_table("biz_jobs") as batch:
        batch.drop_column("interview_kit")
    with op.batch_alter_table("biz_applications") as batch:
        batch.drop_column("rejection_reason")
