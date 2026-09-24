import { checkServerUrl, createApiClient, type ServerUrlCheck } from "@orbit/ui";

const API_URL_KEY = "orbit.apiUrl";
export const DEFAULT_API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Server URL rules (https unless it's this machine; dev builds may use http anywhere). */
export function validateApiUrl(value: string | null | undefined): ServerUrlCheck {
  return checkServerUrl(value, { allowInsecure: import.meta.env.DEV });
}

/** The normalised URL, or null if it fails validation — so an insecure saved override is ignored. */
export function normalizeApiUrl(value: string | null | undefined): string | null {
  const check = validateApiUrl(value);
  return check.ok ? check.url : null;
}

/** Server URL: a user override saved on the sign-in screen, else the build default. */
export const API_URL: string = normalizeApiUrl(localStorage.getItem(API_URL_KEY)) ?? DEFAULT_API_URL;

/** Persist (or clear, with null) the server override. The API client is created once, so reload. */
export function setApiUrl(url: string | null): void {
  if (url) localStorage.setItem(API_URL_KEY, url);
  else localStorage.removeItem(API_URL_KEY);
  window.location.reload();
}
export const WEB_URL: string = import.meta.env.VITE_WEB_URL ?? "http://localhost:5173";

/** In-memory copy of the keychain token; the keychain is the source of truth across launches. */
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export const api = createApiClient({
  baseUrl: API_URL,
  auth: { mode: "bearer", getToken: () => accessToken },
  onUnauthorized: () => onUnauthorized?.(),
});
