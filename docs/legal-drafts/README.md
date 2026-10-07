# Terms and Refund pages: drafts, not published

These pages were drafted with the front door (#188) but are not served yet: they need details only the owner has,
marked in [brackets] in each file:

- the legal name, registered address and GST number;
- the grievance officer;
- the courts named in the terms;
- the refund rules (the draft suggests a 7-day full refund on unused packs; part-used packs, timing, minutes given
  back after an outage, and what happens to credits if Orbit closes are all open).

To publish them:

1. Fill in every [bracket] and settle the refund rules.
2. Move `terms.html` and `refund.html` to `apps/web/public/`. Their links to `/contact.html` should point to
   `/contact` (the app's Contact page) instead.
3. Set `LEGAL_PAGES_PUBLISHED = true` in `apps/web/src/lib/contact.ts`. The links in the footer, Help, sign-in and
   sign-up, and the front page's refund answer all appear with it.

**`contact.html` is superseded.** The Contact page is now the app's own form at `/contact`
(`apps/web/src/pages/Contact.tsx`, docs/DECISIONS.md D50): messages wait in the admin console's Inbox
(`/admin/inbox`), and it's live whatever `LEGAL_PAGES_PUBLISHED` says. The draft stays here only for its wording
(the grievance officer and the business's details): if the law needs those published, add them to the Contact page
rather than serving this file.

`privacy.html` is already published (`apps/web/public/privacy.html`).
