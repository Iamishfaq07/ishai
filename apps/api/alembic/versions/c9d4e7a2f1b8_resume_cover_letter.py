"""resumes.cover_letter: the cover letter written for a resume and its job post

Revision ID: c9d4e7a2f1b8
Revises: b8e4f2a6c3d1
Create Date: 2026-09-30 06:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c9d4e7a2f1b8'
down_revision: str | Sequence[str] | None = 'b8e4f2a6c3d1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('resumes', sa.Column('cover_letter', sa.Text(), nullable=False, server_default=''))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('resumes') as batch:
        batch.drop_column('cover_letter')
