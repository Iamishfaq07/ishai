"""Exact support answers. No model. Prices match docs/BILLING.md.

A tap sends a topic id. Typed questions hit the first specific phrase, never a loose word like "payment".
"""

import re
from dataclasses import dataclass
from typing import Any

GREETING = (
    "Hi, I'm Orbit's support bot. Pick a topic below, or type a question. "
    "I only answer what I'm sure about. Tap Talk to a person if you need the team."
)

HANDOFF = (
    "A person on the Orbit team has this chat now. Reply here and they'll see it. "
    "If you close this, a red dot on the chat icon means they replied."
)

UNKNOWN = "I don't have a sure answer for that. Pick a topic below, or tap Talk to a person."

MENU_LINE = "Pick a topic. These answers are exact."


@dataclass(frozen=True)
class Topic:
    id: str
    label: str
    answer: str
    phrases: tuple[str, ...]
    next_ids: tuple[str, ...] = ()
    on_menu: bool = False


_TOPICS: tuple[Topic, ...] = (
    Topic(
        "prices",
        "Prices",
        "Start free: a new account gets 20 interview minutes and 1 Resume AI credit. Then either buy credits "
        "(1 interview credit = 1 hour, they never expire): 1 credit ₹2,299, 3 credits ₹3,599, 8 credits ₹7,199, "
        "15 credits ₹10,899, or AI credits ₹499 for Resume AI alone. Or go unlimited: ₹4,799 a week, "
        "₹9,199 a month or ₹35,999 a year. Nothing renews automatically.",
        ("price", "prices", "how much", "pack", "rupee", "₹", "cost", "plan", "unlimited"),
        ("welcome", "mini", "starter", "plus", "pro", "unlimited", "what_spends"),
        True,
    ),
    Topic(
        "welcome",
        "New account",
        "A new account gets 20 interview minutes and 1 Resume AI credit. They never expire. "
        "One welcome per network every 30 days, so a second account on the same internet connection can start at "
        "zero. It can still buy credits.",
        ("welcome", "new account", "free account", "20 interview", "20 minutes"),
        ("prices", "what_spends", "buy"),
    ),
    Topic(
        "mini",
        "AI credits ₹499",
        "AI credits is ₹499 for 25 Resume AI credits (a single AI fix uses a fifth of one). No interview time. They "
        "never expire and nothing renews.",
        ("ai credits", "mini", "₹499", "499"),
        ("starter", "what_spends", "buy"),
    ),
    Topic(
        "starter",
        "1 or 3 credits",
        "1 interview credit is 1 hour of live or mock interviews. 1 credit is ₹2,299 (with 10 Resume AI credits); 3 "
        "credits are ₹3,599 (with 30 Resume AI credits). They never expire and nothing renews.",
        ("starter", "3 credits", "1 credit", "₹3,599", "3599", "₹2,299", "2299"),
        ("mini", "plus", "buy"),
    ),
    Topic(
        "plus",
        "8 credits ₹7,199",
        "8 credits are ₹7,199: 6 interview credits plus 2 free, so 8 hours of interviews, and 80 Resume AI credits. "
        "They never expire and nothing renews.",
        ("plus pack", "8 credits", "₹7,199", "7199", "7,199"),
        ("starter", "pro", "buy"),
    ),
    Topic(
        "pro",
        "15 credits ₹10,899",
        "15 credits are ₹10,899: 9 interview credits plus 6 free, so 15 hours of interviews, and 150 Resume AI "
        "credits. They never expire and nothing renews.",
        ("pro pack", "15 credits", "₹10,899", "10899", "10,899"),
        ("plus", "unlimited", "buy"),
    ),
    Topic(
        "unlimited",
        "Unlimited plans",
        "Unlimited is ₹4,799 for a week, ₹9,199 for a month or ₹35,999 for a year, paid once (it never renews by "
        "itself). It includes unlimited Resume AI and, every 30 days, up to 50 hours of live interview help and 25 "
        "hours of mock and video interviews (fair use), with unlimited screenshots and documents.",
        ("unlimited", "weekly", "monthly", "yearly", "subscription", "₹9,199", "₹35,999", "₹4,799"),
        ("prices", "pro", "buy"),
    ),
    Topic(
        "what_spends",
        "What spends a credit",
        "Interview minutes pay for live sessions and mock practice. "
        "Resume credits pay for import, rewrite, tailor, a cover letter, interview questions, a profile, or a message. "
        "Typing, the ATS score, templates, and downloads are free. A failed AI call gives the credit back.",
        ("what spends", "what uses", "resume credit", "interview minute"),
        ("prices", "resume", "practice"),
    ),
    Topic(
        "buy",
        "How to pay",
        "Buy on Plan & billing. If Razorpay is on, pay by card, UPI, or netbanking and the credits land as soon as "
        "it goes through. "
        "If it isn't, pay the UPI ID shown there and paste the 12-digit UTR. A person checks that UTR before the "
        "credits land.",
        ("how to pay", "how do i pay", "how do i buy", "buy a pack", "buy credits", "where to pay"),
        ("razorpay", "upi", "utr", "missing"),
        True,
    ),
    Topic(
        "razorpay",
        "Card, UPI, netbanking",
        "Tap Buy on Plan & billing. Razorpay takes a card, UPI, or netbanking, and the credits are added the moment "
        "the payment succeeds. "
        "You do not paste a UTR for this. If you closed the page early, refresh Plan & billing. The payment can "
        "still land.",
        ("razorpay", "netbanking", "debit card", "credit card"),
        ("missing", "upi", "prices"),
    ),
    Topic(
        "upi",
        "Pay by UPI ID",
        "Manual UPI is only when Razorpay is not offered. Plan & billing shows a UPI ID, a QR, and a reference like "
        "ORB…. "
        "Pay that exact amount from GPay, PhonePe, or Paytm, then paste the 12-digit UTR on the billing page. "
        "A person matches it and adds the credits. A UTR can be used once.",
        ("upi", "upi id", "gpay", "phonepe", "paytm", "qr code"),
        ("utr", "missing", "razorpay"),
    ),
    Topic(
        "utr",
        "Where is the UTR",
        "The UTR is the 12-digit number your UPI app shows after you pay. Paste it on Plan & billing. "
        "Orbit never asks for your UPI PIN. If the credits are still missing after a few hours, tap Talk to a person "
        "and send the UTR.",
        ("utr", "12-digit", "12 digit"),
        ("missing", "upi", "refund"),
    ),
    Topic(
        "missing",
        "Payment didn't land",
        "Paid with Razorpay? Refresh Plan & billing. The credits should already be there. "
        "Paid the UPI ID? Paste the 12-digit UTR on that page and wait for a person to approve it. "
        "Still missing? Tap Talk to a person and include the pack, plus the UTR or the email on the payment.",
        ("didn't land", "did not land", "not credited", "not showing", "payment failed", "hasn't arrived",
         "has not arrived", "where are my credits", "credits not", "didn't work", "did not work"),
        ("razorpay", "utr", "refund"),
        True,
    ),
    Topic(
        "refund",
        "Refund",
        "A refund is not automatic from this chat. Tap Talk to a person and include the pack you bought. "
        "If you paid the UPI ID by hand, include the 12-digit UTR too.",
        ("refund",),
        ("missing", "buy"),
        True,
    ),
    Topic(
        "windows",
        "Windows app",
        "The live copilot is the Windows app. While signed in, open Me, then Windows app, and download it. "
        "The website is for Resume AI, Jobs AI, practice, and your account. Sign in to the app with the same email.",
        ("windows", "desktop", "windows app", "download the app"),
        ("practice", "signin"),
        True,
    ),
    Topic(
        "resume",
        "Resume AI",
        "Resume AI scores how well screening software can read your resume, and can tailor a copy to one job. "
        "You see every change before it is kept. Typing and the ATS score are free. "
        "Import, rewrite, tailor, and cover letters each use 1 Resume AI credit.",
        ("resume", "ats", "tailor", "cover letter"),
        ("what_spends", "jobs", "prices"),
        True,
    ),
    Topic(
        "jobs",
        "Jobs AI",
        "Jobs AI matches roles to your profile, checks fit against your resume, and keeps a tracker. "
        "Fit checks are free up to a daily limit. Outreach writes one note for a job you choose.",
        ("jobs", "job tracker", "outreach", "fit check"),
        ("resume", "practice"),
        True,
    ),
    Topic(
        "practice",
        "Practice and live",
        "A mock is practice: Orbit asks, you answer out loud. A live session is the copilot during a real call, in "
        "the Windows app. "
        "Both use interview minutes. One live session at a time. On the free credit balance, one session can last up "
        "to 60 minutes.",
        ("mock", "practice", "copilot", "live session", "live interview"),
        ("windows", "what_spends", "prices"),
        True,
    ),
    Topic(
        "signin",
        "Sign in",
        "Sign in with your email, or Continue with Google. Google on an email you already used opens that account. "
        "If that email was never confirmed, the old password stops working; set a new one in Settings. "
        "If the page sends you back to login, reload once. "
        "Forgot password sends a reset link from the sign-in page. Check spam. "
        "A new account may need that email confirmed before some actions. Google accounts are already confirmed.",
        ("sign in", "signin", "login", "log in", "password", "verify email", "verification email", "google"),
        ("windows", "welcome"),
        True,
    ),
)

TOPICS: dict[str, Topic] = {t.id: t for t in _TOPICS}
# Specific packs and problems before the broad "prices" phrases.
_MATCH_ORDER: tuple[str, ...] = (
    "mini", "starter", "plus", "pro", "refund", "utr", "missing", "razorpay", "upi",
    "what_spends", "welcome", "windows", "signin", "resume", "jobs", "practice", "buy", "prices",
)

_HUMAN = ("human", "Talk to a person")
_MENU = ("menu", "All topics")
_HELPED = ("helped", "That helped")
_ACCOUNT = (("balance", "My balance"), ("payment", "My last payment"))
_GREETING = re.compile(r"(hi|hello|hey|help|thanks|thank you|menu)[.!? ]*")


def _norm(text: str) -> str:
    return " ".join(text.lower().split())


def _hit(q: str, phrase: str) -> bool:
    if " " in phrase or any(ch.isdigit() for ch in phrase) or phrase.startswith("₹"):
        return phrase in q
    return re.search(rf"\b{re.escape(phrase)}\b", q) is not None


def match(text: str) -> Topic | None:
    """The one topic a typed question is about, or None."""
    q = _norm(text)
    if not q:
        return None
    for topic_id in _MATCH_ORDER:
        topic = TOPICS[topic_id]
        if q == topic.label.lower() or any(_hit(q, phrase) for phrase in topic.phrases):
            return topic
    return None


def lookup(text: str) -> str | None:
    """A known answer, or None. A greeting returns the hello, not a topic."""
    q = _norm(text)
    if _GREETING.fullmatch(q):
        return GREETING
    found = match(text)
    return found.answer if found else None


def options_for(topic_id: str | None) -> list[tuple[str, str]]:
    """Follow-up chips: (id, label). `human` is the handoff, not an answer."""
    if topic_id in (None, "menu"):
        rows = [(t.id, t.label) for t in _TOPICS if t.on_menu]
        rows.append(_HUMAN)
        return rows
    topic = TOPICS[topic_id]
    rows = [(TOPICS[i].id, TOPICS[i].label) for i in topic.next_ids]
    rows.append(_MENU)
    rows.append(_HELPED)
    rows.append(_HUMAN)
    return rows


def option_label(choice: str) -> str | None:
    if choice == "menu":
        return "All topics"
    if choice == "helped":
        return "That helped"
    for topic_id, label in _ACCOUNT:
        if choice == topic_id:
            return label
    topic = TOPICS.get(choice)
    return topic.label if topic else None


def account_choice(text: str, choice: str = "") -> str | None:
    """A question about this person's own account, or None. Not the general price or 'payment didn't land' notes."""
    if choice in {"balance", "payment"}:
        return choice
    q = _norm(text)
    if any(phrase in q for phrase in ("my balance", "credits left", "minutes left", "how many credits",
                                      "how many minutes")):
        return "balance"
    if any(phrase in q for phrase in ("my last payment", "last payment", "payment status")):
        return "payment"
    return None


def _with_account(rows: list[tuple[str, str]], signed_in: bool) -> list[tuple[str, str]]:
    if not signed_in:
        return rows
    have = {topic_id for topic_id, _label in rows}
    extra = [pair for pair in _ACCOUNT if pair[0] not in have]
    if rows and rows[-1][0] == "human":
        return extra + rows[:-1] + [rows[-1]]
    return extra + rows


def respond(text: str = "", choice: str = "") -> tuple[str, list[tuple[str, str]]]:
    """The bot line and the chips under it. `choice` is a tapped topic id."""
    if choice == "helped":
        return "Good. Pick another topic if you still need something.", options_for(None)
    if choice == "menu":
        return MENU_LINE, options_for("menu")
    if choice:
        topic = TOPICS.get(choice)
        if topic is None:
            raise KeyError(choice)
        return topic.answer, options_for(topic.id)
    q = _norm(text)
    if not q or _GREETING.fullmatch(q):
        return GREETING, options_for(None)
    found = match(text)
    if found is None:
        return UNKNOWN, options_for(None)
    return found.answer, options_for(found.id)


def suggestions_for(messages: list[Any], status: str, signed_in: bool = False, page: str = "") -> list[tuple[str, str]]:
    """Chips to show again when the chat is reopened. Waiting on a person: none.

    My balance and My last payment are only offered when this browser is signed in as the chat's account.
    On the home menu, chips for the page they are looking at come first.
    """
    if status != "bot":
        return []
    last_user = next((m.text for m in reversed(messages) if getattr(m, "role", None) == "user"), "")
    if not last_user or _norm(last_user) == "all topics":
        rows = _with_account(options_for("menu" if last_user else None), signed_in)
    else:
        found = match(last_user)
        rows = _with_account(options_for(None), signed_in) if found is None else options_for(found.id)
    return focus_page(rows, page)


# Home-menu chips to put first on a page. Follow-up menus (they include "All topics") are left as they are.
_PAGE_FIRST: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("/billing", ("buy", "missing", "refund", "balance", "payment")),
    ("/resume-ai", ("resume", "what_spends", "prices")),
    ("/jobs", ("jobs", "resume")),
    ("/mock", ("practice", "what_spends")),
    ("/start", ("practice", "windows")),
    ("/sessions", ("practice", "windows")),
)


def _clean_page(page: str) -> str:
    path = page.strip().split("?", 1)[0].split("#", 1)[0][:80]
    if not path.startswith("/") or path.startswith("//"):
        return ""
    if len(path) > 1:
        path = path.rstrip("/")
    return path


def focus_page(rows: list[tuple[str, str]], page: str) -> list[tuple[str, str]]:
    """On the home menu only, lead with the topics for this page. A follow-up menu is unchanged."""
    if not rows or any(topic_id == "menu" for topic_id, _label in rows):
        return rows
    path = _clean_page(page)
    first: tuple[str, ...] = ()
    for prefix, ids in _PAGE_FIRST:
        if path == prefix or path.startswith(prefix + "/"):
            first = ids
            break
    if not first:
        return rows
    by_id = {topic_id: label for topic_id, label in rows}
    for topic_id in first:
        if topic_id not in by_id and topic_id in TOPICS:
            by_id[topic_id] = TOPICS[topic_id].label
    ordered: list[tuple[str, str]] = []
    seen: set[str] = set()
    for topic_id in first:
        if topic_id in by_id and topic_id not in seen:
            ordered.append((topic_id, by_id[topic_id]))
            seen.add(topic_id)
    for topic_id, label in rows:
        if topic_id not in seen:
            ordered.append((topic_id, label))
            seen.add(topic_id)
    return ordered
