"""Answers the support bot can give without calling a model. Prices match docs/BILLING.md."""

import re

GREETING = (
    "Hi, I'm Orbit's support bot. I can help with credits, payments, the Windows app, "
    "Resume AI, Jobs AI, and sign-in. If I can't, tap Talk to a person and someone on the team will reply in this chat."
)

HANDOFF = "A person on the Orbit team has this chat now. Reply here and they'll see it. You don't need to start again."

UNKNOWN = (
    "I don't have a sure answer for that. Tap Talk to a person and someone from Orbit will reply in this chat."
)

# (words that must appear, answer). The first hit wins, so put the specific ones above the general ones.
_ARTICLES: list[tuple[tuple[str, ...], str]] = [
    (
        ("utr",),
        "After you pay by UPI, your app shows a 12-digit UTR. Paste that UTR on the billing page. "
        "Orbit matches it to your payment and adds the credits. If it has been a few hours, talk to a person and include the UTR.",
    ),
    (
        ("refund",),
        "Payments are checked before a refund. A refund isn't automatic from this chat. "
        "Talk to a person and include the pack you bought, plus the 12-digit UTR if you paid the UPI ID by hand.",
    ),
    (
        ("credit", "pack", "price", "₹", "rupee", "upi", "payment", "minute", "razorpay", "netbanking"),
        "Credits never expire and nothing renews. A new account starts with 20 interview minutes and 1 Resume AI credit. "
        "Packs: Mini ₹499 (15 minutes, 5 resume credits), Starter ₹1,999 (60 minutes, 15 credits), "
        "Plus ₹3,999 (150 minutes, 40 credits), Pro ₹7,999 (360 minutes, 100 credits). "
        "Buy them on the billing page. Razorpay takes a card, UPI, or netbanking, and the credits land as soon as it goes through. "
        "If that checkout isn't offered, pay the UPI ID shown there and paste the 12-digit UTR. "
        "Interview minutes pay for live sessions and mocks. Resume credits pay for import, rewrite, tailor, and cover letters.",
    ),
    (
        ("windows", "desktop", "download", "install"),
        "The live copilot is the Windows app. Download it from the account menu (Me → Windows app) while signed in. "
        "The website is for Resume AI, Jobs AI, practice, and your account. Sign in to the app with the same email.",
    ),
    (
        ("sign in", "signin", "login", "password", "verify"),
        "Sign in with the email you registered. If the page bounces back to login, reload once. "
        "A reset link is sent from the sign-in page (check spam). A new account may need the email confirmed before some actions.",
    ),
    (
        ("resume", "ats", "tailor", "cover"),
        "Resume AI scores how well screening software can read your resume, and can tailor a copy to one job. "
        "You see every change before it is kept. Typing and the ATS score don't spend a credit. Import, rewrite, tailor, and cover letters do.",
    ),
    (
        ("job", "tracker", "fit"),
        "Jobs AI matches roles to your profile, checks fit against your resume, and keeps a tracker. "
        "Fit checks are free up to a daily limit. Outreach writes a note for one job you choose.",
    ),
    (
        ("mock", "practice", "live", "copilot", "session"),
        "A mock interview is practice: Orbit asks, you answer out loud. A live session is the copilot during a real call, "
        "in the Windows app. Both use interview minutes. One live session at a time, up to 60 minutes on the free credit balance.",
    ),
]


def lookup(text: str) -> str | None:
    """A known answer, or None when the bot should ask the model or offer a person."""
    q = " ".join(text.lower().split())
    if re.fullmatch(r"(hi|hello|hey|help|thanks|thank you)[.!? ]*", q):
        return GREETING
    for keys, answer in _ARTICLES:
        if any(k in q for k in keys):
            return answer
    return None


def facts() -> str:
    """The same notes, for the model, so it can't invent a price or a refund."""
    lines = [answer for _keys, answer in _ARTICLES]
    return "\n".join(f"- {line}" for line in lines)
