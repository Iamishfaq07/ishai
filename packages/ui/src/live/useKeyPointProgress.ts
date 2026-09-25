import { useCallback, useMemo, useRef, useState } from "react";
import { applyOverrides, fallbackPoints, scoreKeyPoints, type KeyPointProgress } from "./coverage";
import type { AnswerView, LiveViewState } from "./reducer";

export interface KeyPoints {
  progress: KeyPointProgress;
  /** Manually tick / untick a point (the candidate knows better than the transcript). */
  toggle: (index: number) => void;
}

/**
 * Live key-point progress for the displayed answer. Ticks are sticky per answer (a point, once said, stays
 * ticked even if the transcript is later corrected), manual ticks override them, and everything resets when a
 * different answer is shown.
 */
export function useKeyPointProgress(live: LiveViewState, answer: AnswerView | null): KeyPoints | null {
  const memory = useRef<{ answerId: string | null; covered: Set<number> }>({ answerId: null, covered: new Set() });
  const [overrides, setOverrides] = useState<{ answerId: string | null; map: Map<number, boolean> }>({
    answerId: null,
    map: new Map(),
  });
  const spoken = useMemo(() => {
    if (!answer) return "";
    return live.turnOrder
      .slice(answer.spoken_from)
      .map((id) => live.turns[id])
      .filter((t) => t?.speaker === "candidate")
      .map((t) => t!.text)
      .join(" ");
  }, [live.turnOrder, live.turns, answer]);

  const progress = useMemo(() => {
    if (!answer) return null;
    let labels = answer.answer.key_points ?? [];
    if (labels.length === 0 && answer.status === "complete") labels = fallbackPoints(answer.answer.direct_answer);
    if (labels.length === 0) return null;
    if (memory.current.answerId !== answer.answer_id) memory.current = { answerId: answer.answer_id, covered: new Set() };
    const auto = scoreKeyPoints(labels, answer.answer.direct_answer, spoken, memory.current.covered);
    auto.points.forEach((p, i) => p.covered && memory.current.covered.add(i));
    return applyOverrides(auto, overrides.answerId === answer.answer_id ? overrides.map : new Map());
  }, [answer, spoken, overrides]);

  const shown = useRef(progress);
  shown.current = progress;
  const answerId = answer?.answer_id ?? null;
  const toggle = useCallback(
    (index: number) => {
      const point = shown.current?.points[index];
      if (!answerId || !point) return;
      setOverrides((prev) => {
        const map = new Map(prev.answerId === answerId ? prev.map : []);
        map.set(index, !point.covered);
        return { answerId, map };
      });
    },
    [answerId],
  );

  return useMemo(() => (progress ? { progress, toggle } : null), [progress, toggle]);
}
