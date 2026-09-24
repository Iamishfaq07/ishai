import { useMemo, useRef } from "react";
import { fallbackPoints, scoreKeyPoints, type KeyPointProgress } from "./coverage";
import type { AnswerView, LiveViewState } from "./reducer";

/**
 * Live key-point progress for the displayed answer. Ticks are sticky per answer (a point, once said, stays
 * ticked even if the transcript is later corrected), and everything resets when a different answer is shown.
 */
export function useKeyPointProgress(live: LiveViewState, answer: AnswerView | null): KeyPointProgress | null {
  const memory = useRef<{ answerId: string | null; covered: Set<number> }>({ answerId: null, covered: new Set() });
  const spoken = useMemo(() => {
    if (!answer) return "";
    return live.turnOrder
      .slice(answer.spoken_from)
      .map((id) => live.turns[id])
      .filter((t) => t?.speaker === "candidate")
      .map((t) => t!.text)
      .join(" ");
  }, [live.turnOrder, live.turns, answer]);

  return useMemo(() => {
    if (!answer) return null;
    let labels = answer.answer.key_points ?? [];
    if (labels.length === 0 && answer.status === "complete") labels = fallbackPoints(answer.answer.direct_answer);
    if (labels.length === 0) return null;
    if (memory.current.answerId !== answer.answer_id) memory.current = { answerId: answer.answer_id, covered: new Set() };
    const progress = scoreKeyPoints(labels, answer.answer.direct_answer, spoken, memory.current.covered);
    progress.points.forEach((p, i) => p.covered && memory.current.covered.add(i));
    return progress;
  }, [answer, spoken]);
}
