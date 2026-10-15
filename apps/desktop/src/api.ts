import { checkServerUrl, createApiClient, type ServerUrlCheck, safeLocal } from "@orbit/ui";
import { tokenExpiry } from "./token";

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
export const API_URL: string = normalizeApiUrl(safeLocal.getItem(API_URL_KEY)) ?? DEFAULT_API_URL;

/** Persist (or clear, with null) the server override. The API client is created once, so reload. */
export function setApiUrl(url: string | null): void {
  if (url) safeLocal.setItem(API_URL_KEY, url);
  else safeLocal.removeItem(API_URL_KEY);
  window.location.reload();
}
export const WEB_URL: string = import.meta.env.VITE_WEB_URL ?? "http://localhost:5173";

/** In-memory copy of the keychain token; the keychain is the source of truth across launches. */
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
/** When the current sign-in expires (ms since the epoch), if the token says. */
export function accessTokenExpiresAt(): number | null {
  return accessToken ? tokenExpiry(accessToken) : null;
}
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

let signingIn = 0;
/** Runs a sign-in request. Its 401 is a wrong password, an answer to show, not a reason to sign the user out. */
export async function signInRequest<T>(request: () => Promise<T>): Promise<T> {
  signingIn += 1;
  try {
    return await request();
  } finally {
    signingIn -= 1;
  }
}

export const api = createApiClient({
  baseUrl: API_URL,
  auth: { mode: "bearer", getToken: () => accessToken },
  onUnauthorized: () => {
    if (signingIn === 0) onUnauthorized?.();
  },
});
