"""Opt-in hosted form agent and bounded decision history.

Revision ID: 91bd47e8c2a0
Revises: 7fc84a231d90
"""
import sqlalchemy as sa

from alembic import op

revision = "91bd47e8c2a0"
down_revision = "7fc84a231d90"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("auto_apply_setups", sa.Column("agent_mode", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("application_packets", sa.Column("agent_decisions", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("application_packets", "agent_decisions")
    op.drop_column("auto_apply_setups", "agent_mode")
