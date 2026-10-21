/**
 * Resume bullet builder: Google's X-Y-Z formula ("Accomplished [X] as measured by [Y], by doing [Z]"), the pattern
 * recruiters recommend and open-source bullet generators (OpenDraft, GitResume) apply. The candidate supplies the
 * facts; this only arranges them and checks the result. It never invents a number.
 */

export interface BulletParts {
  /** Z: what you did, in the past tense ("rewrote the checkout API in Go"). */
  did: string;
  /** X: what changed, in the past tense ("cut page load time"). */
  result: string;
  /** Y: how much, how many, by when ("from 4s to 1.2s for 50,000 daily users"). */
  measure: string;
}

const IRREGULAR: Record<string, string> = {
  rewrote: "rewriting", wrote: "writing", built: "building", led: "leading", ran: "running", made: "making",
  began: "beginning", drove: "driving", set: "setting", cut: "cutting", grew: "growing", taught: "teaching",
  brought: "bringing", sold: "selling", found: "finding", gave: "giving", took: "taking", won: "winning",
  spoke: "speaking", chose: "choosing", kept: "keeping", met: "meeting", put: "putting", got: "getting",
  shipped: "shipping", oversaw: "overseeing", undertook: "undertaking", sent: "sending", spent: "spending",
  thought: "thinking", understood: "understanding", held: "holding", drew: "drawing", rebuilt: "rebuilding",
};

/** "rewrote the API" → "rewriting the API"; "automated tests" → "automating tests"; "plan the launch" → "planning…". */
export function gerund(phrase: string): string {
  const t = phrase.trim();
  const m = /^(\S+)(.*)$/s.exec(t);
  if (!m) return t;
  const word = m[1]!.toLowerCase();
  const rest = m[2] ?? "";
  let ing: string;
  if (IRREGULAR[word]) ing = IRREGULAR[word]!;
  else if (word.endsWith("ing")) ing = word;
  else if (word.endsWith("ied")) ing = `${word.slice(0, -3)}ying`;
  // Past minus "ed" plus "ing" is right for regular verbs, e-verbs ("automated") and doubled ones ("planned") alike.
  else if (word.endsWith("ed") && word.length > 4) ing = `${word.slice(0, -2)}ing`;
  else if (word.endsWith("e") && !word.endsWith("ee")) ing = `${word.slice(0, -1)}ing`;
  else ing = `${word}ing`;
  return ing + rest;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const clean = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.;,\s]+$/, "");

/** Three arrangements of the same facts; empty when the action is missing. */
export function buildBullets(p: BulletParts): { label: string; text: string }[] {
  const did = clean(p.did), result = clean(p.result), measure = clean(p.measure);
  if (!did) return [];
  const out: { label: string; text: string }[] = [];
  if (result) {
    out.push({ label: "Result first (X-Y-Z)", text: `${cap(result)}${measure ? ` ${measure}` : ""} by ${gerund(did)}.` });
    out.push({ label: "Action first", text: `${cap(did)}, which ${low(result)}${measure ? ` ${measure}` : ""}.` });
  }
  out.push({ label: "Short", text: `${cap(did)}${measure ? ` (${measure})` : ""}.` });
  return out;
}

export const WEAK: Record<string, string[]> = {
  "responsible for": ["Led", "Owned", "Ran"],
  "worked on": ["Built", "Developed", "Delivered"],
  "helped": ["Supported", "Contributed to", "Enabled"],
  "assisted": ["Supported", "Partnered on", "Co-led"],
  "handled": ["Managed", "Resolved", "Processed"],
  "was part of": ["Contributed to", "Delivered with"],
  "involved in": ["Contributed to", "Drove"],
  "participated in": ["Contributed to", "Presented at"],
  "did": ["Completed", "Delivered", "Carried out"],
  "made": ["Created", "Built", "Designed"],
  "used": ["Applied", "Built with", "Implemented with"],
  "tasked with": ["Led", "Delivered"],
};

export interface BulletCheck { ok: boolean; text: string }

/** The checks a recruiter's six-second read applies, for any bullet (built here or pasted). */
export function checkBullet(text: string): { checks: BulletCheck[]; swaps: { weak: string; strong: string[] }[] } {
  const t = text.trim();
  const words = t ? t.split(/\s+/).length : 0;
  const lowered = t.toLowerCase();
  const swaps = Object.entries(WEAK).filter(([w]) => new RegExp(`(?:^|\\b)${w}\\b`).test(lowered)).map(([weak, strong]) => ({ weak, strong }));
  const checks: BulletCheck[] = [
    { ok: /\d/.test(t), text: /\d/.test(t) ? "Has a number" : "Add a number you can back up: how much, how many, how fast, or by when" },
    { ok: !swaps.length, text: swaps.length ? `Swap the weak phrase “${swaps[0]!.weak}” for a verb that says what you did` : "Starts with what you did" },
    { ok: words >= 8 && words <= 30, text: words < 8 ? "Too short to show impact: add the result" : words > 30 ? `${words} words: aim for under 30 so it fits in two lines` : "Fits in one or two lines" },
    { ok: !/\b(?:i|me|my)\b/i.test(t), text: /\b(?:i|me|my)\b/i.test(t) ? "Drop “I” and “my”: resumes leave the subject out" : "No “I” or “my”" },
  ];
  return { checks, swaps };
}

export const STRONG_VERBS: { group: string; verbs: string[] }[] = [
  { group: "Built", verbs: ["Built", "Designed", "Developed", "Launched", "Created", "Implemented"] },
  { group: "Improved", verbs: ["Cut", "Reduced", "Increased", "Improved", "Streamlined", "Automated"] },
  { group: "Led", verbs: ["Led", "Coordinated", "Mentored", "Organised", "Owned", "Drove"] },
  { group: "Analysed", verbs: ["Analysed", "Identified", "Forecast", "Measured", "Researched", "Audited"] },
  { group: "Persuaded", verbs: ["Negotiated", "Presented", "Pitched", "Secured", "Won", "Convinced"] },
];
