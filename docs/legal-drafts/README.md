# Terms, Refund and Contact pages: drafts, not published

These three pages were drafted with the front door (#188) but are not served yet: they need details only the owner
has, marked in [brackets] in each file:

- the legal name, registered address and GST number;
- the support email and WhatsApp number, and the grievance officer;
- the courts named in the terms;
- the refund rules (the draft suggests a 7-day full refund on unused packs; part-used packs, timing, minutes given
  back after an outage, and what happens to credits if Orbit closes are all open).

To publish them:

1. Fill in every [bracket] and settle the refund rules.
2. Move the three files to `apps/web/public/`.
3. Set `LEGAL_PAGES_PUBLISHED = true` in `apps/web/src/lib/contact.ts`. The links in the footer, Help, sign-in and
   sign-up, and the front page's refund answer and "Contact us" line all appear with it.

`privacy.html` is already published (`apps/web/public/privacy.html`).
