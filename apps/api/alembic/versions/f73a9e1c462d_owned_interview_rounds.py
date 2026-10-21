"""Owned candidate interview rounds and explicit preparation/session references. No legacy inference."""
import sqlalchemy as sa

from alembic import op

revision = "f73a9e1c462d"
down_revision = "e62f8d0b351c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("job_interview_rounds",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("application_id", sa.String(36), sa.ForeignKey("job_applications.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(160), nullable=False), sa.Column("round_type", sa.String(16)),
        sa.Column("number", sa.Integer()), sa.Column("scheduled_at", sa.DateTime(timezone=True)),
        sa.Column("time_zone", sa.String(100), nullable=False), sa.Column("status", sa.String(16), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False), sa.Column("outcome", sa.String(24)),
        sa.Column("completed_at", sa.DateTime(timezone=True)), sa.Column("source", sa.String(24), nullable=False),
        sa.Column("source_key", sa.String(64), nullable=False), sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("history", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("application_id", "source_key", name="uq_job_round_source"),
        sa.CheckConstraint("revision >= 1", name="ck_job_round_revision"),
        sa.CheckConstraint("status IN ('planned','completed','cancelled')", name="ck_job_round_status"),
        sa.CheckConstraint("number IS NULL OR (number >= 1 AND number <= 20)", name="ck_job_round_number"))
    op.create_index("ix_job_round_owner_application", "job_interview_rounds", ["user_id", "application_id"])
    op.create_index("ix_job_interview_rounds_user_id", "job_interview_rounds", ["user_id"])
    # Opaque versioned source references, like interview_version; ownership is enforced server-side.
    # Add nullable columns directly, avoiding SQLite table recreation and its cascade risk.
    op.add_column("job_applications", sa.Column("preparation_round_id", sa.String(36)))
    op.add_column("job_applications", sa.Column("preparation_round_revision", sa.Integer()))
    op.add_column("sessions", sa.Column("interview_round_id", sa.String(36)))
    op.add_column("sessions", sa.Column("interview_round_revision", sa.Integer()))


def downgrade() -> None:
    # Export round history before an operator-approved downgrade; source resumes/jobs/sessions are retained.
    op.drop_column("sessions", "interview_round_revision")
    op.drop_column("sessions", "interview_round_id")
    op.drop_column("job_applications", "preparation_round_revision")
    op.drop_column("job_applications", "preparation_round_id")
    op.drop_index("ix_job_interview_rounds_user_id", table_name="job_interview_rounds")
    op.drop_index("ix_job_round_owner_application", table_name="job_interview_rounds")
    op.drop_table("job_interview_rounds")
