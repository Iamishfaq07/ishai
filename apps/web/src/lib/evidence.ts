import type { EvidenceItem } from "@orbit/types";

/** Where a claim comes from, in words. */
export function sourceLabel(item: Pick<EvidenceItem, "source_kind" | "source_title" | "source_id">): string {
  if (item.source_kind === "manual") return "In your own words";
  const what = item.source_kind === "story" ? "Story" : "Resume";
  const title = item.source_title || (item.source_kind === "story" ? "a story" : "your resume");
  return item.source_id ? `${what}: ${title}` : `${what}: ${title} (since deleted)`;
}

/** What a suggestion run says back: how many to check, and how many the AI proposed but couldn't back with a quote. */
export function suggestNote(added: number, dropped: number): string {
  const head = added
    ? `${added} new claim${added === 1 ? "" : "s"} to check below.`
    : "No new claims: everything found is already in your vault, or couldn't be backed up.";
  return dropped ? `${head} ${dropped} left out because the source doesn't say ${dropped === 1 ? "it" : "them"} word for word, or ${dropped === 1 ? "it's" : "they're"} already here.` : head;
}

/** A row button's accessible name: its visible words first (WCAG 2.5.3, label in name), then which claim it acts on. The
 *  delete button shows only an icon, so its name says whether it discards a suggestion or deletes a claim. */
export function actionLabel(action: "confirm" | "edit" | "delete", item: Pick<EvidenceItem, "claim" | "status">): string {
  const what = action === "confirm" ? "It's true: confirm" : action === "edit" ? "Edit" : item.status === "suggested" ? "Discard" : "Delete";
  return `${what} “${item.claim}”`;
}

const STOP = new Set(("the and for with that this from into over under about our their your was were are has have had " +
  "who what when where which while than then them they its it's not but all any per via out off one two led").split(" "));

/** Words that carry meaning, lightly stemmed ("migrated", "migrating" → "migrat"), and numbers as written. */
function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9+#.]*[a-z0-9+#]|[a-z]|\d[\d,.]*%?/g) ?? [])
    .map((w) => w.replace(/[.,]+$/, ""))
    .filter((w) => /\d/.test(w) || (w.length >= 3 && !STOP.has(w)))
    .map((w) => (/\d/.test(w) ? w : w.replace(/(ing|ed|es|s|e)$/, "")));
}

const SPELLED = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const SPELLED_RE = new RegExp(`\\b(${SPELLED.join("|")})\\b`, "gi");

function numbers(text: string): Set<string> {
  // "three engineers" backs "3 engineers": small numbers in words count as their digits.
  text = text.replace(SPELLED_RE, (w) => String(SPELLED.indexOf(w.toLowerCase())));
  // Standalone figures only: the 95 in "p95" or the 3 in "S3" names a thing, not an amount.
  return new Set((text.match(/(?<![a-z0-9])\d[\d,.]*%?/gi) ?? []).map((n) => n.replace(/[.,]+$/, "").replace(/,/g, "")));
}

/** A claim's words and the figures it (or its quote) gives, worked out once per claim: the resume editor checks every
 *  bullet against every confirmed claim on each keystroke, and redoing this each time was most of a keystroke's work. */
const prepared = new WeakMap<object, { key: string; claim: string[]; backed: Set<string> }>();

function prepare(item: Pick<EvidenceItem, "claim" | "quote">): { claim: string[]; backed: Set<string> } {
  const key = `${item.claim}\u0000${item.quote}`;
  let hit = prepared.get(item);
  if (!hit || hit.key !== key) {
    hit = { key, claim: [...new Set(words(item.claim))], backed: numbers(`${item.claim} ${item.quote}`) };
    prepared.set(item, hit);
  }
  return hit;
}

/**
 * The confirmed evidence a resume bullet rests on, if any: most of the claim's words are in the bullet, and every
 * number the bullet gives is one the claim or its quote gives too, so a bullet that inflates "40%" to "60%" isn't
 * marked as backed. Conservative on purpose: a missing mark costs nothing, a wrong one misleads.
 */
export function evidenceFor<T extends Pick<EvidenceItem, "claim" | "quote" | "status">>(bullet: string, items: T[]): T | null {
  const said = new Set(words(bullet));
  if (said.size < 3) return null;
  const figures = numbers(bullet);
  let best: { item: T; score: number } | null = null;
  for (const item of items) {
    if (item.status !== "confirmed") continue;
    const { claim, backed } = prepare(item);
    if (claim.length < 3) continue;
    if ([...figures].some((n) => !backed.has(n))) continue;
    const shared = claim.filter((w) => said.has(w)).length;
    const score = shared / claim.length;
    if (shared >= 3 && score >= 0.5 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item ?? null;
}
