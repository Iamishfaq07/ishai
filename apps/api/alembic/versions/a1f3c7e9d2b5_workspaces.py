"""workspaces (saved interview setups) + sessions.workspace_id

Revision ID: a1f3c7e9d2b5
Revises: 9d5e2f8a1b47
Create Date: 2026-09-25 10:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1f3c7e9d2b5'
down_revision: str | Sequence[str] | None = '9d5e2f8a1b47'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'workspaces',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('company', sa.String(length=200), nullable=True),
        sa.Column('role', sa.String(length=300), nullable=True),
        sa.Column('session_type', sa.String(length=32), nullable=False),
        sa.Column('language', sa.String(length=16), nullable=False),
        sa.Column('answer_language', sa.String(length=16), nullable=True),
        sa.Column('length', sa.String(length=16), nullable=False),
        sa.Column('style', sa.String(length=16), nullable=False),
        sa.Column('auto_answer', sa.Boolean(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_workspaces_user_id', 'workspaces', ['user_id'])
    op.create_table(
        'workspace_documents',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('document_id', sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', 'document_id', name='uq_workspace_document'),
    )
    op.create_index('ix_workspace_documents_workspace_id', 'workspace_documents', ['workspace_id'])
    op.create_index('ix_workspace_documents_document_id', 'workspace_documents', ['document_id'])
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.add_column(sa.Column('workspace_id', sa.String(length=36), nullable=True))
        batch_op.create_index('ix_sessions_workspace_id', ['workspace_id'])
        batch_op.create_foreign_key('fk_sessions_workspace_id', 'workspaces', ['workspace_id'], ['id'],
                                    ondelete='SET NULL')


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('sessions', schema=None) as batch_op:
        batch_op.drop_constraint('fk_sessions_workspace_id', type_='foreignkey')
        batch_op.drop_index('ix_sessions_workspace_id')
        batch_op.drop_column('workspace_id')
    op.drop_index('ix_workspace_documents_document_id', table_name='workspace_documents')
    op.drop_index('ix_workspace_documents_workspace_id', table_name='workspace_documents')
    op.drop_table('workspace_documents')
    op.drop_index('ix_workspaces_user_id', table_name='workspaces')
    op.drop_table('workspaces')
