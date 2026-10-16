"""user_passkeys + passkey_challenges: sign in with a passkey (WebAuthn public keys, single-use challenges)

Revision ID: f2b4d6e8a0c2
Revises: e1a3c5e7f9b1
Create Date: 2026-10-16 20:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f2b4d6e8a0c2'
down_revision: str | Sequence[str] | None = 'e1a3c5e7f9b1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'user_passkeys',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('credential_id', sa.String(length=1400), nullable=False),
        sa.Column('public_key', sa.LargeBinary(), nullable=False),
        sa.Column('sign_count', sa.BigInteger(), nullable=False),
        sa.Column('transports', sa.JSON(), nullable=True),
        sa.Column('name', sa.String(length=60), nullable=False),
        sa.Column('backed_up', sa.Boolean(), nullable=False),
        sa.Column('last_used_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('credential_id'),
    )
    op.create_index(op.f('ix_user_passkeys_user_id'), 'user_passkeys', ['user_id'], unique=False)
    op.create_table(
        'passkey_challenges',
        sa.Column('challenge_hash', sa.String(length=64), nullable=False),
        sa.Column('purpose', sa.String(length=16), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('challenge_hash'),
    )
    op.create_index(op.f('ix_passkey_challenges_user_id'), 'passkey_challenges', ['user_id'], unique=False)
    op.create_index(op.f('ix_passkey_challenges_expires_at'), 'passkey_challenges', ['expires_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema (every passkey stops working; passwords and Google still sign in)."""
    op.drop_index(op.f('ix_passkey_challenges_expires_at'), table_name='passkey_challenges')
    op.drop_index(op.f('ix_passkey_challenges_user_id'), table_name='passkey_challenges')
    op.drop_table('passkey_challenges')
    op.drop_index(op.f('ix_user_passkeys_user_id'), table_name='user_passkeys')
    op.drop_table('user_passkeys')
