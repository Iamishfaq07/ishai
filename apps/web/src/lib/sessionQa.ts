import type { SessionAnswer } from "@orbit/types";

/**
 * A session's answers that no listed question carries: ones asked in chat or with Answer (no detected question),
 * and, after "Delete transcript" (which removes the detected questions but keeps the answers), every answer. The
 * Questions & answers tab lists them on their own, or they'd be kept but never shown.
 */
export function looseAnswers(questions: readonly { id: string }[], answers: readonly SessionAnswer[]): SessionAnswer[] {
  const listed = new Set(questions.map((q) => q.id));
  return answers.filter((a) => !a.question_id || !listed.has(a.question_id));
}
