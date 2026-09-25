import { createApiClient } from "@orbit/ui";

/** The API's own address. The live-session WebSocket connects here directly (it authenticates by ticket). */
export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

/** Where HTTP calls go. In production, `/api` on the web app's own origin: the worker proxies it to the API, so
 * the session cookie is first-party. Safari on iOS drops a cross-site cookie, which loops sign-in forever. */
const HTTP_API_URL: string = import.meta.env.VITE_API_PROXY_PATH || API_URL;

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

/** Browser client: auth is the API's httpOnly cookie — no token is ever readable by JS. */
export const api = createApiClient({
  baseUrl: HTTP_API_URL,
  auth: { mode: "cookie" },
  onUnauthorized: () => unauthorizedHandler?.(),
});
