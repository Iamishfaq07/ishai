/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_LIVE_URL?: string;
  /** Help's support contacts (lib/contact.ts). Unset: Help points to /contact.html. */
  readonly VITE_SUPPORT_EMAIL?: string;
  /** WhatsApp number with the country code, digits only (919876543210). */
  readonly VITE_SUPPORT_WHATSAPP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
