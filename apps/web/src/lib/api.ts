import { createApiClient } from "@orbit/ui";

/** Absolute URL for a configured base, which may be relative to this site (e.g. "/api", the Worker's proxy). */
function absolute(base: string): string {
  return new URL(base, window.location.origin).toString().replace(/\/+$/, "");
}

// REST base. In production this is the same-origin "/api" proxy, so the session cookie is first-party — a cookie
// set by a different site is dropped by browsers that block third-party cookies (all of iOS), and signing in would
// bounce straight back to the login page.
export const API_URL: string = absolute(import.meta.env.VITE_API_URL ?? "http://localhost:8000");

/** Live-session WebSocket base. Auth there is a single-use ticket, not the cookie, so it can go direct to the API. */
export const LIVE_URL: string = import.meta.env.VITE_LIVE_URL ? absolute(import.meta.env.VITE_LIVE_URL) : API_URL;

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/** Browser client: auth is the API's httpOnly cookie — no token is ever readable by JS. */
export const api = createApiClient({
  baseUrl: API_URL,
  auth: { mode: "cookie" },
  onUnauthorized: () => unauthorizedHandler?.(),
});
