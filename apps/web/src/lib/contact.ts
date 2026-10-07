/**
 * Where people get help: the support email and WhatsApp number this deployment uses (public build config,
 * VITE_SUPPORT_EMAIL and VITE_SUPPORT_WHATSAPP), and the public policy pages. Without them, Help points to the contact
 * page (public/contact.html), which the owner fills in.
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

/** Static pages, outside the app (full page loads, not router links). */
export const CONTACT_PAGE = "/contact.html";
export const POLICY_LINKS: Array<{ href: string; label: string }> = [
  { href: "/terms.html", label: "Terms" },
  { href: "/refund.html", label: "Refunds" },
  { href: "/privacy.html", label: "Privacy" },
  { href: CONTACT_PAGE, label: "Contact" },
];
