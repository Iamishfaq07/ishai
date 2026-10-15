import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from orbit_api.db import Base, EmbeddingType


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


PROVIDER_NAME_LEN = 32
MODEL_NAME_LEN = 64
# An account id, its email (up to 320) and a few words: what an admin action on an account records.
AUDIT_TARGET_LEN = 400


class FitsProviderNames:
    """`provider` and `model` as an LLM provider reports them, cut to their columns. Only Postgres enforces
    String(n): a longer name was a DataError there, and the row (an answer, a cost) was lost."""

    @validates("provider", "model")
    def _fit(self, key: str, value: str | None) -> str | None:
        return value[:PROVIDER_NAME_LEN if key == "provider" else MODEL_NAME_LEN] if value else value


class User(TimestampMixin, Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    name: Mapped[str | None] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    # False for an account created with Google that has never set a password. Existing rows are true.
    has_password: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    # Google's stable account id, when this account has used Continue with Google. Unique so one Google
    # account can't be attached twice.
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    # Bumped on password reset / "sign out everywhere"; JWTs carry it, so old tokens stop working.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Privacy controls (spec §65)
    store_transcripts: Mapped[bool] = mapped_column(Boolean, default=True)
    store_screenshots: Mapped[bool] = mapped_column(Boolean, default=False)
    # Sign-up approval (ORBIT_SIGNUP_APPROVAL): a new account waits (approved=False) until the admin approves it
    # for good (Free plan, or whatever it pays for) or grants a plan for a while (grant_plan until grant_until).
    # Accounts from before approval existed are approved.
    approved: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    grant_plan: Mapped[str | None] = mapped_column(String(32))
    grant_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Suspended by the admin: can't sign in or use the API until unsuspended (auth/security.current_user). The reason
    # is shown to the account's owner when they try.
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suspended_reason: Mapped[str | None] = mapped_column(String(300))
    # The admin's private notes on the account. Never shown to the account's owner (or in their data export).
    admin_note: Mapped[str | None] = mapped_column(Text)
    # The country the user is applying for jobs in (ISO 3166-1 alpha-2, "IN", "US"): sets the currency, sample
    # salaries, job search and wording they see. Guessed from the browser at first and changed by them any time;
    # None until then.
    country: Mapped[str | None] = mapped_column(String(2))


class AppConfig(Base):
    """Key/value overrides for runtime settings the admin edits in-app (e.g. provider API keys).

    Secret values (is_secret=True) are stored encrypted with ORBIT_CONFIG_SECRET; plaintext is
    never persisted. A missing key means "use the environment/default".
    """

    __tablename__ = "app_config"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)  # encrypted when is_secret
    is_secret: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class EmailToken(TimestampMixin, Base):
    """Single-use email-verification / password-reset token. Only the SHA-256 of the token is stored."""

    __tablename__ = "email_tokens"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(16))  # verify_email | reset_password | change_email
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    new_email: Mapped[str | None] = mapped_column(String(320), nullable=True)  # change_email: the address to switch to


class Subscription(TimestampMixin, Base):
    __tablename__ = "subscriptions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    plan: Mapped[str] = mapped_column(String(32), default="free")
    status: Mapped[str] = mapped_column(String(32), default="active")
    provider: Mapped[str | None] = mapped_column(String(32))  # stripe | razorpay
    provider_ref: Mapped[str | None] = mapped_column(String(255))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LaunchAccessClaim(TimestampMixin, Base):
    """One international launch request per account, visible in the existing admin Inbox."""

    __tablename__ = "launch_access_claims"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    contact_id: Mapped[str] = mapped_column(ForeignKey("contact_messages.id", ondelete="CASCADE"))
    country: Mapped[str] = mapped_column(String(2))
    pack: Mapped[str] = mapped_column(String(32))


class Payment(TimestampMixin, Base):
    """A payment for a credit pack. `method` "upi" (billing/upi.py): an order with a reference for the UPI note; the
    payer gives the UTR (the bank's 12-digit transaction number) and the admin approves it against the bank
    statement. "razorpay" (billing/razorpay.py): an order made at Razorpay, approved automatically when Razorpay's
    signed answer (the checkout's, or its webhook's) says it was paid."""

    __tablename__ = "payments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # SET NULL, not CASCADE: a deleted account's payments (and their unique UTRs) stay, so a transfer can't be
    # submitted again from a new account.
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True,
                                                nullable=True)
    plan: Mapped[str] = mapped_column(String(32))  # the credit pack's id (billing/packs.py)
    amount_inr: Mapped[int] = mapped_column(Integer)
    days: Mapped[int] = mapped_column(Integer)  # 0 for credit packs (older time-limited orders: their days)
    # What the pack gave when it was bought, so changing the packs later doesn't change an order already paid for.
    resume_credits: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    interview_minutes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    reference: Mapped[str] = mapped_column(String(16), unique=True)
    # UPI: awaiting_payment → submitted (UTR given) → approved | rejected (a rejected one can be submitted again).
    # Razorpay: awaiting_payment → processing (Razorpay has a payment for the order, not captured yet) → approved;
    # an order nobody paid within RECONCILE_WINDOW becomes expired (billing/reconcile.py).
    status: Mapped[str] = mapped_column(String(20), default="awaiting_payment", index=True)
    utr: Mapped[str | None] = mapped_column(String(32), unique=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    note: Mapped[str | None] = mapped_column(String(300))  # the admin's reason, shown to the payer
    method: Mapped[str] = mapped_column(String(16), default="upi", server_default="upi")
    # Razorpay's order and payment ids ("order_…", "pay_…"): unique, so one payment is credited once.
    gateway_order_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    gateway_payment_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    # Refunds processed against this payment, in paise (the sum of its PaymentRefund rows that went through).
    refunded_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # The reconciler's checks with Razorpay of an order still open (billing/reconcile.py): how many, and the last.
    reconcile_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PaymentRefund(TimestampMixin, Base):
    """One refund at the payment gateway, keyed by its id ("rfnd_…"), so a refund is recorded once however often its
    webhook arrives. `payment_id` is set once the payment it refunds is known here; a refund that arrives before its
    capture is kept unlinked (`gateway_payment_id` only) and linked when the payment lands (billing/reconcile.py).
    Credits bought are not taken back by a refund (docs/BILLING.md, refund policy)."""

    __tablename__ = "payment_refunds"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    refund_id: Mapped[str] = mapped_column(String(40), unique=True)
    gateway_payment_id: Mapped[str] = mapped_column(String(40), index=True)
    payment_id: Mapped[str | None] = mapped_column(ForeignKey("payments.id", ondelete="SET NULL"), index=True,
                                                   nullable=True)
    amount_paise: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16))  # Razorpay's: created | processed | failed
    linked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PaymentEvent(TimestampMixin, Base):
    """A webhook event from the payment gateway, recorded once by its event id (Razorpay's X-Razorpay-Event-Id, or
    a hash of the signed body), so a redelivery is recognized and an event that couldn't be applied is kept for a
    retry. Holds ids, amounts and statuses only: never the payer's email, phone or card details."""

    __tablename__ = "payment_events"
    __table_args__ = (Index("ix_payment_events_status_created", "status", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    provider: Mapped[str] = mapped_column(String(16), default="razorpay")
    event_id: Mapped[str] = mapped_column(String(80), unique=True)
    event: Mapped[str] = mapped_column(String(40))  # payment.captured | order.paid | refund.processed | ...
    entity_id: Mapped[str | None] = mapped_column(String(40))  # pay_…, rfnd_… or order_…
    # received → processed | ignored (nothing to do) | unmatched (its payment isn't known yet) | error
    status: Mapped[str] = mapped_column(String(12), default="received")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(String(300))
    data: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CreditEntry(TimestampMixin, Base):
    """One movement of an account's credits (credits.py): + from the welcome grant, a UPI pack or the admin; − for a
    resume-AI action. Interview minutes are spent through the usage rows instead (live and mock seconds), so only
    their grants are here. No foreign key: a welcome grant's network (`ip_hash`) must outlive a deleted account, or
    deleting and signing up again would hand out another one."""

    __tablename__ = "credit_entries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # resume | interview_seconds
    amount: Mapped[int] = mapped_column(Integer)  # signed
    reason: Mapped[str] = mapped_column(String(20))  # welcome | purchase | admin | admin_remove | resume_ai
    # The admin's own words for an adjustment by hand ("refund for a dropped call"): shown in the account's history.
    note: Mapped[str | None] = mapped_column(String(300))
    payment_id: Mapped[str | None] = mapped_column(String(36))
    ip_hash: Mapped[str | None] = mapped_column(String(64))
    # Welcome grants: a keyed hash of the inbox (credits.inbox), so one mailbox gets one welcome however it's spelled.
    email_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    __table_args__ = (Index("ix_credit_entries_welcome", "reason", "ip_hash", "created_at"),
                      # One grant per payment and kind: approving twice at once can't add a pack's credits twice.
                      Index("uq_credit_entries_payment_kind", "payment_id", "kind", unique=True,
                            postgresql_where=text("payment_id IS NOT NULL"),
                            sqlite_where=text("payment_id IS NOT NULL")))


class FreeAiUse(TimestampMixin, Base):
    """The free resume-AI action (resumes/allowance.py): one per account for good, one per IP address per window.
    The IP is kept only as a keyed hash. No foreign key: the row outlives a deleted account, so deleting it and
    signing up again from the same network doesn't hand out another free use."""

    __tablename__ = "free_ai_uses"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(String(36), unique=True)
    ip_hash: Mapped[str] = mapped_column(String(64))
    __table_args__ = (Index("ix_free_ai_uses_ip_created", "ip_hash", "created_at"),)


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
    # Which embedder produced `embedding` (e.g. "hash-v2", "BAAI/bge-small-en-v1.5"). A mismatch with the
    # configured embedder means the vector is re-computed when a session loads the chunk. NULL = legacy hash-v1.
    embedding_model: Mapped[str | None] = mapped_column(String(64), nullable=True)
    document: Mapped[Document] = relationship(back_populates="chunks")


class LiveSessionRow(TimestampMixin, Base):
    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(300))
    role: Mapped[str | None] = mapped_column(String(300))
    company: Mapped[str | None] = mapped_column(String(120))
    interview_stage: Mapped[str | None] = mapped_column(String(80))
    tech_stack: Mapped[list[str] | None] = mapped_column(JSON)
    key_requirements: Mapped[list[str] | None] = mapped_column(JSON)
    language: Mapped[str] = mapped_column(String(16), default="en")
    answer_language: Mapped[str | None] = mapped_column(String(16))
    length: Mapped[str] = mapped_column(String(16), default="standard")
    style: Mapped[str] = mapped_column(String(16), default="natural")
    auto_answer: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(16), default="created")  # created|live|ended
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_s: Mapped[int] = mapped_column(Integer, default=0)
    rolling_summary: Mapped[str | None] = mapped_column(Text)
    # Latency samples in ms, per metric (live/metrics.py). Timings only — never transcript content.
    metrics: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # Mock interviews: interview type, difficulty, duration, persona (orbit_api.live.mock_interviewer.MockConfig).
    mock_config: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    # The candidate's standing instructions for answers ("mention I'm relocating", "British spelling").
    instructions: Mapped[str | None] = mapped_column(Text)
    # The saved setup this session was started from (kept if the workspace is later deleted, as NULL).
    workspace_id: Mapped[str | None] = mapped_column(ForeignKey("workspaces.id", ondelete="SET NULL"), index=True)
    # What the live connection remembers (live/carryover.py, as JSON): saved every heartbeat and when it drops, so a
    # server restart mid-session continues the conversation and the mock round. Cleared when the session ends.
    carryover: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))


class Workspace(TimestampMixin, Base):
    """A saved interview setup ("Google — Senior Security Engineer"): documents + answer preferences, so a
    session starts without re-selecting everything. Not a job tracker."""

    __tablename__ = "workspaces"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    company: Mapped[str | None] = mapped_column(String(200))
    role: Mapped[str | None] = mapped_column(String(300))
    session_type: Mapped[str] = mapped_column(String(32), default="interview")
    language: Mapped[str] = mapped_column(String(16), default="en")
    answer_language: Mapped[str | None] = mapped_column(String(16))
    length: Mapped[str] = mapped_column(String(16), default="short")
    style: Mapped[str] = mapped_column(String(16), default="natural")
    auto_answer: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Story(TimestampMixin, Base):
    """A story-bank entry: one of the candidate's real examples in STAR form, reused across interviews. Every live
    session can draw on it as a verified candidate fact for behavioral answers."""

    __tablename__ = "stories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    situation: Mapped[str] = mapped_column(Text, default="")
    task: Mapped[str] = mapped_column(Text, default="")
    action: Mapped[str] = mapped_column(Text, default="")
    result: Mapped[str] = mapped_column(Text, default="")
    competencies: Mapped[list[str]] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    # Retrieval vector, computed lazily when a session loads the story (see sessions.routes._load_index).
    embedding: Mapped[list[float] | None] = mapped_column(EmbeddingType())
    embedding_model: Mapped[str | None] = mapped_column(String(64))


class EvidenceItem(TimestampMixin, Base):
    """Career Evidence Vault: one claim about the candidate's work ("Cut checkout latency by 40%") with where it comes
    from. `status` "confirmed": the user wrote it or checked it; only these are used (live answers draw on them as
    verified facts). "suggested": the AI proposed it from a story or the resume, quoting the source word for word
    (checked on the way in); it waits for the user and is used nowhere until confirmed."""

    __tablename__ = "evidence_items"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    claim: Mapped[str] = mapped_column(String(300))
    # The source's own words behind the claim ("" for one the user wrote themselves).
    quote: Mapped[str] = mapped_column(Text, default="")
    source_kind: Mapped[str] = mapped_column(String(16), default="manual")  # manual | story | resume
    # The story or document it came from; None once that's deleted (the title and quote stay).
    source_id: Mapped[str | None] = mapped_column(String(36))
    source_title: Mapped[str] = mapped_column(String(160), default="")
    status: Mapped[str] = mapped_column(String(16), default="confirmed")  # confirmed | suggested
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    embedding: Mapped[list[float] | None] = mapped_column(EmbeddingType())
    embedding_model: Mapped[str | None] = mapped_column(String(64))


class JobOffer(TimestampMixin, Base):
    """Offer AI (orbit_api/offers): an offer the user has (or expects), in figures a year, to see what it pays each
    month, how it compares with the market and their other offers, and to plan the negotiation. `plan` is the AI's
    negotiation plan, kept with the hash of what it was made from (a changed offer is a new plan)."""

    __tablename__ = "job_offers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    company: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(120), default="")
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    fixed: Mapped[int] = mapped_column(Integer)  # a year
    variable: Mapped[int] = mapped_column(Integer, default=0)  # a year, at target
    joining_bonus: Mapped[int] = mapped_column(Integer, default=0)  # once
    equity_per_year: Mapped[int] = mapped_column(Integer, default=0)  # the grant's value a year, as the offer says
    other: Mapped[int] = mapped_column(Integer, default=0)  # a year: allowances, retention, relocation
    pf: Mapped[str] = mapped_column(String(8), default="capped")  # capped | full | none (India)
    employer_costs_in_ctc: Mapped[bool] = mapped_column(Boolean, default=True)
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(12), default="considering")  # considering | accepted | declined
    notes: Mapped[str] = mapped_column(Text, default="")
    plan: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    plan_hash: Mapped[str | None] = mapped_column(String(64))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class LinkedInProfileRow(TimestampMixin, Base):
    """LinkedIn AI (orbit_api/linkedin): the user's LinkedIn profile as last read from its "Save to PDF" (sections, the
    text as it is on LinkedIn), and the role they're targeting. The PDF itself isn't kept."""

    __tablename__ = "linkedin_profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    target_role: Mapped[str] = mapped_column(String(200), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class CodeAttempt(TimestampMixin, Base):
    """Code AI (orbit_api/code): one go at a practice problem, the code, how the candidate explained their approach,
    how many of the problem's tests passed (run in their browser; JavaScript only), and the AI interviewer's review."""

    __tablename__ = "code_attempts"
    __table_args__ = (Index("ix_code_attempts_user_problem", "user_id", "problem_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    problem_id: Mapped[str] = mapped_column(String(40))
    language: Mapped[str] = mapped_column(String(16))
    code: Mapped[str] = mapped_column(Text)
    approach: Mapped[str] = mapped_column(Text, default="")
    passed: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    solved: Mapped[bool] = mapped_column(Boolean, default=False)
    review: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class SavedAnswer(TimestampMixin, Base):
    """An answer bank entry: a question the user has worked out how to answer, in their own words (often a review's
    "Try saying", edited). Every live session can draw on it, as the stories are, so the copilot's answer to that
    question starts from the user's prepared one."""

    __tablename__ = "saved_answers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    # The session whose review it was saved from; SET NULL, so deleting the session keeps the answer.
    session_id: Mapped[str | None] = mapped_column(ForeignKey("sessions.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    # Retrieval vector, computed lazily when a session loads the answer (see sessions.routes._load_index).
    embedding: Mapped[list[float] | None] = mapped_column(EmbeddingType())
    embedding_model: Mapped[str | None] = mapped_column(String(64))


class Resume(TimestampMixin, Base):
    """A resume built in the resume maker: its content and design as JSON (resumes/schema.py), plus the job post it's
    being tailored to. Scored on demand (resumes/ats.py); nothing here is shared with live sessions unless the user
    saves it to Documents."""

    __tablename__ = "resumes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    design: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    job_text: Mapped[str] = mapped_column(Text, default="")
    # The cover letter written for this resume and job post (AI draft, then the user's edits).
    cover_letter: Mapped[str] = mapped_column(Text, default="", server_default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    # Bumped by every save. A save naming the revision it was based on is refused (409) if another save landed since
    # (another tab, another device), so one can't silently overwrite the other (V3-06, resumes/routes.py).
    revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_client_id: Mapped[str | None] = mapped_column(String(64))
    client_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    prep_context: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    pending_suggestions: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)


class CareerPreparation(TimestampMixin, Base):
    __tablename__ = "career_preparations"
    __table_args__ = (UniqueConstraint("user_id", "listing_id", "source_resume_id", "source_revision",
                                      name="uq_career_preparation_source"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    listing_id: Mapped[str] = mapped_column(String(36))
    source_resume_id: Mapped[str] = mapped_column(ForeignKey("resumes.id", ondelete="CASCADE"))
    source_revision: Mapped[int] = mapped_column(Integer)
    resume_id: Mapped[str | None] = mapped_column(ForeignKey("resumes.id", ondelete="SET NULL"))
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    resume_document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(12), default="running")
    context: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class DebriefAttempt(TimestampMixin, Base):
    __tablename__ = "debrief_attempts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    answer: Mapped[str] = mapped_column(Text)
    result: Mapped[dict[str, Any]] = mapped_column(JSON)


class WorkspaceDocument(Base):
    __tablename__ = "workspace_documents"
    __table_args__ = (UniqueConstraint("workspace_id", "document_id", name="uq_workspace_document"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    workspace_id: Mapped[str] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)


class SessionDocument(Base):
    __tablename__ = "session_documents"
    __table_args__ = (UniqueConstraint("session_id", "document_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    # Indexed: deleting a document cascades here, and on Postgres an unindexed FK means a scan per delete.
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)


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


class Answer(FitsProviderNames, TimestampMixin, Base):
    __tablename__ = "answers"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(16))  # completed | cancelled | failed
    content: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    provider: Mapped[str] = mapped_column(String(PROVIDER_NAME_LEN))
    model: Mapped[str] = mapped_column(String(MODEL_NAME_LEN))
    first_token_ms: Mapped[int | None] = mapped_column(Integer)
    total_ms: Mapped[int | None] = mapped_column(Integer)


class AnswerFeedback(TimestampMixin, Base):
    """The user's 👍/👎 on one answer (and, for 👎, why). Keyed by the live answer id rather than a foreign key to
    `answers`, whose row is written in the background and may land a moment after the user rates it."""

    __tablename__ = "answer_feedback"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    answer_id: Mapped[str] = mapped_column(String(36), unique=True)
    rating: Mapped[str] = mapped_column(String(8))  # up | down
    reason: Mapped[str | None] = mapped_column(String(32))  # for "down": too_long | too_generic | ...
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class SessionSummary(TimestampMixin, Base):
    __tablename__ = "session_summaries"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), unique=True)
    content: Mapped[dict[str, Any]] = mapped_column(JSON)


class UsageEvent(TimestampMixin, Base):
    __tablename__ = "usage"
    # Metering reads filter by (user_id, metric, created_at) on every session-create and /usage call.
    __table_args__ = (Index("ix_usage_user_metric_created", "user_id", "metric", "created_at"),
                      Index("uq_usage_idempotency_key", "idempotency_key", unique=True))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[str | None] = mapped_column(String(36))
    metric: Mapped[str] = mapped_column(String(32))  # live_seconds | stt_seconds | screenshots | ...
    quantity: Mapped[float] = mapped_column(Float)
    # Set for events written more than once (retries, live-minute heartbeats): writers upsert on it, so a
    # retry or a repeated heartbeat never double-counts. e.g. "live:<connection id>", "shot:<question id>".
    idempotency_key: Mapped[str | None] = mapped_column(String(128))
    # Interview time (live_seconds, mock_seconds): the balance it came out of, fixed when the row is written —
    # "credits", or the name of the plan whose monthly allowance it used (entitlements.usage_pool). NULL counts
    # against every balance, as every row did before pools were recorded.
    pool: Mapped[str | None] = mapped_column(String(16))


class FailedWrite(TimestampMixin, Base):
    """Dead letter: a live-session row that still couldn't be written after retries. Replayed on startup."""

    __tablename__ = "failed_writes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(64))  # model class name, e.g. "UsageEvent"
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    error: Mapped[str] = mapped_column(Text)
    replayed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)


class Job(TimestampMixin, Base):
    """Durable background work (session reports). Survives restarts; a worker in each API process claims
    due jobs. `dedupe_key` makes enqueueing idempotent (one pending report per session)."""

    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_status_run_after", "status", "run_after"),
                      Index("uq_jobs_dedupe_key", "dedupe_key", unique=True))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    kind: Mapped[str] = mapped_column(String(32))
    dedupe_key: Mapped[str | None] = mapped_column(String(128))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued | running | done | failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    run_after: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_error: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ProviderRequest(FitsProviderNames, TimestampMixin, Base):
    __tablename__ = "provider_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    session_id: Mapped[str | None] = mapped_column(String(36), index=True)
    provider: Mapped[str] = mapped_column(String(PROVIDER_NAME_LEN))
    model: Mapped[str] = mapped_column(String(MODEL_NAME_LEN))
    request_type: Mapped[str] = mapped_column(String(32))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached_input_tokens: Mapped[int] = mapped_column(Integer, default=0)  # subset of input_tokens
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    # None = no price configured for the model (see providers/llm/pricing.py) — never silently $0.
    estimated_cost_usd: Mapped[float | None] = mapped_column(Float, default=None)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)


class AuditLog(TimestampMixin, Base):
    """Who did what. `user_id` is whoever acted (the admin, for admin.* actions), with no foreign key: the trail
    outlives a deleted account. Admin actions on an account start `target` with that account's id."""

    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_created_at", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str | None] = mapped_column(String(AUDIT_TARGET_LEN))
    ip: Mapped[str | None] = mapped_column(String(64))

    @validates("target")
    def _fit(self, _key: str, value: str | None) -> str | None:
        return value[:AUDIT_TARGET_LEN] if value else value


# ---- Jobs (orbit_api/job_portal) ------------------------------------------------------------------------------


class JobListing(Base):
    """A job post from a public source (a company's own job board, a remote-jobs feed, an optional search API),
    normalized and cached so the feed is ranked locally without calling anyone. Shared by every user; nobody owns it.

    The id is derived from (source, external_id), so the same post keeps its id across refreshes and the tracker can
    find it again. `description` is kept for matching and tailoring only: the feed shows `snippet` and links to the
    original post."""

    __tablename__ = "job_listings"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_job_listings_source_external"),
                      Index("ix_job_listings_posted_at", "posted_at"),
                      Index("ix_job_listings_source_board", "source", "board"),
                      Index("ix_job_listings_dedupe_key", "dedupe_key"),
                      Index("ix_job_listings_country", "country"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source: Mapped[str] = mapped_column(String(24))  # greenhouse | lever | ashby | smartrecruiters | himalayas | ...
    external_id: Mapped[str] = mapped_column(String(200))
    # What it was fetched under: the company's board token, or the search it came back from.
    board: Mapped[str] = mapped_column(String(160))
    company: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(300))
    locations: Mapped[list[str]] = mapped_column(JSON, default=list)
    cities: Mapped[list[str]] = mapped_column(JSON, default=list)  # canonical cities ("Bengaluru", "New York")
    country: Mapped[str | None] = mapped_column(String(2))  # where the job is (ISO code), when the post says
    # A remote post: who it's open to (country codes, geo.REGIONS names like "EMEA", or "*" for anywhere).
    remote_scope: Mapped[list[str] | None] = mapped_column(JSON)
    workplace: Mapped[str | None] = mapped_column(String(16))  # remote | hybrid | onsite (None: not stated)
    employment_type: Mapped[str | None] = mapped_column(String(16))  # full_time | part_time | contract | internship
    level: Mapped[str | None] = mapped_column(String(16))  # fresher | junior | mid | senior, read from the post
    exp_min: Mapped[int | None] = mapped_column(Integer)  # years of experience asked for, when the post says
    exp_max: Mapped[int | None] = mapped_column(Integer)
    posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    url: Mapped[str] = mapped_column(Text)  # the original post
    apply_url: Mapped[str] = mapped_column(Text)
    snippet: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    salary: Mapped[str | None] = mapped_column(String(120))
    # What the post says about sponsoring a work visa ("offered" | "not_offered"; None: it doesn't), and whether it
    # offers help relocating (job_portal/signals.py).
    visa: Mapped[str | None] = mapped_column(String(12))
    relocation: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    keywords: Mapped[list[str]] = mapped_column(JSON, default=list)  # the post's skills, read once at fetch time
    text_hash: Mapped[str | None] = mapped_column(String(16))  # of title + description: keywords re-read on change
    dedupe_key: Mapped[str] = mapped_column(String(300))  # company + title + city, normalized
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)  # last seen upstream
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class JobSourceState(Base):
    """When each source (and each board or search of it) was last fetched, how it went, and when it may be tried
    again. The row with key "*" holds a source's call counts, for the APIs with a quota (Adzuna, JSearch)."""

    __tablename__ = "job_source_state"
    __table_args__ = (UniqueConstraint("source", "key", name="uq_job_source_state_source_key"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    source: Mapped[str] = mapped_column(String(24))
    key: Mapped[str] = mapped_column(String(160))
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error: Mapped[str | None] = mapped_column(String(300))
    listings: Mapped[int] = mapped_column(Integer, default=0)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    retry_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # searches: last asked for
    day: Mapped[str | None] = mapped_column(String(10))  # quota counts: "2026-10-07", and calls that day
    day_calls: Mapped[int] = mapped_column(Integer, default=0)
    month: Mapped[str | None] = mapped_column(String(7))  # "2026-10", and calls that month
    month_calls: Mapped[int] = mapped_column(Integer, default=0)


class JobSearchProfile(TimestampMixin, Base):
    """What the user's job feed looks for: filled in from a resume by the AI (`suggested`, cached per resume content
    hash), then theirs to edit (`prefs`, job_portal/profile.py)."""

    __tablename__ = "job_search_profiles"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    resume_id: Mapped[str | None] = mapped_column(ForeignKey("resumes.id", ondelete="SET NULL"), index=True)
    prefs: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    suggested: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    suggested_hash: Mapped[str | None] = mapped_column(String(64))  # the resume content it was read from
    # Job alerts (job_portal/alerts.py): an email of new matches, "off" | "daily" | "weekly"; when the last went out
    # (or was due with nothing new); and the token of its one-click "stop these emails" link.
    alert: Mapped[str] = mapped_column(String(8), default="off", server_default="off")
    alert_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    alert_token: Mapped[str | None] = mapped_column(String(64), unique=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class JobApplication(TimestampMixin, Base):
    """A job in the user's tracker: saved, applied, interviewing, offer or rejected. Keeps its own copy of the job's
    title, company and links, since cached listings are dropped after about 30 days."""

    __tablename__ = "job_applications"
    __table_args__ = (UniqueConstraint("user_id", "listing_id", name="uq_job_applications_user_listing"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    listing_id: Mapped[str] = mapped_column(String(36))  # JobListing.id (stable), not a foreign key
    source: Mapped[str] = mapped_column(String(24))
    company: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(300))
    location: Mapped[str] = mapped_column(String(300), default="")
    url: Mapped[str] = mapped_column(Text)
    apply_url: Mapped[str] = mapped_column(Text)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="saved")  # saved|applied|interviewing|offer|rejected
    notes: Mapped[str] = mapped_column(Text, default="")
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # the next interview or follow-up
    status_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)  # when it last moved
    # The resume tailored for this job and the job description saved for interview prep, when made from here.
    resume_id: Mapped[str | None] = mapped_column(ForeignKey("resumes.id", ondelete="SET NULL"), index=True)
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id", ondelete="SET NULL"), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class JobFitCheck(TimestampMixin, Base):
    """An AI fit check of one resume against one job, kept so asking again (same job, same resume content) is
    instant and free. Today's rows (created_at) are also what the daily cap counts."""

    __tablename__ = "job_fit_checks"
    __table_args__ = (UniqueConstraint("user_id", "listing_id", "resume_hash", name="uq_job_fit_checks_key"),
                      Index("ix_job_fit_checks_user_created", "user_id", "created_at"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    listing_id: Mapped[str] = mapped_column(String(36))
    resume_hash: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict[str, Any]] = mapped_column(JSON)


# ---- Contact (orbit_api/contact, admin/inbox.py) ----------------------------------------------------------------


class JobContact(TimestampMixin, Base):
    """A person in the user's job search: a referrer, a recruiter, an alum, the hiring manager. Who they are, how to
    reach them, notes, when the user last got in touch and when to follow up; optionally linked to a tracked job
    (SET NULL, so removing the job keeps the person)."""

    __tablename__ = "job_contacts"
    __table_args__ = (Index("ix_job_contacts_user_follow_up", "user_id", "follow_up_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    company: Mapped[str] = mapped_column(String(200), default="")
    title: Mapped[str] = mapped_column(String(200), default="")
    relation: Mapped[str] = mapped_column(String(24), default="other")  # referral|recruiter|alum|hiring_manager|...
    linkedin_url: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(32))
    notes: Mapped[str] = mapped_column(Text, default="")
    application_id: Mapped[str | None] = mapped_column(ForeignKey("job_applications.id", ondelete="SET NULL"),
                                                       index=True)
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ContactMessage(TimestampMixin, Base):
    """A message sent from the Contact page (`POST /v1/contact`), signed in or out, waiting in the admin's Inbox.

    `user_id` links the account that was signed in when it was sent; SET NULL, so deleting the account keeps the
    message (it was written to Orbit) without the link. The name, email and phone are what the sender typed, never
    copied from the account. `network_hash` is a keyed hash of the sender's network (as the welcome grant keeps it,
    credits.ip_hash), for rate limits and spotting a flood from one place: the address itself is never stored.
    Messages marked done or spam are deleted ORBIT_CONTACT_RETENTION_DAYS after that (contact/routes.py)."""

    __tablename__ = "contact_messages"
    __table_args__ = (Index("ix_contact_messages_status_created", "status", "created_at"),
                      Index("ix_contact_messages_network_created", "network_hash", "created_at"),
                      Index("ix_contact_messages_created_at", "created_at"),
                      Index("ux_contact_messages_source_thread", "source_support_thread_id", unique=True))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True,
                                                nullable=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(32))  # phone or WhatsApp, optional
    topic: Mapped[str] = mapped_column(String(24))  # general | payment | technical | report_job | business | ...
    message: Mapped[str] = mapped_column(Text)
    # Where it came from and what it's about, bounded (contact/routes.py ContextIn): a reported job's listing id,
    # title, company and link, the page it was sent from.
    context: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    status: Mapped[str] = mapped_column(String(8), default="new")  # new (unread) | open | done | spam
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # marked done or spam
    admin_note: Mapped[str | None] = mapped_column(Text)  # the admin's own, never sent to the sender
    # Replies the admin sent from the Inbox: [{"at", "by", "text"}], oldest first.
    replies: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON(none_as_null=True))
    network_hash: Mapped[str | None] = mapped_column(String(64))
    # Set when the message is a support chat's "talk to a person" ticket (support/routes.py handoff), not something
    # typed on the Contact page: a copy of the chat. One ticket per chat (unique), and it goes with the chat: deleting
    # the chat (or the account, which deletes its chats) deletes the copy (CASCADE).
    source_support_thread_id: Mapped[str | None] = mapped_column(
        ForeignKey("support_threads.id", ondelete="CASCADE", name="fk_contact_messages_source_thread"), nullable=True)


class SupportThread(TimestampMixin, Base):
    """A support chat. The bot answers until the visitor asks for a person (`status` becomes `waiting`).

    `token_hash` is the only proof a browser may read or write the thread (the raw token is never stored).
    `user_id` is set when the visitor was signed in. Deleting the account deletes the chat (auth/accounts.py)."""

    __tablename__ = "support_threads"
    __table_args__ = (Index("ix_support_threads_status_updated", "status", "updated_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True,
                                                nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(320), default="")
    status: Mapped[str] = mapped_column(String(16), default="bot")  # bot | waiting | closed
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    messages: Mapped[list["SupportMessage"]] = relationship(back_populates="thread", cascade="all, delete-orphan",
                                                            order_by="SupportMessage.created_at", lazy="raise")


class SupportMessage(TimestampMixin, Base):
    """One line in a support chat: the visitor, the bot, or a person on the Orbit team."""

    __tablename__ = "support_messages"
    __table_args__ = (Index("ix_support_messages_thread_created", "thread_id", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    thread_id: Mapped[str] = mapped_column(ForeignKey("support_threads.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(8))  # user | bot | human
    text: Mapped[str] = mapped_column(Text)
    thread: Mapped[SupportThread] = relationship(back_populates="messages")

