/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_LIVE_URL?: string;
  /** Optional support contacts (lib/contact.ts), offered next to the Contact page's form when set. */
  readonly VITE_SUPPORT_EMAIL?: string;
  /** WhatsApp number with the country code, digits only (919876543210). */
  readonly VITE_SUPPORT_WHATSAPP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
