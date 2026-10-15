"""evidence_items: the Career Evidence Vault (claims about the candidate's work, with their source)

Revision ID: b1d3f5a7c9e2
Revises: a0c2e4f6b8d1
Create Date: 2026-10-15 08:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

import orbit_api.db
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b1d3f5a7c9e2'
down_revision: str | Sequence[str] | None = 'a0c2e4f6b8d1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'evidence_items',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('claim', sa.String(length=300), nullable=False),
        sa.Column('quote', sa.Text(), nullable=False),
        sa.Column('source_kind', sa.String(length=16), nullable=False),
        sa.Column('source_id', sa.String(length=36), nullable=True),
        sa.Column('source_title', sa.String(length=160), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('embedding', orbit_api.db.EmbeddingType(), nullable=True),
        sa.Column('embedding_model', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_evidence_items_user_id', 'evidence_items', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_evidence_items_user_id', table_name='evidence_items')
    op.drop_table('evidence_items')
