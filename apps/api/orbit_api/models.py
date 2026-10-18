import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
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
    # Where the running grant's allowance windows count from (30 days each): when it was bought or given, so use from
    # before never counts against it (entitlements.allowance_window, D57). None: a grant from before this was kept.
    grant_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The running grant was bought (billing/monthly.py), not given by the admin. A record of where it came from:
    # either way each window has the plan's whole allowance.
    grant_paid: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # Grants waiting their turn behind the running one, next first (D57): a lower plan bought while a higher one runs,
    # or what's left of the running one when a higher plan starts. [{"plan", "seconds", "paid", "anchor"}].
    grant_queue: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON(none_as_null=True))
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
    # What was charged: INR (amount_inr) or, outside India, USD in cents (amount_minor; amount_inr is then its rupee
    # equivalent, for reports). billing/pricing.py.
    currency: Mapped[str] = mapped_column(String(3), default="INR", server_default="INR")
    amount_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Razorpay's order and payment ids ("order_…", "pay_…"): unique, so one payment is credited once.
    gateway_order_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    gateway_payment_id: Mapped[str | None] = mapped_column(String(40), unique=True)
    # Refunds processed against this payment, in paise (the sum of its PaymentRefund rows that went through).
    refunded_paise: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # The reconciler's checks with Razorpay of an order still open (billing/reconcile.py): how many, and the last.
    reconcile_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # A first-purchase discount (billing/referrals.py): the code it came with, and how much came off, in the order's
    # minor unit. The amounts above are what was charged. No foreign key: the order's record outlives the code.
    referral_code_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    discount_minor: Mapped[int | None] = mapped_column(Integer, nullable=True)


class ReferralCode(TimestampMixin, Base):
    """A code that brings people to Orbit (billing/referrals.py). "invite": an account's own invite link, one per
    account (it goes with the account). "creator" / "campus": made by the admin, with a label, its own discount, a
    commission for the report (paid by hand), and optionally an expiry and a cap on paying accounts. `code` is stored
    in upper case and matched without regard to case."""

    __tablename__ = "referral_codes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    kind: Mapped[str] = mapped_column(String(10))  # invite | creator | campus
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True,
                                                      nullable=True)
    label: Mapped[str | None] = mapped_column(String(120))
    # Off the first purchase. None (an invite code): ORBIT_REFERRAL_DISCOUNT_PERCENT.
    discount_percent: Mapped[int | None] = mapped_column(Integer)
    commission_percent: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    max_uses: Mapped[int | None] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    created_by: Mapped[str | None] = mapped_column(String(36))


class Referral(TimestampMixin, Base):
    """Which code brought an account: one row per account, for good (billing/referrals.py). `status`: joined →
    rewarded (an invite: the inviter got their minutes) | capped (past the inviter's monthly cap) | paid (a creator or
    campus code) when its first payment lands; or blocked (an invite to the inviter's own account, inbox or network).
    No foreign keys on the accounts: the row outlives a deleted account, so the same inbox can't be invited again;
    it holds keyed hashes, never the address or the IP."""

    __tablename__ = "referrals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), unique=True)
    code_id: Mapped[str | None] = mapped_column(ForeignKey("referral_codes.id", ondelete="SET NULL"), index=True,
                                                nullable=True)
    kind: Mapped[str] = mapped_column(String(10))  # the code's, kept if the code goes
    referrer_user_id: Mapped[str | None] = mapped_column(String(36))  # an invite's inviter
    status: Mapped[str] = mapped_column(String(10), default="joined")
    # Why it's blocked (own_code, same_inbox, same_network, mutual) or wasn't rewarded (paid_before).
    reason: Mapped[str | None] = mapped_column(String(20))
    via: Mapped[str] = mapped_column(String(10), default="signup")  # signup | checkout
    email_hash: Mapped[str] = mapped_column(String(64), index=True)  # credits.email_hash: one inbox, one referral
    ip_hash: Mapped[str | None] = mapped_column(String(64))  # the network it signed up (or entered the code) from
    first_payment_id: Mapped[str | None] = mapped_column(String(36), unique=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reward_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # A refund or chargeback of the first payment: when it was handled, the reward taken back, and a note for the admin.
    clawed_back_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    clawback_seconds: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    flag: Mapped[str | None] = mapped_column(String(200))
    __table_args__ = (Index("ix_referrals_referrer_status_paid", "referrer_user_id", "status", "paid_at"),)


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
    # Who made it: "user" (an upload, or text the user pasted into Documents) or "orbit" (saved by Orbit itself from
    # what the user already has in Orbit, to run a practice round or a session: a job's post, a resume version). Only
    # the user's count against the plan's documents; Orbit's are capped on their own (documents/routes.py).
    origin: Mapped[str] = mapped_column(String(8), default="user", server_default="user")
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
    # Mock interviews with the camera coach on (sessions/camera.py): numbers measured on the person's own device
    # (face in frame %, facing the camera %, head movement). Never video, images or face landmarks.
    camera_metrics: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    # The tracked job this session is a round (or a practice round) for, when it was started from that job
    # (job_portal/interview.py). Checked against the owner when set; NULL once the job leaves the tracker.
    application_id: Mapped[str | None] = mapped_column(ForeignKey("job_applications.id", ondelete="SET NULL"),
                                                       index=True)


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
    # The tracked job this offer is for (Job Mission Room), linked by the user, never guessed from the company name.
    application_id: Mapped[str | None] = mapped_column(ForeignKey("job_applications.id", ondelete="SET NULL"),
                                                       index=True)
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
    # Orbit for Business: the company whose job description or applicant this call was for (no FK, like user_id), so
    # AI use can be counted per company for plan limits later (D82).
    company_id: Mapped[str | None] = mapped_column(String(36), index=True)
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
    # The next interview round (job_portal/interview.py): its type (hr | technical | managerial | final) and number,
    # both set by the user; `next_at` is its date and time.
    round_type: Mapped[str | None] = mapped_column(String(16))
    round_number: Mapped[int | None] = mapped_column(Integer)
    # The resume version interview prep and the copilot use: one of this job's ResumeSnapshot ids, "resume" (the
    # linked resume as it is now), or NULL: the newest version sent, else the linked resume. Not a foreign key: a
    # deleted snapshot just falls back to the default.
    interview_version: Mapped[str | None] = mapped_column(String(36))
    # The likely questions last generated for this job (Resume AI's interview prep, one credit), kept so they're paid
    # for once: {"version_id", "generated_at", "result"} (job_portal/interview.py).
    interview_questions: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    # How it was applied to, when Orbit did it: "orbit_apply" (auto_apply, D84). NULL: by the candidate.
    applied_via: Mapped[str | None] = mapped_column(String(16))


class ResumeSnapshot(TimestampMixin, Base):
    """The resume as it was sent for one tracked job (Job Mission Room): a frozen copy of its content, design and
    ATS score, so "which version did I send?" has an answer after the resume is edited or deleted. Made only when the
    user asks; deleted with the job or the account."""

    __tablename__ = "resume_snapshots"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("job_applications.id", ondelete="CASCADE"), index=True)
    resume_id: Mapped[str | None] = mapped_column(ForeignKey("resumes.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(160))
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    design: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    job_text: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(String(200), default="")


class UserTwoFactor(TimestampMixin, Base):
    """Two-step sign-in (auth/two_factor.py): the authenticator secret, encrypted; on once `enabled_at` is set. The
    last accepted 30-second step stops a code being used twice; recovery codes are kept only as SHA-256 hashes."""

    __tablename__ = "user_two_factor"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    secret_enc: Mapped[str] = mapped_column(Text)
    enabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_step: Mapped[int | None] = mapped_column(BigInteger)
    recovery_hashes: Mapped[list[str] | None] = mapped_column(JSON)


class UserPasskey(TimestampMixin, Base):
    """A passkey (WebAuthn credential) for signing in without a password (auth/passkeys.py). Only the public key is
    kept; the private key never leaves the person's device or password manager. `name` is theirs to set."""

    __tablename__ = "user_passkeys"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    credential_id: Mapped[str] = mapped_column(String(1400), unique=True)  # base64url, as the browser sends it
    public_key: Mapped[bytes] = mapped_column(LargeBinary)
    sign_count: Mapped[int] = mapped_column(BigInteger, default=0)
    transports: Mapped[list[str] | None] = mapped_column(JSON)
    name: Mapped[str] = mapped_column(String(60), default="Passkey")
    backed_up: Mapped[bool] = mapped_column(Boolean, default=False)  # synced (iCloud Keychain, Google…) or one device
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PasskeyChallenge(Base):
    """A WebAuthn challenge Orbit handed out: single use (deleted when used), five minutes. Only its SHA-256 is kept.
    `user_id` is set when adding a passkey; signing in starts without knowing who."""

    __tablename__ = "passkey_challenges"
    challenge_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    purpose: Mapped[str] = mapped_column(String(16))  # register | login
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class UserSession(TimestampMixin, Base):
    """One signed-in device or browser (Settings → Security → Devices). Its id is the token's `sid` claim, kept across
    renewals; signing it out (revoked_at) ends every token that carries it, within the next request. `label` is a
    coarse name from the user agent ("Chrome on Windows"); no IP address is kept."""

    __tablename__ = "user_sessions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="web")  # web | desktop | other
    label: Mapped[str] = mapped_column(String(120), default="")
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class JobPlanCheck(TimestampMixin, Base):
    """One item of a tracked job's interview prep plan (job_portal/plan.py) ticked off by the user. The key names the
    day and the task, so moving the interview date makes a new plan instead of carrying old ticks to new days."""

    __tablename__ = "job_plan_checks"
    __table_args__ = (UniqueConstraint("application_id", "item_key", name="uq_job_plan_checks_item"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("job_applications.id", ondelete="CASCADE"), index=True)
    item_key: Mapped[str] = mapped_column(String(64))


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


# ---- Orbit Apply (orbit_api/auto_apply, docs/DECISIONS.md D84) ----------------------------------------------------


class AutoApplySetup(TimestampMixin, Base):
    """A candidate's Orbit Apply setup: the approved master resume, the facts they confirmed, the filters, the mode
    and the daily limit, and their consent. Nothing is applied for anyone without `consent_at`."""

    __tablename__ = "auto_apply_setups"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    resume_id: Mapped[str | None] = mapped_column(ForeignKey("resumes.id", ondelete="SET NULL"))
    # The master resume's content hash when the candidate approved it: an edit since needs approving again.
    resume_hash: Mapped[str | None] = mapped_column(String(64))
    resume_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    profile: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # auto_apply/setup.py Facts
    filters: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # auto_apply/setup.py Filters
    mode: Mapped[str] = mapped_column(String(12), default="automatic")  # automatic | review
    daily_limit: Mapped[int] = mapped_column(Integer, default=10)
    threshold: Mapped[int] = mapped_column(Integer, default=60)  # the match score a job needs
    ai_line: Mapped[bool] = mapped_column(Boolean, default=True)  # "Prepared with Orbit AI from my verified profile"
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    consent_version: Mapped[str | None] = mapped_column(String(16))
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    # Quiet hours in the candidate's own time (minutes from midnight) and their offset from UTC in minutes.
    quiet_start: Mapped[int | None] = mapped_column(Integer)
    quiet_end: Mapped[int | None] = mapped_column(Integer)
    tz_offset_min: Mapped[int] = mapped_column(Integer, default=0)
    last_planned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # the last "needs you" email
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AnswerBankEntry(TimestampMixin, Base):
    """One answer in a candidate's answer bank: a common screening question (`key`, auto_apply/bank.py) or one a form
    asked that the candidate answered once (`key` "custom", matched by `norm`). Only the candidate writes `value`;
    Orbit's seed rows start empty, except the voluntary self-identification ones, which start as "decline"."""

    __tablename__ = "answer_bank"
    __table_args__ = (UniqueConstraint("user_id", "norm", name="uq_answer_bank_user_norm"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(40))
    norm: Mapped[str] = mapped_column(String(200))  # the key, or a custom question's normalized words
    label: Mapped[str] = mapped_column(String(500))
    kind: Mapped[str] = mapped_column(String(12), default="text")  # text | textarea | yes_no | select | number | date
    value: Mapped[str] = mapped_column(Text, default="")
    legal: Mapped[bool] = mapped_column(Boolean, default=False)  # an attestation: only ever an explicit answer
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ApplicationPacket(TimestampMixin, Base):
    """One prepared application (auto_apply/planner.py): the job, the tailored resume, the cover letter and the form's
    answers, from the candidate's approved data only. The executor (the extension or the Windows app) leases it from
    `GET /v1/apply/next` and reports back; `submitted` is the only status that's charged."""

    __tablename__ = "application_packets"
    __table_args__ = (UniqueConstraint("user_id", "listing_id", name="uq_application_packets_user_listing"),
                      Index("ix_application_packets_user_status", "user_id", "status"),
                      Index("ix_application_packets_ats_result", "ats", "result_at"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    listing_id: Mapped[str] = mapped_column(String(36))
    application_id: Mapped[str | None] = mapped_column(ForeignKey("job_applications.id", ondelete="SET NULL"))
    # needs_answer | review | ready | leased | submitted | needs_you | handoff | failed | skipped | cancelled | expired
    status: Mapped[str] = mapped_column(String(16), default="ready")
    ats: Mapped[str] = mapped_column(String(16))  # greenhouse | lever | ashby | orbit | board | other
    tenant: Mapped[str] = mapped_column(String(160), default="")  # the ATS board: what pacing spaces out
    job_ref: Mapped[str] = mapped_column(String(200), default="")  # the ATS's own job id
    site: Mapped[str | None] = mapped_column(String(40))  # a hand-off's site ("LinkedIn")
    company: Mapped[str] = mapped_column(String(200))
    company_key: Mapped[str] = mapped_column(String(200), index=True)
    title: Mapped[str] = mapped_column(String(300))
    url: Mapped[str] = mapped_column(Text)
    apply_url: Mapped[str] = mapped_column(Text)
    dedupe_key: Mapped[str] = mapped_column(String(300), default="")
    match_score: Mapped[int] = mapped_column(Integer, default=0)
    match_reason: Mapped[str] = mapped_column(String(500), default="")
    resume_title: Mapped[str] = mapped_column(String(160), default="")
    resume_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # the tailored copy
    resume_diff: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    cover_letter: Mapped[str | None] = mapped_column(Text)
    generated: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)  # "why_company", for answering again
    fields: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    answers: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    questions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # the form, as read
    missing: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)  # required, no truthful answer yet
    form_source: Mapped[str] = mapped_column(String(12), default="fetched")  # fetched | standard
    not_before: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    tenant_gap_s: Mapped[int] = mapped_column(Integer, default=300)  # this packet's random 3-8 min spacing
    leased_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    charge: Mapped[str | None] = mapped_column(String(8))  # plan | credit, while leased or once submitted
    result_status: Mapped[str | None] = mapped_column(String(12))
    result_reason: Mapped[str | None] = mapped_column(String(24))
    result_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str] = mapped_column(String(300), default="")  # why it's skipped / needs you, in plain words
    unknown_questions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    confirmation_text: Mapped[str | None] = mapped_column(Text)
    final_url: Mapped[str | None] = mapped_column(Text)
    submitted_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ApplyProof(TimestampMixin, Base):
    """The confirmation screenshot the executor took after submitting (PNG, at most 1.5 MB). Deleted with the packet
    or the account."""

    __tablename__ = "apply_proofs"
    packet_id: Mapped[str] = mapped_column(ForeignKey("application_packets.id", ondelete="CASCADE"),
                                           primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    png: Mapped[bytes] = mapped_column(LargeBinary)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)


class ApplySiteState(Base):
    """The per-site kill switch (greenhouse, lever, ashby): paused by the admin, or automatically for a while when
    too many recent attempts there hit a captcha, a block or a failure."""

    __tablename__ = "apply_site_state"
    site: Mapped[str] = mapped_column(String(16), primary_key=True)
    admin_paused: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_paused_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reason: Mapped[str] = mapped_column(String(300), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
# ---- Orbit for Business (orbit_api/business, D82) ------------------------------------------------------------------
# A company workspace is its own tenant. Every row below carries its company_id and is only ever read through it; a
# candidate's own Orbit data (documents, resumes, sessions, practice, LinkedIn AI) never hangs off these tables: what an
# applicant shares is copied into their application when they apply. Members are Orbit accounts (users.id).


class BizCompany(TimestampMixin, Base):
    __tablename__ = "biz_companies"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    website: Mapped[str] = mapped_column(String(300))
    domain: Mapped[str] = mapped_column(String(253), index=True)
    size: Mapped[str] = mapped_column(String(16), default="1-10")
    country: Mapped[str] = mapped_column(String(2), default="IN")
    about: Mapped[str] = mapped_column(Text, default="")
    logo: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    logo_type: Mapped[str | None] = mapped_column(String(16))
    logo_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")  # active | suspended
    suspended_reason: Mapped[str | None] = mapped_column(String(300))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    verification_method: Mapped[str | None] = mapped_column(String(8))  # email | dns | admin
    # The DNS TXT value to publish (orbit-verify=<token>), and a work-email code waiting: its address, SHA-256, expiry.
    dns_token: Mapped[str] = mapped_column(String(64))
    email_code_to: Mapped[str | None] = mapped_column(String(320))
    email_code_hash: Mapped[str | None] = mapped_column(String(64))
    email_code_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    email_code_tries: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    plan: Mapped[str] = mapped_column(String(16), default="free", server_default="free")  # free | starter | growth
    plan_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    plan_request: Mapped[str | None] = mapped_column(String(16))
    plan_request_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retention_months: Mapped[int] = mapped_column(Integer, default=12, server_default="12")
    blind_review: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    created_by: Mapped[str | None] = mapped_column(String(36))  # no FK: the record outlives the account
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class BizMember(TimestampMixin, Base):
    __tablename__ = "biz_members"
    __table_args__ = (UniqueConstraint("company_id", "user_id", name="uq_biz_members_company_user"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # owner | admin | recruiter | hiring_manager | interviewer


class BizInvite(TimestampMixin, Base):
    __tablename__ = "biz_invites"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320), index=True)
    role: Mapped[str] = mapped_column(String(16))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    invited_by: Mapped[str | None] = mapped_column(String(36))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BizJob(TimestampMixin, Base):
    __tablename__ = "biz_jobs"
    __table_args__ = (UniqueConstraint("company_id", "slug", name="uq_biz_jobs_company_slug"),
                      Index("ix_biz_jobs_status", "status"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"), index=True)
    slug: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(160))
    description_html: Mapped[str] = mapped_column(Text, default="")
    department: Mapped[str] = mapped_column(String(80), default="")
    locations: Mapped[list[str]] = mapped_column(JSON, default=list)
    workplace: Mapped[str] = mapped_column(String(8), default="onsite")
    allowed_countries: Mapped[list[str]] = mapped_column(JSON, default=list)
    employment_type: Mapped[str] = mapped_column(String(16), default="full_time")
    experience: Mapped[str] = mapped_column(String(8), default="mid")
    salary_min: Mapped[int | None] = mapped_column(BigInteger)
    salary_max: Mapped[int | None] = mapped_column(BigInteger)
    salary_currency: Mapped[str] = mapped_column(String(3), default="INR")
    salary_period: Mapped[str] = mapped_column(String(8), default="year")
    show_salary: Mapped[bool] = mapped_column(Boolean, default=True)
    must_haves: Mapped[list[str]] = mapped_column(JSON, default=list)
    nice_to_haves: Mapped[list[str]] = mapped_column(JSON, default=list)
    questions: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    stages: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    hiring_team: Mapped[list[str]] = mapped_column(JSON, default=list)  # user ids
    status: Mapped[str] = mapped_column(String(8), default="draft")  # draft | open | paused | closed
    valid_through: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    taken_down_reason: Mapped[str | None] = mapped_column(String(300))  # the Orbit team took it down
    created_by: Mapped[str | None] = mapped_column(String(36))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class BizApplication(TimestampMixin, Base):
    """One person's application to one job: what they shared (a copy, never a link to their Orbit data), their
    answers and consent, where it is in the pipeline, and the AI ranking with its model version."""

    __tablename__ = "biz_applications"
    __table_args__ = (UniqueConstraint("job_id", "email", name="uq_biz_applications_job_email"),
                      Index("ix_biz_applications_company_status", "company_id", "status"))
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    reference: Mapped[str] = mapped_column(String(12), unique=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("biz_jobs.id", ondelete="CASCADE"), index=True)
    # The Orbit account that applied with one click (SET NULL: deleting the account keeps the company's copy until
    # its retention runs out or the company deletes it). Never exposed to the company.
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(40))
    location: Mapped[str | None] = mapped_column(String(160))
    resume_text: Mapped[str] = mapped_column(Text, default="")
    resume_filename: Mapped[str | None] = mapped_column(String(200))
    resume_source: Mapped[str] = mapped_column(String(16), default="upload")  # upload | orbit_resume | orbit_document
    answers: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    knockout_failed: Mapped[bool] = mapped_column(Boolean, default=False)
    knockout_reasons: Mapped[list[str]] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(16), default="careers")
    # {"notice_version", "accepted_at", "text_sha256"}: what they were told and when they agreed.
    consent: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    email_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # The status page's link token: random per application, looked up by its SHA-256; the raw token is kept only
    # sealed (rules.new_status_token), so later emails can carry the same link.
    status_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    status_token_sealed: Mapped[str | None] = mapped_column(Text)
    # The company's retention when this person applied (the notice they agreed to said it): a later change of the
    # company's setting applies only to later applications.
    retention_months: Mapped[int] = mapped_column(Integer, default=12, server_default="12")
    stage_id: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(10), default="active")  # active | rejected | hired
    stage_changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    interviewers: Mapped[list[str]] = mapped_column(JSON, default=list)  # user ids
    parsed: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    ranking: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
    ranking_status: Mapped[str] = mapped_column(String(8), default="pending")  # pending | done | failed
    ranking_model: Mapped[str | None] = mapped_column(String(120))
    tracker_id: Mapped[str | None] = mapped_column(String(36))  # the candidate's JobApplication row, not an FK
    deletion_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Reminders sent to the company before a requested deletion is carried out by the sweep (0, 1 = 7 days, 2 = 1 day).
    deletion_reminders: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class BizNote(TimestampMixin, Base):
    __tablename__ = "biz_notes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("biz_applications.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[str | None] = mapped_column(String(36))
    author_name: Mapped[str] = mapped_column(String(200), default="")
    body: Mapped[str] = mapped_column(Text)
    mentions: Mapped[list[str]] = mapped_column(JSON, default=list)


class BizScorecard(TimestampMixin, Base):
    __tablename__ = "biz_scorecards"
    __table_args__ = (UniqueConstraint("application_id", "stage_id", "author_id", name="uq_biz_scorecards_one_each"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("biz_applications.id", ondelete="CASCADE"), index=True)
    stage_id: Mapped[str] = mapped_column(String(16))
    author_id: Mapped[str | None] = mapped_column(String(36))
    author_name: Mapped[str] = mapped_column(String(200), default="")
    ratings: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    recommendation: Mapped[str] = mapped_column(String(8))  # hire | no_hire
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class BizEvent(TimestampMixin, Base):
    """An application's timeline (and what analytics counts): applied, moved, rejected, emailed, booked."""

    __tablename__ = "biz_events"
    __table_args__ = (Index("ix_biz_events_application_created", "application_id", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str] = mapped_column(String(36), index=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("biz_applications.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(24))
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    actor_id: Mapped[str | None] = mapped_column(String(36))
    actor_name: Mapped[str | None] = mapped_column(String(200))


class BizInterview(TimestampMixin, Base):
    __tablename__ = "biz_interviews"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[str] = mapped_column(ForeignKey("biz_applications.id", ondelete="CASCADE"), index=True)
    slots: Mapped[list[str]] = mapped_column(JSON, default=list)  # ISO datetimes (UTC)
    duration_min: Mapped[int] = mapped_column(Integer, default=30)
    location: Mapped[str] = mapped_column(String(300), default="")
    chosen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str | None] = mapped_column(String(36))
    reply_to: Mapped[str | None] = mapped_column(String(320))


class BizTemplate(Base):
    __tablename__ = "biz_templates"
    __table_args__ = (UniqueConstraint("company_id", "kind", name="uq_biz_templates_company_kind"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(12))  # received | stage | rejection | interview
    subject: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class BizNotification(TimestampMixin, Base):
    __tablename__ = "biz_notifications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"), index=True)
    application_id: Mapped[str | None] = mapped_column(ForeignKey("biz_applications.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16), default="mention")
    text: Mapped[str] = mapped_column(String(400))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class BizReport(TimestampMixin, Base):
    """'Report this job' from a public page: waits for the Orbit team (fake employers, job scams)."""

    __tablename__ = "biz_reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("biz_jobs.id", ondelete="CASCADE"), index=True)
    reason: Mapped[str] = mapped_column(String(16))
    details: Mapped[str] = mapped_column(Text, default="")
    email: Mapped[str | None] = mapped_column(String(320))
    status: Mapped[str] = mapped_column(String(10), default="open", index=True)  # open | dismissed | actioned


class BizAudit(TimestampMixin, Base):
    """The company's audit log, append-only: business/audit.py refuses updates and deletes of a row through the ORM,
    and no route edits it. It names applicants by reference only, so deleting an applicant leaves no personal data
    here."""

    __tablename__ = "biz_audit"
    __table_args__ = (Index("ix_biz_audit_company_created", "company_id", "created_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    company_id: Mapped[str] = mapped_column(ForeignKey("biz_companies.id", ondelete="CASCADE"))
    actor_id: Mapped[str | None] = mapped_column(String(36))
    actor_name: Mapped[str | None] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(48))
    target: Mapped[str | None] = mapped_column(String(200))
    detail: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)

