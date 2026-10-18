import { createApiClient, safeLocal, trimTrailingSlashes } from "@orbit/ui";
import { watchForOutOfCredits } from "./outOfCredits";

/** Absolute URL for a configured base, which may be relative to this site (e.g. "/api", the Worker's proxy). */
function absolute(base: string): string {
  return trimTrailingSlashes(new URL(base, window.location.origin).toString());
}

// REST base. In production this is the same-origin "/api" proxy, so the session cookie is first-party — a cookie
// set by a different site is dropped by browsers that block third-party cookies (all of iOS), and signing in would
// bounce straight back to the login page.
export const API_URL: string = absolute(import.meta.env.VITE_API_URL ?? "http://localhost:8000");

/** Live-session WebSocket base. Auth there is a single-use ticket, not the cookie, so it can go direct to the API. */
export const LIVE_URL: string = import.meta.env.VITE_LIVE_URL ? absolute(import.meta.env.VITE_LIVE_URL) : API_URL;

/**
 * The API's own address on this site's domain (api.orbitanswer.com), which most calls use once the API says its
 * cookies are shared with it (D80): through the proxy, Cloudflare's free plan sends visitors in India via London or
 * Seattle, a second or more each call. Same site, so the cookie is still first-party.
 */
export const DIRECT_URL: string | null = import.meta.env.VITE_API_DIRECT_URL ? absolute(import.meta.env.VITE_API_DIRECT_URL) : null;

/**
 * Still through the proxy: what's priced or worded by the visitor's country, which the edge states only there
 * (billing, the region, Support's prices, the resume allowance's offer), and sign-up (the country it's made in, and
 * the invite code's cookie on this site).
 */
const VIA_PROXY = /^\/v1\/(?:billing\/|region(?:[/?]|$)|support\/|resumes\/allowance(?:[/?]|$)|auth\/register(?:[/?]|$))/;

export const viaProxy = (path: string): boolean => VIA_PROXY.test(path);

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/** Browser client: auth is the API's httpOnly cookie — no token is ever readable by JS. Any reply that means the
 *  account is out of credits also opens the out-of-credits dialog (lib/outOfCredits.ts). */
export const api = createApiClient({
  baseUrl: API_URL,
  auth: { mode: "cookie" },
  ...(DIRECT_URL ? { direct: { url: DIRECT_URL, viaProxy, siteHost: window.location.hostname, storage: safeLocal } } : {}),
  onUnauthorized: () => unauthorizedHandler?.(),
  fetchImpl: watchForOutOfCredits(),
});
