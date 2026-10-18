"""Account-wide actions that both the account's owner (auth/routes.py) and the admin (admin/accounts.py) take: stopping
the account's live work, signing it out everywhere, and deleting it. One copy, so the admin's delete can't drift from
the owner's."""

from datetime import UTC, datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import jobs
from orbit_api.auth import email_tokens
from orbit_api.models import (
    AuditLog,
    ContactMessage,
    CreditEntry,
    LiveSessionRow,
    ProviderRequest,
    SupportMessage,
    SupportThread,
    User,
    UserPasskey,
    UserTwoFactor,
)
from orbit_api.sessions.routes import stop_live, stop_user_live


async def forget_unproven_sign_ins(db: AsyncSession, user_id: str) -> int:
    """Passkeys and two-step sign-in set up on the account before its inbox was ever proven. Called when the inbox is
    proven for the first time by someone who didn't know the password (a reset link, or Google claiming the address):
    whoever registered the address before them could otherwise keep a passkey (which signs in without the password)
    or an authenticator (which would lock the real owner out). Caller commits. Returns how many were removed."""
    passkeys = await db.execute(delete(UserPasskey).where(UserPasskey.user_id == user_id))
    second = await db.execute(delete(UserTwoFactor).where(UserTwoFactor.user_id == user_id))
    return int(getattr(passkeys, "rowcount", 0) or 0) + int(getattr(second, "rowcount", 0) or 0)


async def stop_account_live(db: AsyncSession, user_id: str) -> None:
    """Every session of the account that hasn't ended stops for real, as End does (its engine tells the client
    `session.ended`, records its usage and closes the socket; a dropped connection's saved state goes too), and every
    phone-share code. Otherwise an engine kept streaming (and metering) STT and the LLM for an account that is gone
    or suspended."""
    for session_id in (await db.scalars(select(LiveSessionRow.id).where(
            LiveSessionRow.user_id == user_id, LiveSessionRow.status != "ended"))).all():
        await stop_live(user_id, session_id)
    await stop_user_live(user_id)


async def end_live_sessions(db: AsyncSession, user_id: str) -> None:
    """`stop_account_live`, then every session still marked live (a dropped connection whose saved state waits for a
    reconnect) ends as End would: nothing can continue it, and its report is written. Commits (the report jobs are
    queued after, each on its own, so one the recorder queued meanwhile isn't a conflict)."""
    await stop_account_live(db, user_id)
    # One conditional UPDATE, not loaded rows: a dropped connection's teardown may be saving its state onto the row
    # right now, and only writes while the row isn't ended.
    ended = list((await db.scalars(
        update(LiveSessionRow).where(LiveSessionRow.user_id == user_id, LiveSessionRow.status == "live")
        .values(status="ended", ended_at=func.coalesce(LiveSessionRow.ended_at, datetime.now(UTC)), carryover=None)
        .returning(LiveSessionRow.id))).all())
    await db.commit()
    for session_id in ended:
        await jobs.enqueue_now("report", {"session_id": session_id}, jobs.report_key(session_id))


async def sign_out_everywhere(db: AsyncSession, user: User) -> None:
    """Every session ends (web, desktop, a live session streaming somewhere, a phone following it) and every unused
    emailed link stops working: tokens carry `token_version`, so bumping it makes every one of them dead. Caller
    commits."""
    user.token_version += 1
    await email_tokens.revoke_all(db, user.id)
    await stop_user_live(user.id)


async def delete_account(db: AsyncSession, user: User, audit: AuditLog) -> None:
    """Deletes the account and, via ON DELETE CASCADE, every document, session, resume, story, workspace, job-search
    row, usage row and emailed link, after stopping its live work. Callers check who may do it first. Commits.

    - support chats (deleted here, with their messages and the Inbox ticket each "talk to a person" made, which is
      a copy of the chat): they name the person and keep what they wrote. Messages typed on the Contact page are
      the sender's own correspondence and stay without the account link (ContactMessage).
    Kept on purpose, with nothing personal left in them:
    - payments (ON DELETE SET NULL): the revenue history and each UTR's unique row stay, so a transfer can't be
      submitted again from a new account;
    - credit entries and free-AI uses (no foreign key): a welcome grant's network and inbox hashes must outlive the
      account, or deleting it and signing up again would hand out another. The admin's notes on them are cleared;
    - the audit trail (no foreign key) loses its IP addresses, and provider-cost rows the link to the account (the
      cost totals stay right).
    `audit` records the deletion itself; it outlives the account too."""
    user_id = user.id
    await stop_account_live(db, user_id)
    # Support chats name the person and keep what they wrote. The account asked to be deleted, so the chats go too.
    thread_ids = select(SupportThread.id).where(SupportThread.user_id == user_id)
    # The Inbox copy of each chat goes with it, in this transaction (the foreign key also cascades; this doesn't
    # rely on it).
    await db.execute(delete(ContactMessage).where(ContactMessage.source_support_thread_id.in_(thread_ids)))
    await db.execute(delete(SupportMessage).where(SupportMessage.thread_id.in_(thread_ids)))
    await db.execute(delete(SupportThread).where(SupportThread.user_id == user_id))
    # Orbit for Business: a company this account owns passes to another member, or goes if nobody's left (D82).
    from orbit_api.business.companies import hand_over_on_account_deletion

    await hand_over_on_account_deletion(db, user_id)
    await db.delete(user)
    await db.execute(update(AuditLog).where(AuditLog.user_id == user_id).values(ip=None))
    await db.execute(update(ProviderRequest).where(ProviderRequest.user_id == user_id).values(user_id=None))
    await db.execute(update(CreditEntry).where(CreditEntry.user_id == user_id).values(note=None))
    db.add(audit)
    await db.commit()
