"""sessions.camera_metrics: the mock interview camera coach's on-device numbers (no video, no images)

Revision ID: a3c5e7f9b1d3
Revises: f2b4d6e8a0c2
Create Date: 2026-10-16 21:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a3c5e7f9b1d3'
down_revision: str | Sequence[str] | None = 'f2b4d6e8a0c2'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('sessions') as batch:
        batch.add_column(sa.Column('camera_metrics', sa.JSON(none_as_null=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema (the camera coach's numbers are dropped)."""
    with op.batch_alter_table('sessions') as batch:
        batch.drop_column('camera_metrics')
