import { createApiClient, safeLocal } from "@orbit/ui";
import { watchForOutOfCredits } from "./outOfCredits";

import { endpointBases } from "./endpoints";

const bases = endpointBases(window.location.origin, {
  api: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
  live: import.meta.env.VITE_LIVE_URL,
  direct: import.meta.env.VITE_API_DIRECT_URL,
});
export const API_URL = bases.api;
export const LIVE_URL = bases.live;
export const DIRECT_URL = bases.direct;

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
