"""document_chunks.embedding_model: which embedder produced each vector (hybrid retrieval)

Revision ID: c3e8a1d5f7b2
Revises: b7d2e4f6a8c1
"""

import sqlalchemy as sa

from alembic import op

revision = "c3e8a1d5f7b2"
down_revision = "b7d2e4f6a8c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NULL = vectors from the original hashing embedder (full text incl. heading); re-embedded lazily on load.
    op.add_column("document_chunks", sa.Column("embedding_model", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("document_chunks", "embedding_model")
