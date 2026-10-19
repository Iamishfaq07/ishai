"""Hosted personal Orbit Apply execution and durable submission fencing."""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "47b9e3d0a6f2"
down_revision: str | Sequence[str] | None = "36a8f2c9d7e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("auto_apply_setups", sa.Column("execution", sa.String(12), nullable=False, server_default="browser"))
    op.add_column("auto_apply_setups", sa.Column("hosted_consent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("auto_apply_setups", sa.Column("hosted_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("auto_apply_setups", sa.Column("stop_when_hired", sa.Boolean(), nullable=False,
                                              server_default=sa.true()))
    op.add_column("auto_apply_setups", sa.Column("campaign_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("application_packets", sa.Column("submission_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("application_packets", sa.Column("hosted_token", sa.String(64), nullable=True))
    op.add_column("application_packets", sa.Column("approval_fingerprint", sa.String(64), nullable=True))
    op.create_table("apply_worker_heartbeats", sa.Column("worker_id", sa.String(64), primary_key=True),
                    sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_apply_worker_heartbeats_seen_at", "apply_worker_heartbeats", ["seen_at"])


def downgrade() -> None:
    op.drop_table("apply_worker_heartbeats")
    op.drop_column("application_packets", "hosted_token")
    op.drop_column("application_packets", "approval_fingerprint")
    op.drop_column("application_packets", "submission_started_at")
    op.drop_column("auto_apply_setups", "hosted_seen_at")
    op.drop_column("auto_apply_setups", "campaign_started_at")
    op.drop_column("auto_apply_setups", "stop_when_hired")
    op.drop_column("auto_apply_setups", "hosted_consent_at")
    op.drop_column("auto_apply_setups", "execution")
