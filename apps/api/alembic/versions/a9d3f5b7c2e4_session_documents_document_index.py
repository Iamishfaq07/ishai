"""session_documents.document_id index: deleting a document cascades here (one scan per delete without it)

Revision ID: a9d3f5b7c2e4
Revises: f8c2d4e6a1b3
Create Date: 2026-10-02 21:00:00.000000

"""
from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a9d3f5b7c2e4'
down_revision: str | Sequence[str] | None = 'f8c2d4e6a1b3'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('session_documents', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_session_documents_document_id'), ['document_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('session_documents', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_session_documents_document_id'))
