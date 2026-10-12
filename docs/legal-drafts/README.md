# Terms and refund pages

Published copies are `apps/web/public/terms.html`, `refund.html` and `cookies.html`.
`LEGAL_PAGES_PUBLISHED` in `apps/web/src/lib/contact.ts` turns the terms and refund links on.

Those pages do not name a company, a street address or a GSTIN. Add those only when the owner supplies them,
then copy the sentence into the published pages and the Contact page's "Who runs Orbit" card.

The HTML files in this folder are the earlier drafts. They still contain bracketed blanks. Don't serve them.

The Contact page is the app's form at `/contact`. `contact.html` here is not served.
`privacy.html` is published at `apps/web/public/privacy.html`.
