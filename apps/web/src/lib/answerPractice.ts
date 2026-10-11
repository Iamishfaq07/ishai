import type { CreateSessionRequest, SavedAnswerInput } from "@orbit/types";

/**
 * The answer bank's "Practise it": a short mock round asking the saved question, out loud, then one follow-up that
 * pushes on the specifics behind the prepared answer (mock_interviewer.py, drill kind "answer").
 */
export function answerPracticeSession(saved: SavedAnswerInput): CreateSessionRequest {
  const answer = saved.answer.trim().replace(/\s+/g, " ");
  const feedback = `Their prepared answer: ${answer}`.slice(0, 400);
  return {
    title: `Answer practice — ${saved.question.trim()}`.slice(0, 200),
    type: "mock",
    language: "en",
    length: "standard",
    style: "natural",
    auto_answer: false,
    document_ids: [],
    mock: {
      duration_minutes: 5,
      drill: [{ question: saved.question.trim().slice(0, 400), kind: "answer" as const, follow_up: true, feedback }],
    },
  };
}
