"""Referrals: invite links, and the admin's creator and campus codes (docs/BILLING.md "Referrals", DECISIONS D61).
All of it is behind ORBIT_REFERRALS, off by default: off, nothing is attributed, discounted or rewarded, and the
user endpoints answer 404 (the admin can still make codes).

- **Invite links.** Every account can have one invite code (`ReferralCode`, kind "invite", made the first time it
  opens Invite friends) and a link to it, `<web>/r/<code>`. The web app keeps the code first-party (localStorage and a
  cookie) until sign-up, with a password or with Google, and the new account is attributed to it: one `Referral` per
  account, for good.
- **The discount.** An attributed account's first purchase is ORBIT_REFERRAL_DISCOUNT_PERCENT (10) off, or a creator's
  or campus code's own discount. It's taken off the order's amount here, on the server, in rupees or dollars alike
  (`discounted`), and the order keeps the code and what was taken off. It applies to orders made before the first
  payment lands.
- **The reward.** When the account's first payment is approved (`on_paid`, from settle.grant: the checkout, the
  webhook, the reconciler or the admin's UPI approval, under the conditional update that approves a payment once,
  in the same transaction), the inviter gets ORBIT_REFERRAL_REWARD_MINUTES (30) interview minutes, at most
  ORBIT_REFERRAL_MONTHLY_CAP (10) rewards a calendar month (UTC). The referral row is claimed with a conditional
  update too, so two payments landing at once reward once.
- **Abuse.** No invite to the inviter's own account, inbox (the welcome's inbox hash, so a+1@gmail.com is a@gmail.com),
  network (the networks the inviter signed up or signed in from, and their welcome's) or to someone they were invited
  by. One attribution per account and per inbox: the row has no foreign key, so it outlives a deleted account and
  the same inbox can't be invited again. Orbit records no device fingerprint, so none is compared. A refund or a
  chargeback of the rewarded payment takes back the minutes the inviter hasn't used yet, and the referral is flagged
  for the admin (`on_refund`).
- **Creator and campus codes.** Made by the admin with a label, a discount, a commission (for the report only: payouts
  are by hand), and optionally an expiry and a cap on uses (paying accounts). A buyer can enter one, or a friend's
  invite code, at checkout until their first payment; it becomes their attribution. Codes are matched without regard
  to case or spaces.
"""

import logging
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from orbit_api import credits
from orbit_api.billing import pricing
from orbit_api.config import get_settings
from orbit_api.models import AuditLog, CreditEntry, Payment, Referral, ReferralCode, User
from orbit_api.notices import credits_line, notify, send_after_commit
from orbit_api.providers.email import OutgoingEmail
from orbit_api.transactions import lock_account

log = logging.getLogger(__name__)

INVITE, CREATOR, CAMPUS = "invite", "creator", "campus"
# The first-party cookie the web app keeps a link's code in until sign-up (it also sends it with the sign-up).
REF_COOKIE = "orbit_ref"
Kind = Literal["invite", "creator", "campus"]
# What a referral is now: joined (attributed, not paid yet) → rewarded (an invite: the inviter got their minutes) |
# capped (an invite past the inviter's monthly cap) | paid (a creator or campus code, or an inviter who is gone), or
# blocked (an invite to the inviter's own account, inbox or network: no discount, no reward).
JOINED, REWARDED, CAPPED, PAID, BLOCKED = "joined", "rewarded", "capped", "paid", "blocked"
PAYING = (REWARDED, CAPPED, PAID)
# The ledger's reasons (CreditEntry.reason) for an inviter's minutes, and for taking unused ones back after a refund.
REWARD, REWARD_BACK = "referral", "referral_back"
# Sign-ins whose networks count as the inviter's own (AuditLog.ip), the most recent first.
_SIGN_INS = ("auth.register", "auth.google_register", "auth.login", "auth.login_2fa", "auth.login_passkey",
             "auth.google", "auth.google_claim")
_NETWORKS_CHECKED = 50
# Invite codes: 8 characters without the ones that read alike (0/O, 1/I/L).
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
_CODE = re.compile(r"[A-Z0-9][A-Z0-9_-]{2,31}")


def enabled() -> bool:
    return get_settings().referrals


def normalize(raw: str | None) -> str | None:
    """A code as typed or carried in a link, the way it's stored (upper case, no spaces); None if it can't be one."""
    code = re.sub(r"\s+", "", raw or "").upper()
    return code if _CODE.fullmatch(code) else None


def link(code: str) -> str:
    return f"{get_settings().web_url.rstrip('/')}/r/{code}"


def discounted(cost: pricing.Price, percent: int) -> tuple[pricing.Price, int]:
    """`cost` with `percent` off, and how much that is in its minor unit. Rupees stay whole rupees and dollars whole
    cents, each rounded down (the buyer never gets less than the percent off). A dollar sale's rupee equivalent
    follows."""
    if percent <= 0:
        return cost, 0
    if cost.currency == pricing.INR:
        rupees = cost.inr * (100 - percent) // 100
        return pricing.Price(pricing.INR, rupees * 100, rupees), cost.minor - rupees * 100
    cents = cost.minor * (100 - percent) // 100
    return (pricing.Price(cost.currency, cents, round(cents / 100 * get_settings().usd_inr_rate)),
            cost.minor - cents)


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(d: datetime) -> datetime:
    return d if d.tzinfo else d.replace(tzinfo=UTC)


def _month_start(now: datetime) -> datetime:
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def percent_of(code: ReferralCode) -> int:
    """The discount a code gives: its own, or (an invite code) the configured one."""
    return code.discount_percent if code.discount_percent is not None else get_settings().referral_discount_percent


async def invite_code(db: AsyncSession, user: User) -> ReferralCode:
    """The account's own invite code, made the first time it's asked for. Commits when it makes one."""
    uid = user.id  # a rollback expires `user`
    mine = select(ReferralCode).where(ReferralCode.owner_user_id == uid)
    for _ in range(5):
        found: ReferralCode | None = await db.scalar(mine)
        if found is not None:
            return found
        db.add(ReferralCode(code="".join(secrets.choice(_ALPHABET) for _ in range(8)), kind=INVITE, owner_user_id=uid))
        try:
            await db.commit()
        except IntegrityError:  # the code is taken, or this account's code was made a moment ago in another tab
            await db.rollback()
    made: ReferralCode | None = await db.scalar(mine)
    if made is None:
        raise RuntimeError("couldn't make an invite code")
    return made


async def find(db: AsyncSession, raw: str | None) -> ReferralCode | None:
    code = normalize(raw)
    return await db.scalar(select(ReferralCode).where(ReferralCode.code == code)) if code else None


async def paying_accounts(db: AsyncSession, code_id: str) -> int:
    """How many accounts that came with this code have paid: a code's uses, against its `max_uses`."""
    return int(await db.scalar(select(func.count()).select_from(Referral).where(
        Referral.code_id == code_id, Referral.status.in_(PAYING))) or 0)


async def problem(db: AsyncSession, code: ReferralCode, now: datetime | None = None) -> str | None:
    """Why a code can't be used right now, in words for the buyer; None when it can."""
    now = now or _now()
    if not code.active:
        return "That code isn't active any more."
    if code.expires_at is not None and _aware(code.expires_at) <= now:
        return f"That code expired on {_aware(code.expires_at):%d %b %Y}."
    if code.max_uses is not None and await paying_accounts(db, code.id) >= code.max_uses:
        return "That code has been used as many times as it can be."
    if code.kind == INVITE:
        owner = await db.get(User, code.owner_user_id) if code.owner_user_id else None
        if owner is None or owner.suspended_at is not None:
            return "That code isn't active any more."
    return None


async def _networks(db: AsyncSession, user_id: str) -> set[str]:
    """The networks (keyed hashes, as credits.ip_hash) an account signed up or recently signed in from."""
    ips = (await db.scalars(select(AuditLog.ip).where(
        AuditLog.user_id == user_id, AuditLog.action.in_(_SIGN_INS), AuditLog.ip.is_not(None))
        .order_by(AuditLog.created_at.desc()).limit(_NETWORKS_CHECKED))).all()
    found = {credits.ip_hash(ip) for ip in ips if ip}
    welcome = (await db.scalars(select(CreditEntry.ip_hash).where(
        CreditEntry.user_id == user_id, CreditEntry.reason == "welcome", CreditEntry.ip_hash.is_not(None)))).all()
    return found | {h for h in welcome if h}


async def _self_invite(db: AsyncSession, user: User, inviter: User, ip: str | None) -> str | None:
    """Why an invite from `inviter` to `user` is the same person (or a pair farming each other), or None."""
    if inviter.id == user.id:
        return "own_code"
    if credits.email_hash(inviter.email) == credits.email_hash(user.email):
        return "same_inbox"
    if ip and credits.ip_hash(ip) in await _networks(db, inviter.id):
        return "same_network"
    theirs = await db.scalar(select(Referral.referrer_user_id).where(Referral.user_id == inviter.id))
    if theirs == user.id:
        return "mutual"
    return None


async def has_paid(db: AsyncSession, user_id: str) -> bool:
    return bool(await db.scalar(select(func.count()).select_from(Payment).where(
        Payment.user_id == user_id, Payment.status == "approved")))


class CodeRefused(Exception):
    """A code entered at checkout that can't be used, with the reason in words for the buyer."""


async def attribute(db: AsyncSession, user: User, raw: str | None, ip: str | None,
                    via: Literal["signup", "checkout"]) -> Referral:
    """Attributes the account to a code. Stages the row (the caller commits) and returns it; raises CodeRefused,
    saying why, when it can't be used. An invite to the inviter's own account, inbox or network is kept as
    `blocked` (no discount, no reward) at sign-up, for the admin to see, and refused at checkout."""
    code = await find(db, raw)
    if code is None:
        raise CodeRefused("We couldn't find that code. Check the spelling and try again.")
    why = await problem(db, code)
    if why:
        raise CodeRefused(why)
    existing = await db.scalar(select(Referral).where(Referral.user_id == user.id))
    if existing is not None and existing.code_id == code.id and existing.status != BLOCKED:
        return existing  # entered again: already this account's code
    if existing is not None and existing.status != BLOCKED:
        raise CodeRefused("This account already has a code. One code per account.")
    if via == "checkout" and await has_paid(db, user.id):
        raise CodeRefused("Codes are for a first purchase, and this account has paid before.")
    inbox = credits.email_hash(user.email)
    other = await db.scalar(select(Referral.id).where(Referral.email_hash == inbox, Referral.user_id != user.id)
                            .limit(1))
    reason: str | None = "same_inbox" if other is not None else None
    inviter = await db.get(User, code.owner_user_id) if code.kind == INVITE and code.owner_user_id else None
    if reason is None and inviter is not None:
        reason = await _self_invite(db, user, inviter, ip)
    if reason == "own_code":
        raise CodeRefused("That's your own invite code. Share it with friends instead.")
    if reason is not None and via == "checkout":
        raise CodeRefused("That code can't be used on this account.")
    row = existing or Referral(user_id=user.id)
    row.code_id, row.kind, row.referrer_user_id = code.id, code.kind, inviter.id if inviter else None
    row.status, row.reason, row.via = (BLOCKED if reason else JOINED), reason, via
    row.email_hash, row.ip_hash = inbox, credits.ip_hash(ip) if ip else None
    if existing is None:
        db.add(row)
    return row


async def attribute_signup(db: AsyncSession, user: User, raw: str | None, ip: str | None) -> None:
    """A new account, from a link: attributed to the code if it can be, silently not if it can't (a stale link
    mustn't stop a sign-up). Staged; the sign-up commits it."""
    if not (enabled() and raw):
        return
    try:
        await attribute(db, user, raw, ip, "signup")
    except CodeRefused as e:
        log.info("sign-up code %r not attributed: %s", normalize(raw), e)


# The offer every account's first purchase has (ORBIT_FIRST_PURCHASE_PERCENT), with no code behind it.
FIRST = "first"


@dataclass(frozen=True)
class Offer:
    """A first-purchase discount the account has: its code (none for the offer everyone gets), and the percent off."""

    code_id: str | None
    code: str | None
    kind: str
    label: str | None
    percent: int


async def _code_offer(db: AsyncSession, user: User) -> Offer | None:
    if not enabled():
        return None
    ref = await db.scalar(select(Referral).where(Referral.user_id == user.id))
    if ref is None or ref.status != JOINED or ref.code_id is None:
        return None
    code = await db.get(ReferralCode, ref.code_id)
    if code is None or await problem(db, code):
        return None
    return Offer(code.id, code.code, code.kind, code.label, percent_of(code))


async def offer_for(db: AsyncSession, user: User | None) -> Offer | None:
    """The discount this account's next order gets, if any, until its first payment: its code's (it's attributed and
    the code still works) or the first-purchase offer everyone gets, whichever is more; never both. `percent` can be
    0 (a code the admin made for attribution only, with the offer off); callers take off only a real one."""
    if user is None or await has_paid(db, user.id):
        return None
    coded = await _code_offer(db, user)
    everyone = get_settings().first_purchase_percent
    if everyone > 0 and (coded is None or coded.percent < everyone):
        return Offer(None, None, FIRST, None, everyone)
    return coded


async def on_paid(db: AsyncSession, user: User, p: Payment) -> None:
    """The account's payment `p` was just approved (settle.grant; staged, the caller commits). If it's the first one
    of an attributed account, the referral is claimed by it, once, and an inviter gets their minutes (unless they're
    past this month's cap)."""
    if not enabled():
        return
    ref = await db.scalar(select(Referral).where(Referral.user_id == user.id))
    if ref is None or ref.status != JOINED:
        return
    now = _now()
    # A payment approved while referrals were off was the first one: this isn't, so it claims nothing to reward.
    earlier = await db.scalar(select(func.count()).select_from(Payment).where(
        Payment.user_id == user.id, Payment.status == "approved", Payment.id != p.id))
    claimed = await db.execute(update(Referral).where(Referral.id == ref.id, Referral.status == JOINED)
                               .values(status=PAID, first_payment_id=p.id, paid_at=now,
                                       reason="paid_before" if earlier else None))
    if claimed.rowcount != 1:  # type: ignore[attr-defined]
        return  # another payment of this account claimed it a moment ago
    s = get_settings()
    inviter = await db.get(User, ref.referrer_user_id) if ref.kind == INVITE and ref.referrer_user_id else None
    if earlier or inviter is None or inviter.suspended_at is not None or s.referral_reward_minutes <= 0:
        return
    # One inviter's rewards are counted and given one at a time, so ten friends paying at once can't pass the cap.
    await lock_account(db, inviter.id)
    given = await db.scalar(select(func.count()).select_from(Referral).where(
        Referral.referrer_user_id == inviter.id, Referral.status == REWARDED, Referral.paid_at >= _month_start(now)))
    if (given or 0) >= s.referral_monthly_cap:
        await db.execute(update(Referral).where(Referral.id == ref.id).values(status=CAPPED))
        return
    seconds = s.referral_reward_minutes * 60
    entry = credits.add(db, inviter.id, "interview_seconds", seconds, REWARD)
    entry.note = "A friend you invited made their first payment"
    minutes = s.referral_reward_minutes
    notify(db, inviter.id, "referral", f"You've got {credits_line(0, minutes)}",
           "A friend you invited made their first payment. Thank you for sharing Orbit.", "/billing")
    web = get_settings().web_url.rstrip("/")
    send_after_commit(db, OutgoingEmail(
        to=inviter.email, subject=f"You've got {credits_line(0, minutes)} on Orbit",
        text=(f"Hi {inviter.name or 'there'},\n\nA friend you invited to Orbit made their first payment, so we added "
              f"{credits_line(0, minutes)} to your account. They never expire. Thank you for sharing Orbit."
              f"\n\nSee your balance: {web}/billing")))
    await db.execute(update(Referral).where(Referral.id == ref.id).values(status=REWARDED, reward_seconds=seconds))
    db.add(AuditLog(user_id=inviter.id, action="referral.reward",
                    target=f"{inviter.id} +{s.referral_reward_minutes} min for {ref.id} (payment {p.id})"))


async def on_refund(db: AsyncSession, p: Payment) -> None:
    """A refund or chargeback of `p` went through (settle._refresh_refunded; staged, the caller commits). If `p` was
    the first payment of a referred account, the referral is flagged for the admin, once; if it earned an inviter
    their minutes, the ones they haven't used yet are taken back."""
    if not p.refunded_paise:
        return
    ref = await db.scalar(select(Referral).where(Referral.first_payment_id == p.id))
    if ref is None or ref.clawed_back_at is not None:
        return
    claimed = await db.execute(update(Referral).where(Referral.id == ref.id, Referral.clawed_back_at.is_(None))
                               .values(clawed_back_at=_now()))
    if claimed.rowcount != 1:  # type: ignore[attr-defined]
        return
    refunded = pricing.money(pricing.payment_currency(p), p.refunded_paise)
    if ref.status != REWARDED or not ref.reward_seconds or not ref.referrer_user_id:
        await db.execute(update(Referral).where(Referral.id == ref.id)
                         .values(flag=f"First payment refunded ({refunded})"))
        return
    inviter_id = ref.referrer_user_id
    await lock_account(db, inviter_id)
    granted, used = await credits.interview_seconds(db, inviter_id)
    take = min(ref.reward_seconds, max(int(granted - used), 0))
    if take:
        entry = credits.add(db, inviter_id, "interview_seconds", -take, REWARD_BACK)
        entry.note = "Taken back: the invited friend's payment was refunded"
    kept = ref.reward_seconds - take
    flag = (f"First payment refunded ({refunded}): took back {take // 60} of {ref.reward_seconds // 60} reward "
            f"minutes" + (f"; {kept // 60} were already used" if kept else ""))
    await db.execute(update(Referral).where(Referral.id == ref.id).values(clawback_seconds=take, flag=flag[:200]))
    db.add(AuditLog(user_id=inviter_id, action="referral.clawback", target=f"{inviter_id} -{take // 60} min {ref.id}"))


@dataclass(frozen=True)
class InviteStats:
    joined: int  # accounts that came with the code (not counting blocked ones)
    paid: int  # of them, how many have paid
    minutes_earned: int  # reward minutes, less any taken back after a refund
    rewards_this_month: int


async def invite_stats(db: AsyncSession, user_id: str) -> InviteStats:
    rows = (await db.execute(select(Referral.status, Referral.reward_seconds, Referral.clawback_seconds,
                                    Referral.paid_at).where(Referral.referrer_user_id == user_id))).all()
    month = _month_start(_now())
    return InviteStats(
        joined=sum(1 for st, *_ in rows if st != BLOCKED),
        paid=sum(1 for st, *_ in rows if st in PAYING),
        minutes_earned=sum((r or 0) - (c or 0) for _, r, c, _ in rows) // 60,
        rewards_this_month=sum(1 for st, _, _, at in rows if st == REWARDED and at and _aware(at) >= month))
