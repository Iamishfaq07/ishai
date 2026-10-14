# Audit fix log — 14 October 2026

Reproduced against the current checkout (`feat/practice-links`), not `ishai-main (1).zip`. That archive was not in the environment.

## Fixed, with a regression test or a direct code check

| Id | What was wrong | Fix | Proof |
|---|---|---|---|
| ORB-N01 | Checkout verify granted credits when the Razorpay signature was valid, without reading the payment. An `authorized` payment is not captured. | `fetch_payment`. Credits only if status is `captured`, order id matches, amount in paise matches, currency is INR. Webhook ignores anything that is not captured INR. | `tests/test_razorpay.py` (`test_an_authorized_payment_does_not_add_credits`, plus the existing once-only tests). 7 passed. |
| ORB-N04 | Deleting an account set `support_threads.user_id` to null and left the name, email and messages. Export omitted the chats. | Delete the account's threads and messages in `delete_account`. Export includes the chats and not the token. | `tests/test_support_chat.py::test_export_includes_the_chat_and_deleting_the_account_removes_it` |
| ORB-N06 | Opening resume B could apply a late fetch of resume A, and autosave writes `resume.id`. | Ignore a fetch whose id is not the open route. Reset the editor when the route changes. Autosave no-ops if the loaded id is not the route. | Code review of `ResumeEditor.tsx`. No browser race test in this change. |
| ORB-N07 | Google token exchange had no timeout mapping, and JWKS verification ran synchronously on the event loop. | `httpx` errors become a sign-in failure, not a 500. JWKS fetch runs in a thread with a 5s timeout. | Code review. No live Google call in this change. |
| ORB-N08 | Any support-chat read error opened a new thread. | A new thread starts only on 404 or 410. Other errors stay on the existing chat. | Code review of `SupportChat.tsx`. |
| ORB-N09 | `localStorage.setItem` in the support chat was uncaught. | `save` and `markSeen` catch storage failures. The chat still works for the visit. | Code review. |
| ORB-N11 | `docs/PRIVACY.md` said the resume maker needs no account. The signed-out editor and `/v1/resume-maker` are gone. | Privacy and security docs now say the editor needs an account. | Compared `backend.tsx`, `App.tsx`, and `resumes/routes.py`. |
| ORB-N12 | Cookie copy mentioned only the sign-in cookie. Google sets `orbit_google` for 10 minutes. | Cookie notice, `cookies.html`, and `PRIVACY.md`. | `auth/google.py` `max_age=600`. |

## Not fixed in this change

| Id | Why |
|---|---|
| ORB-N02 | Already enforced when `ORBIT_PROXY_SECRET` is set: only the Worker header is trusted, otherwise the right-most forwarding hop. Not re-tested against a live edge. |
| ORB-N10 | The support token was a GET query parameter, so it could land in proxy and access logs. | The web app sends `X-Orbit-Support-Token`. The query still works for an old client. The response is `Cache-Control: no-store`. | `tests/test_support_chat.py` reads with the header and still with the query. |
| ORB-N15 | Refunds and disputes do not adjust credits. Rule is documented, not automated. |
| C5, desktop audio, Playwright, live Razorpay | No Windows device, no live gateway, no browser runner used here. |
| Sections E and F (redesign, new products) | Not started. Launch blockers above came first. |

## Earlier commits on this same branch

Search, follow-up dates, per-account browser storage, live-session end, and document save were fixed in earlier commits on `feat/practice-links`. They are not repeated here.
