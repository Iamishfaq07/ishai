import type { RubricCriterion, RubricMark, SessionReview, TopPractice } from "@orbit/types";

/** The rubric's criteria, in the order the review shows them, with their labels. */
export const RUBRIC_ORDER: ReadonlyArray<readonly [RubricCriterion, string]> = [
  ["structure", "Structure"],
  ["specifics", "Specifics"],
  ["relevance", "Relevance"],
  ["clarity", "Clarity"],
  ["conciseness", "Conciseness"],
];

/** The rubric's marks that are there, in order (an older review has none). */
export function rubricRows(rubric: Partial<Record<RubricCriterion, RubricMark>> | undefined): Array<[string, RubricMark]> {
  if (!rubric) return [];
  return RUBRIC_ORDER.flatMap(([key, label]) => (rubric[key] ? [[label, rubric[key]] as [string, RubricMark]] : []));
}

/** A stronger answer split into its words and its [placeholders], the facts the candidate fills in. */
export function splitPlaceholders(text: string): Array<{ text: string; placeholder: boolean }> {
  return text
    .split(/(\[[^\][]{1,80}\])/)
    .filter(Boolean)
    .map((part) => ({ text: part, placeholder: /^\[[^\][]+\]$/.test(part) }));
}

/** The top three to practise: the review's ranked list, or (an older review) its practice suggestions. */
export function topPractice(review: Pick<SessionReview, "top_practice" | "practice">): TopPractice[] {
  if (review.top_practice?.length) return review.top_practice.slice(0, 3);
  return review.practice.slice(0, 3).map((practice) => ({ practice, questions: [] }));
}

/** A comfortable conversational pace is about 110–170 words a minute (the same range as the session's speaking card). */
export const PACE_RANGE = [110, 170] as const;

export function paceNote(wpm: number): "fast" | "slow" | null {
  return wpm > PACE_RANGE[1] ? "fast" : wpm < PACE_RANGE[0] ? "slow" : null;
}
