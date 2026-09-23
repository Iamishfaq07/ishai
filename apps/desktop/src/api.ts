import { createApiClient } from "@orbit/ui";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
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
