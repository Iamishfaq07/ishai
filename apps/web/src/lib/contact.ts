/**
 * Where people get help: the Contact page's form (`/contact`; its messages wait in the admin's Inbox), the support
 * email and WhatsApp number this deployment may also offer (public build config, VITE_SUPPORT_EMAIL and
 * VITE_SUPPORT_WHATSAPP, both optional), and the public policy pages.
 */
export const SUPPORT_EMAIL: string | null = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || null;

const WHATSAPP_DIGITS = (import.meta.env.VITE_SUPPORT_WHATSAPP ?? "").replace(/\D/g, "");
export const SUPPORT_WHATSAPP: string | null = WHATSAPP_DIGITS.length >= 10 ? WHATSAPP_DIGITS : null;

/** A wa.me link that opens a chat with support, with the first message typed in. */
export function whatsappLink(text: string): string | null {
  return SUPPORT_WHATSAPP ? `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}` : null;
}

export function mailLink(subject: string): string | null {
  return SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}` : null;
}

/** The line Orbit is honest about everywhere it's sold (the front page, sign-up, Help, the public footer). */
export const USE_WHERE_ALLOWED =
  "Built for practice, and for interviews and calls where notes or AI help are allowed. Check the rules first.";

/**
 * The Contact page: the app's own form (pages/Contact.tsx), so a router link (`<Link to={CONTACT_PAGE}>`), and live
 * whatever LEGAL_PAGES_PUBLISHED says. It supersedes the draft static contact page in docs/legal-drafts/. Links that
 * prefill it (`?topic=`, `?listing=`) come from `contactHref` in lib/contactForm.ts.
 */
export const CONTACT_PAGE = "/contact";

/**
 * Terms, refunds and cookies are published (apps/web/public/). They name no company, street address or GSTIN:
 * those stay off the site until the owner writes them in. Set this to false only to hide the terms and refund links.
 */
export const LEGAL_PAGES_PUBLISHED = true;

/** Static pages, outside the app (full page loads, not router links). */
export const PRIVACY_PAGE = "/privacy.html";
export const COOKIE_PAGE = "/cookies.html";
export const TERMS_PAGE: string | null = LEGAL_PAGES_PUBLISHED ? "/terms.html" : null;
export const REFUND_PAGE: string | null = LEGAL_PAGES_PUBLISHED ? "/refund.html" : null;
/** The static policy pages, for `<a href>`. Contact isn't one: it's a router link to CONTACT_PAGE. */
export const POLICY_LINKS: Array<{ href: string; label: string }> = [
  ...(TERMS_PAGE ? [{ href: TERMS_PAGE, label: "Terms" }] : []),
  ...(REFUND_PAGE ? [{ href: REFUND_PAGE, label: "Refunds" }] : []),
  { href: PRIVACY_PAGE, label: "Privacy" },
  { href: COOKIE_PAGE, label: "Cookies" },
];
