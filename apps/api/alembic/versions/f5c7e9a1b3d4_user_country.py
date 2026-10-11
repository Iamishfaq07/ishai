"""user country: the country the user is applying for jobs in

Adds `users.country` (ISO 3166-1 alpha-2, nullable): it sets the currency, sample salaries, job search and wording
the user sees (orbit_api/region.py). Existing accounts start with none and get one from their browser on next use.

Revision ID: f5c7e9a1b3d4
Revises: e4b6d8f0a2c3
Create Date: 2026-10-11 22:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f5c7e9a1b3d4'
down_revision: str | Sequence[str] | None = 'e4b6d8f0a2c3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('country', sa.String(length=2), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('users') as batch:
        batch.drop_column('country')
