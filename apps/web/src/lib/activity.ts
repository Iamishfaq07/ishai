import { safeLocal } from "@orbit/ui";
import { api } from "./api";
import { hearErrorsShown } from "./format";

// Candidate insights (apps/api/orbit_api/insights.py): where an account came from, and what it does in the app, so
// the admin can see where people get stuck. Pages opened, a few steps and the errors shown, never what was typed.
// Where they came from is kept on the device from the first visit and sent once, after sign-up.

const SOURCE_KEY = "orbit.source.v1";
const SENT_KEY = "orbit.source.sent.v1";
const FLUSH_MS = 15_000;
const MAX_QUEUE = 40;

type Kind = "page" | "action" | "error";
interface Event {
  kind: Kind;
  name: string;
  path: string;
  detail?: string;
  device: "phone" | "tablet" | "desktop";
  at: string;
}

let queue: Event[] = [];
let timer: number | null = null;
let signedIn: string | null = null;
const recentErrors = new Map<string, number>();

function device(): Event["device"] {
  const w = typeof window === "undefined" ? 1280 : window.innerWidth;
  return w < 640 ? "phone" : w < 1024 ? "tablet" : "desktop";
}

/** The first visit's referring site, campaign tags and landing page, kept until sign-up. Call once per page load. */
export function rememberSource(): void {
  try {
    if (safeLocal.getItem(SOURCE_KEY)) return;
    const params = new URLSearchParams(window.location.search);
    let referrer = "";
    try {
      const from = document.referrer ? new URL(document.referrer) : null;
      if (from && from.host !== window.location.host) referrer = from.origin;
    } catch {
      /* not an address */
    }
    const source: Record<string, string> = { landing: window.location.pathname, first_seen: new Date().toISOString() };
    if (referrer) source.referrer = referrer;
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"]) {
      const v = params.get(key);
      if (v) source[key] = v.slice(0, 120);
    }
    const invite = window.location.pathname.match(/^\/r\/([\w-]{3,32})/)?.[1];
    if (invite && !source.ref) source.ref = invite;
    safeLocal.setItem(SOURCE_KEY, JSON.stringify(source));
  } catch {
    /* storage off: nothing to remember */
  }
}

function pendingSource(user: string): Record<string, string> | undefined {
  try {
    if (safeLocal.getItem(SENT_KEY) === user) return undefined;
    const raw = safeLocal.getItem(SOURCE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : undefined;
  } catch {
    return undefined;
  }
}

async function flush(keepalive = false): Promise<void> {
  if (!signedIn) return;
  const user = signedIn;
  const events = queue.splice(0, MAX_QUEUE);
  const source = pendingSource(user);
  if (!events.length && !source) return;
  try {
    await api.call<void>("/v1/activity", {
      method: "POST",
      body: JSON.stringify(source ? { source, events } : { events }),
      keepalive,
    });
    if (source) safeLocal.setItem(SENT_KEY, user);
  } catch {
    /* insights are best-effort: a lost batch is dropped, never retried into a loop */
  }
}

function push(kind: Kind, name: string, detail?: string): void {
  if (!signedIn || typeof window === "undefined") return;
  queue.push({ kind, name: name.slice(0, 80), path: window.location.pathname, detail: detail?.slice(0, 200), device: device(), at: new Date().toISOString() });
  if (queue.length > MAX_QUEUE * 2) queue = queue.slice(-MAX_QUEUE);
  if (queue.length >= MAX_QUEUE) void flush();
}

/** Starts (or stops, with null) sending this account's activity. */
export function trackAs(userId: string | null): void {
  if (signedIn && signedIn !== userId) void flush(true);
  signedIn = userId;
  if (typeof window === "undefined") return;
  hearErrorsShown(userId ? trackError : null);
  if (userId && timer === null) {
    timer = window.setInterval(() => void flush(), FLUSH_MS);
    document.addEventListener("visibilitychange", onHide);
    void flush();
  } else if (!userId && timer !== null) {
    window.clearInterval(timer);
    timer = null;
    document.removeEventListener("visibilitychange", onHide);
    queue = [];
  }
}

function onHide(): void {
  if (document.visibilityState === "hidden") void flush(true);
}

/** A page was opened: its title (without " · Orbit") names it. */
export function trackPage(title: string): void {
  push("page", title.replace(/\s*[·|]\s*Orbit.*$/, "").trim() || window.location.pathname);
}

/** A step that matters (opened the cart, started paying, applied a coupon). */
export function trackAction(name: string, detail?: string): void {
  push("action", name, detail);
}

/** An error the person saw; the same one on the same page counts once a minute. */
export function trackError(message: string): void {
  if (typeof window === "undefined") return;
  const key = `${window.location.pathname} ${message}`;
  const now = Date.now();
  if ((recentErrors.get(key) ?? 0) > now - 60_000) return;
  recentErrors.set(key, now);
  push("error", message.split(/[.:]/)[0] || "Error", message);
}
