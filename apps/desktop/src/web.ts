import { safeLocal } from "@orbit/ui";

/**
 * Orbit on the web, from the desktop app (DECISIONS D77). Every link says where in the app it was clicked, so the
 * site can tell which placements help and which only get in the way: `utm_source=orbit-desktop&utm_campaign=<where>`.
 * KashSec is the team's own academy on its own site, tagged the way D70 tags it everywhere.
 */

/** Where in the app a link to the web sits (one name per placement). */
export type WebPlacement =
  | "home-promo"
  | "home-upcoming"
  | "onboarding"
  | "tray"
  | "settings"
  | "setup"
  | "history"
  | "report";

/** `path` on the web app (`base`, the build's VITE_WEB_URL) with the campaign tags; a query `path` already has is kept. */
export function webLink(base: string, path: string, placement: WebPlacement): string {
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("utm_source", "orbit-desktop");
  url.searchParams.set("utm_campaign", placement);
  return url.toString();
}

/**
 * "Report a problem" (Settings → About, the live window's menu): the Contact form, started on reporting something
 * Orbit generated (Microsoft Store policy 11.16; the answer's 👎 also has "Inappropriate or harmful").
 */
export function reportLink(base: string): string {
  return webLink(base, "/contact?topic=report", "report");
}

export const KASHSEC_URL = "https://kashsec.vercel.app/";

/** KashSec's address with where it was found (D70: utm_source=orbit, utm_medium=referral, utm_campaign=<placement>). */
export function kashsecLink(placement: WebPlacement): string {
  return `${KASHSEC_URL}?utm_source=orbit&utm_medium=referral&utm_campaign=desktop-${placement}`;
}

/** One of Orbit's tools on the web, as the desktop app shows it: what it does, in the site's own words. */
export interface WebTool {
  id: "practice" | "video" | "atlas" | "resume" | "jobs" | "linkedin" | "code" | "offer" | "learning" | "kashsec";
  name: string;
  /** One line: what it does for you (the public site's line, D66: true and checkable, no outcome promises). */
  line: string;
  /** The web app's page; KashSec is its own site. */
  path: string;
  /** The button's words. */
  action: string;
}

export const WEB_TOOLS: readonly WebTool[] = [
  { id: "practice", name: "Practice", line: "Mock interviews with an AI interviewer who follows up, then a scorecard and the questions to redo.", path: "/mock", action: "Start a practice round" },
  { id: "video", name: "Video interview with Saba", line: "A video round with Saba, Orbit's AI interviewer: she asks out loud, you answer on camera, then a review.", path: "/interview", action: "Meet Saba" },
  { id: "atlas", name: "Interview Atlas", line: "Search any company or role: its interview process, practice questions, a day-by-day prep plan and its open jobs.", path: "/interview-questions", action: "Search a company" },
  { id: "resume", name: "Resume AI", line: "An ATS score out of 100 and a tailored resume for every job.", path: "/resume-ai", action: "Score my resume" },
  { id: "jobs", name: "Jobs AI", line: "New jobs that fit you, a tracker and messages for referrals.", path: "/jobs", action: "Find jobs" },
  { id: "linkedin", name: "LinkedIn AI", line: "How your profile reads to a recruiter, and what to fix first.", path: "/linkedin", action: "Check my profile" },
  { id: "code", name: "Code AI", line: "Coding rounds by pattern: run the tests, then get a review.", path: "/code", action: "Practise a problem" },
  { id: "offer", name: "Offer AI", line: "What an offer is worth, and how to ask for more.", path: "/offers", action: "Weigh an offer" },
  { id: "learning", name: "Learning AI", line: "The skills interviews test, with free cybersecurity lessons.", path: "/learn", action: "Start learning" },
  { id: "kashsec", name: "KashSec Academy", line: "Free cybersecurity education for complete beginners. Start from zero, learn by doing, and reach a real career.", path: KASHSEC_URL, action: "Start learning free" },
];

/** The tool's address from a placement. */
export function toolLink(base: string, tool: WebTool, placement: WebPlacement): string {
  return tool.id === "kashsec" ? kashsecLink(placement) : webLink(base, tool.path, placement);
}

const SEEN_KEY = "orbit.desktop.promo.seen";
const HIDDEN_KEY = "orbit.desktop.promo.hidden";

/**
 * Home's "More from Orbit": one tool per visit, taking turns, never one the person hid. `seen` counts Home's visits on
 * this device; null when every tool is hidden (the card goes away for good).
 */
export function pickPromo(seen: number, hidden: ReadonlySet<string>, tools: readonly WebTool[] = WEB_TOOLS): WebTool | null {
  const shown = tools.filter((t) => !hidden.has(t.id));
  if (shown.length === 0) return null;
  return shown[((seen % shown.length) + shown.length) % shown.length]!;
}

export function loadPromoState(): { seen: number; hidden: Set<string> } {
  const seen = Number(safeLocal.getItem(SEEN_KEY) ?? "0");
  let hidden: string[];
  try {
    const raw: unknown = JSON.parse(safeLocal.getItem(HIDDEN_KEY) ?? "[]");
    hidden = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    hidden = [];
  }
  return { seen: Number.isFinite(seen) && seen >= 0 ? Math.floor(seen) : 0, hidden: new Set(hidden) };
}

/** Home was opened: the next visit shows the next tool. */
export function countPromoVisit(seen: number): void {
  safeLocal.setItem(SEEN_KEY, String(seen + 1));
}

/** "Not interested": this tool doesn't come back on this device. */
export function hidePromo(id: string): void {
  const { hidden } = loadPromoState();
  hidden.add(id);
  safeLocal.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}

/** A finished mock interview's report on the web, opened at its "Ask a mentor" card (the share link is made there). */
export function mentorLink(base: string, sessionId: string): string {
  return `${webLink(base, `/sessions/${encodeURIComponent(sessionId)}`, "history")}#mentor`;
}
