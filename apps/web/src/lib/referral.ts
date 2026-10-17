import { safeLocal } from "@orbit/ui";

/**
 * A link's invite or creator code (`/r/<code>`, or `?ref=<code>` on any page), kept first-party until sign-up: in
 * localStorage, and in a cookie the API reads when a sign-up comes back from Google. A password sign-up sends it, and
 * so does the Continue with Google link. Kept 30 days; the newest link wins. Whether it counts is the server's call
 * (apps/api/orbit_api/billing/referrals.py: invites to the inviter's own account, inbox or network don't).
 */
const KEY = "orbit.ref";
export const REF_COOKIE = "orbit_ref";
export const REF_DAYS = 30;
const CODE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

/** A code the way the server stores it (upper case, no spaces), or null when it can't be one. */
export function normalizeCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").replace(/\s+/g, "").toUpperCase();
  return CODE.test(code) ? code : null;
}

function cookie(value: string, maxAge: number): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${REF_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

/** Keeps a link's code for the sign-up; returns it, or null when it isn't one. */
export function keepRef(raw: string | null | undefined, now = Date.now()): string | null {
  const code = normalizeCode(raw);
  if (!code) return null;
  safeLocal.setItem(KEY, JSON.stringify({ code, at: now }));
  cookie(code, REF_DAYS * 86_400);
  return code;
}

/** The code kept from a link in the last 30 days, if any. */
export function storedRef(now = Date.now()): string | null {
  try {
    const kept = JSON.parse(safeLocal.getItem(KEY) ?? "null") as { code?: unknown; at?: unknown } | null;
    if (kept && typeof kept.code === "string" && typeof kept.at === "number" && now - kept.at < REF_DAYS * 86_400_000) {
      return normalizeCode(kept.code);
    }
  } catch {
    /* Not ours: the cookie may still have it. */
  }
  const found = document.cookie.match(new RegExp(`(?:^|;\\s*)${REF_COOKIE}=([^;]*)`));
  return normalizeCode(found?.[1] ? decodeURIComponent(found[1]) : null);
}

/** After the sign-up it was for (or once it's been entered at checkout): nothing to carry any more. */
export function clearRef(): void {
  safeLocal.removeItem(KEY);
  cookie("", 0);
}

/** `?ref=<code>` in the address: kept, and taken out of the address bar (it's no use in a shared or bookmarked URL). */
export function captureRefFromUrl(): void {
  const url = new URL(window.location.href);
  const raw = url.searchParams.get("ref");
  if (raw === null) return;
  keepRef(raw);
  url.searchParams.delete("ref");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
