/**
 * The success toast for the first time an edit takes the ATS score to 80 (celebrate shows it once per device). Fixes
 * often land a few seconds apart (74, 82, 97, 99), so while the toast is up it follows the score the header shows,
 * instead of keeping the one that crossed 80, and a drop back under 80 closes it.
 */
export const ATS_80 = "first-ats-80";

export type Ats80Step = { do: "celebrate" | "update"; message: string } | { do: "close" } | null;

const message = (score: number) => `Your resume scores ${score}. Ready to apply?`;

/** What a new score does to that toast. `before` is null for a resume's first score (opening one isn't a rise). */
export function ats80Step(before: number | null, now: number | null): Ats80Step {
  if (now === null || before === null || now === before) return null;
  if (now < 80) return before >= 80 ? { do: "close" } : null;
  return { do: before < 80 ? "celebrate" : "update", message: message(now) };
}
