/**
 * When an Orbit sign-in token (a JWT) expires, in ms since the epoch: its `exp` claim, read without checking the
 * signature (this only decides when to suggest signing in again; the server decides what's valid). Null when the
 * token isn't a readable JWT. Desktop sign-ins expire a fixed time after signing in (apps/api auth/security.py).
 */
export function tokenExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** "45 minutes" / "about 3 hours" / "about 2 days", for a duration in ms. */
export function roughDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `about ${hours} hour${hours === 1 ? "" : "s"}`;
  return `about ${Math.round(hours / 24)} days`;
}
