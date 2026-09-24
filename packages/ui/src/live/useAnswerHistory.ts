import { useCallback, useMemo } from "react";
import { selectAnswerHistory, selectDisplayedAnswer, type LiveViewState } from "./reducer";
import type { LiveActions } from "./useLiveSession";

export interface AnswerHistory {
  history: string[];
  /** Position of the displayed answer in `history` (last = live). */
  index: number;
  browsing: boolean;
  /** A newer answer arrived while browsing. */
  newAnswer: boolean;
  step: (delta: number) => void;
  backToLive: () => void;
}

/** Flip back through earlier answers. Stepping onto the newest answer means "follow live" again. */
export function useAnswerHistory(live: LiveViewState, actions: Pick<LiveActions, "viewAnswer">): AnswerHistory {
  const history = useMemo(() => selectAnswerHistory(live), [live]);
  const shownId = selectDisplayedAnswer(live)?.answer_id ?? null;
  const found = shownId ? history.indexOf(shownId) : -1;
  const index = found === -1 ? history.length - 1 : found;
  const browsing = live.viewedAnswerId !== null && !live.pinnedAnswerId;
  const newAnswer = browsing && live.currentAnswerId !== null && live.currentAnswerId !== live.viewedAnswerId;
  const pinned = live.pinnedAnswerId !== null;
  const step = useCallback(
    (delta: number) => {
      if (pinned || history.length === 0) return;
      const to = Math.min(history.length - 1, Math.max(0, index + delta));
      actions.viewAnswer(to === history.length - 1 ? null : (history[to] ?? null));
    },
    [actions, history, index, pinned],
  );
  const backToLive = useCallback(() => actions.viewAnswer(null), [actions]);
  return { history, index, browsing, newAnswer, step, backToLive };
}
