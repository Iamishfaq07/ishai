import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from orbit_api.db import Base, EmbeddingType


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    # Bumped on password reset / "sign out everywhere"; JWTs carry it, so old tokens stop working.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Privacy controls (spec §65)
    store_transcripts: Mapped[bool] = mapped_column(Boolean, default=True)
    store_screenshots: Mapped[bool] = mapped_column(Boolean, default=False)


class EmailToken(TimestampMixin, Base):
    """Single-use email-verification / password-reset token. Only the SHA-256 of the token is stored."""

    __tablename__ = "email_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(16))  # verify_email | reset_password
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Subscription(TimestampMixin, Base):
    __tablename__ = "subscriptions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    plan: Mapped[str] = mapped_column(String(32), default="free")
    status: Mapped[str] = mapped_column(String(32), default="active")
    provider: Mapped[str | None] = mapped_column(String(32))  # stripe | razorpay
    provider_ref: Mapped[str | None] = mapped_column(String(255))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Document(TimestampMixin, Base):
    __tablename__ = "documents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    kind: Mapped[str] = mapped_column(String(32))  # resume | job_description | notes | other
    filename: Mapped[str | None] = mapped_column(String(300))
    content_type: Mapped[str | None] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="processing")
    error: Mapped[str | None] = mapped_column(Text)
    # Extracted plain text, retained so text documents (and parsed files) can be edited in place
    # and re-chunked. Original binary uploads are still never stored.
    source_text: Mapped[str | None] = mapped_column(Text)
    extracted: Mapped[dict[str, Any] | None] = mapped_column(JSON)  # structured resume/JD profile
    chunks: Mapped[list["DocumentChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )


class DocumentChunk(Base):
    """A retrievable unit: a resume fact, a JD requirement, or a document excerpt."""

    __tablename__ = "document_chunks"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    category: Mapped[str] = mapped_column(String(32))  # experience | skill | project | requirement | ...
    label: Mapped[str] = mapped_column(String(300))  # short citation shown in context_used
    text: Mapped[str] = mapped_column(Text)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)  # user-provided candidate fact
    confidence: Mapped[float] = mapped_column(Float, default=1.0)
    embedding: Mapped[list[float] | None] = mapped_column(EmbeddingType())
    document: Mapped[Document] = relationship(back_populates="chunks")


class LiveSessionRow(TimestampMixin, Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(300))
    role: Mapped[str | None] = mapped_column(String(300))
    language: Mapped[str] = mapped_column(String(16), default="en")
    answer_language: Mapped[str | None] = mapped_column(String(16))
    length: Mapped[str] = mapped_column(String(16), default="standard")
    style: Mapped[str] = mapped_column(String(16), default="bullets")
    auto_answer: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(16), default="created")  # created|live|ended
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_s: Mapped[int] = mapped_column(Integer, default=0)
    rolling_summary: Mapped[str | None] = mapped_column(Text)


class SessionDocument(Base):
    __tablename__ = "session_documents"
    __table_args__ = (UniqueConstraint("session_id", "document_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))


class SessionTurn(TimestampMixin, Base):
    __tablename__ = "session_turns"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    speaker: Mapped[str] = mapped_column(String(16))  # interviewer | candidate | other
    text: Mapped[str] = mapped_column(Text)
    start_ms: Mapped[int] = mapped_column(Integer)
    end_ms: Mapped[int] = mapped_column(Integer)


class Question(TimestampMixin, Base):
    __tablename__ = "questions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    turn_id: Mapped[str | None] = mapped_column(String(36))
    text: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(String(32))
    confidence: Mapped[float] = mapped_column(Float)
    is_follow_up: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(16), default="auto")


class Answer(TimestampMixin, Base):
    __tablename__ = "answers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(16))  # completed | cancelled | failed
    content: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    first_token_ms: Mapped[int | None] = mapped_column(Integer)
    total_ms: Mapped[int | None] = mapped_column(Integer)


class SessionSummary(TimestampMixin, Base):
    __tablename__ = "session_summaries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), unique=True)
    content: Mapped[dict[str, Any]] = mapped_column(JSON)


class UsageEvent(TimestampMixin, Base):
    __tablename__ = "usage"
    # Metering reads filter by (user_id, metric, created_at) on every session-create and /usage call.
    __table_args__ = (Index("ix_usage_user_metric_created", "user_id", "metric", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str | None] = mapped_column(String(36))
    metric: Mapped[str] = mapped_column(String(32))  # live_seconds | stt_seconds | screenshots | ...
    quantity: Mapped[float] = mapped_column(Float)


class ProviderRequest(TimestampMixin, Base):
    __tablename__ = "provider_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    session_id: Mapped[str | None] = mapped_column(String(36), index=True)
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    request_type: Mapped[str] = mapped_column(String(32))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    estimated_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)


class AuditLog(TimestampMixin, Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str | None] = mapped_column(String(128))
    ip: Mapped[str | None] = mapped_column(String(64))
