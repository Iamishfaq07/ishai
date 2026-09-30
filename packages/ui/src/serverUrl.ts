/**
 * Validation for a user-entered API server URL (desktop "Server: change"). Sign-in sends the password and
 * receives a bearer token, so a remote server must be HTTPS; plain HTTP is only accepted for this machine
 * (local development), or anywhere in a development build.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `url` without trailing slashes. A loop, not `/\/+$/`, which backtracks quadratically on a long run of slashes. */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

export type ServerUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

export function checkServerUrl(value: string | null | undefined, opts: { allowInsecure?: boolean } = {}): ServerUrlCheck {
  const raw = (value ?? "").trim();
  if (!raw) return { ok: false, reason: "Enter a server URL." };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That isn't a valid URL." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Use an https:// URL." };
  }
  if (url.username || url.password) return { ok: false, reason: "Don't put credentials in the URL." };
  if (url.protocol === "http:" && !LOOPBACK.has(url.hostname) && !opts.allowInsecure) {
    return { ok: false, reason: "Remote servers must use https:// — your password would be sent unencrypted." };
  }
  return { ok: true, url: trimTrailingSlashes(url.toString()) };
}
