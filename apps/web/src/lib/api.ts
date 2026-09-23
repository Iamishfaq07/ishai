import { createApiClient } from "@orbit/ui";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

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
