import type { AnswerLength, AnswerSize } from "@orbit/types";

/** Auto length's sizes, shortest first (the server's routing.SIZE_ORDER). */
export const SIZE_ORDER: readonly AnswerSize[] = ["brief", "short", "medium", "long", "detailed"];
/** The fixed lengths, shortest first (Shorter / Longer step through these on a fixed-length session). */
export const LENGTH_STEPS: readonly AnswerLength[] = ["short", "standard", "detailed"];

/** What the card says about an auto-sized answer, so the candidate knows how much to say. */
export const SIZE_HINTS: Record<AnswerSize, { label: string; hint: string }> = {
  brief: { label: "Quick answer", hint: "A sentence or two is enough here (under 15 seconds)" },
  short: { label: "Short answer", hint: "About 20–30 seconds" },
  medium: { label: "Medium answer", hint: "About 40 seconds" },
  long: { label: "Long answer", hint: "About a minute" },
  detailed: { label: "Detailed answer", hint: "About two minutes: the interviewer asked for depth" },
};

export type ResizeTarget = { length: AnswerLength } | { size: AnswerSize };

/**
 * Where "Shorter" / "Longer" take the shown answer, or null at the end of the scale. A fixed-length session steps its
 * length (and keeps it); an auto one asks for this one answer a size down or up, staying auto for the next question.
 */
export function resizeTarget(length: AnswerLength, size: AnswerSize | undefined, step: -1 | 1): ResizeTarget | null {
  if (length === "auto") {
    if (!size) return null;
    const next = SIZE_ORDER[SIZE_ORDER.indexOf(size) + step];
    return next ? { size: next } : null;
  }
  const i = LENGTH_STEPS.indexOf(length);
  const next = i < 0 ? undefined : LENGTH_STEPS[i + step];
  return next ? { length: next } : null;
}
