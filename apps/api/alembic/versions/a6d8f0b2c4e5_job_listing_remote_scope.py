"""job listings worldwide: who a remote post is open to

Jobs AI keeps posts from every country now, and each user's feed shows the ones in the country they apply in, or
remote and open to it. Adds `job_listings.remote_scope` (JSON, nullable): a remote post's country codes, regions
("EMEA") or "*" for anywhere. `country` now holds any country, not only "IN". Listings cached before this have no
scope; they're refreshed within a day, and until then a remote one counts as open to India (as it was read).

Revision ID: a6d8f0b2c4e5
Revises: f5c7e9a1b3d4
Create Date: 2026-10-12 08:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a6d8f0b2c4e5'
down_revision: str | Sequence[str] | None = 'f5c7e9a1b3d4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('job_listings') as batch:
        batch.add_column(sa.Column('remote_scope', sa.JSON(), nullable=True))
    op.create_index('ix_job_listings_country', 'job_listings', ['country'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_job_listings_country', table_name='job_listings')
    with op.batch_alter_table('job_listings') as batch:
        batch.drop_column('remote_scope')
