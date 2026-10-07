"""contact messages: the Contact page's messages, waiting in the admin console's Inbox

One new table, `contact_messages` (orbit_api/contact, admin/inbox.py): who sent it (name, email, an optional phone or
WhatsApp number, and the account when they were signed in, SET NULL so deleting the account keeps the message), the
topic, the message, a small JSON context (a reported job, the page it came from), the Inbox status (new | open | done
| spam) with when it was read and handled, the admin's note and replies, and a keyed hash of the sender's network for
rate limits (never the address). Nothing existing changes.

Revision ID: b5d7e9f1a3c6
Revises: f3a9c1e7b5d4
Create Date: 2026-10-08 09:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b5d7e9f1a3c6'
down_revision: str | Sequence[str] | None = 'f3a9c1e7b5d4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'contact_messages',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=True),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('phone', sa.String(length=32), nullable=True),
        sa.Column('topic', sa.String(length=24), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('context', sa.JSON(none_as_null=True), nullable=True),
        sa.Column('status', sa.String(length=8), nullable=False),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('handled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('admin_note', sa.Text(), nullable=True),
        sa.Column('replies', sa.JSON(none_as_null=True), nullable=True),
        sa.Column('network_hash', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_contact_messages_user_id', 'contact_messages', ['user_id'])
    op.create_index('ix_contact_messages_status_created', 'contact_messages', ['status', 'created_at'])
    op.create_index('ix_contact_messages_network_created', 'contact_messages', ['network_hash', 'created_at'])
    op.create_index('ix_contact_messages_created_at', 'contact_messages', ['created_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_contact_messages_created_at', table_name='contact_messages')
    op.drop_index('ix_contact_messages_network_created', table_name='contact_messages')
    op.drop_index('ix_contact_messages_status_created', table_name='contact_messages')
    op.drop_index('ix_contact_messages_user_id', table_name='contact_messages')
    op.drop_table('contact_messages')
