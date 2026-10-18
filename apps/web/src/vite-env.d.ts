/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_LIVE_URL?: string;
  /** Optional support contacts (lib/contact.ts), offered next to the Contact page's form when set. */
  readonly VITE_SUPPORT_EMAIL?: string;
  /** WhatsApp number with the country code, digits only (919876543210). */
  readonly VITE_SUPPORT_WHATSAPP?: string;
  readonly VITE_DESKTOP_DOWNLOAD_URL?: string;
  /** "true" once the Windows installer is Authenticode-signed: drops the Beta label (lib/desktop.ts). */
  readonly VITE_DESKTOP_SIGNED?: string;
  /** The browser extension's store listing (Chrome Web Store), once published: /extension/connect links it. */
  readonly VITE_EXTENSION_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
