/**
 * Where people get help: the support email and WhatsApp number this deployment uses (public build config,
 * VITE_SUPPORT_EMAIL and VITE_SUPPORT_WHATSAPP), and the public policy pages. Without them, Help points to the contact
 * page once it's published (LEGAL_PAGES_PUBLISHED).
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
 * The Terms, Refund and Contact pages wait for the owner's details (legal name, address, support contacts, GST) and
 * refund rules: their drafts are in docs/legal-drafts/. To publish them, fill them in, move them to apps/web/public/
 * and set this to true; every link to them (footer, Help, sign-up, the front page's FAQ) appears with it.
 */
export const LEGAL_PAGES_PUBLISHED = false;

/** Static pages, outside the app (full page loads, not router links). */
export const PRIVACY_PAGE = "/privacy.html";
export const TERMS_PAGE: string | null = LEGAL_PAGES_PUBLISHED ? "/terms.html" : null;
export const REFUND_PAGE: string | null = LEGAL_PAGES_PUBLISHED ? "/refund.html" : null;
export const CONTACT_PAGE: string | null = LEGAL_PAGES_PUBLISHED ? "/contact.html" : null;
export const POLICY_LINKS: Array<{ href: string; label: string }> = [
  ...(TERMS_PAGE ? [{ href: TERMS_PAGE, label: "Terms" }] : []),
  ...(REFUND_PAGE ? [{ href: REFUND_PAGE, label: "Refunds" }] : []),
  { href: PRIVACY_PAGE, label: "Privacy" },
  ...(CONTACT_PAGE ? [{ href: CONTACT_PAGE, label: "Contact" }] : []),
];
