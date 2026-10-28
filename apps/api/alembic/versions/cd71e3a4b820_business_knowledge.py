"""Business knowledge drafts and published policy/playbook versions."""

import sqlalchemy as sa

from alembic import op

revision = "cd71e3a4b820"
down_revision = "be39d8a2f710"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "biz_knowledge_documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("company_id", sa.String(36), sa.ForeignKey("biz_companies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_by", sa.String(36), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("draft", sa.JSON(), nullable=False),
        sa.Column("published", sa.JSON()),
        sa.Column("published_revision", sa.Integer()),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_biz_knowledge_company_updated", "biz_knowledge_documents", ["company_id", "updated_at", "id"])
    op.create_table(
        "biz_knowledge_publications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("biz_knowledge_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("actor_name", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("document_id", "revision", name="uq_biz_knowledge_publication_revision"),
    )
    op.create_index("ix_biz_knowledge_publications_document_id", "biz_knowledge_publications", ["document_id"])

    op.create_table(
        "biz_knowledge_events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "document_id",
            sa.String(36),
            sa.ForeignKey("biz_knowledge_documents.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("actor_name", sa.String(200), nullable=False),
        sa.Column("action", sa.String(16), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_biz_knowledge_events_document_revision", "biz_knowledge_events", ["document_id", "revision"])


def downgrade() -> None:
    op.drop_table("biz_knowledge_events")
    op.drop_table("biz_knowledge_publications")
    op.drop_table("biz_knowledge_documents")
