import { useCallback, useMemo } from "react";
import { selectAnswerHistory, selectDisplayedAnswer, type LiveViewState } from "./reducer";
import type { LiveActions } from "./useLiveSession";

export interface HistoryNav {
  history: string[];
  /**
   * Where the shown answer sits: an index into `history`, or `history.length` (one past the end) when it isn't in
   * the list (still being written, failed, stopped before its first words) or nothing is shown (after Clear).
   */
  index: number;
  /** Where "live" is: the newest entry when the live answer is in the list, else one past the end. */
  liveIndex: number;
  /** For the "3 of 5" counter: the shown answer's number out of `total` (null when nothing is shown). */
  position: number | null;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  browsing: boolean;
  /** A newer answer arrived since browsing began. */
  newAnswer: boolean;
}

export interface AnswerHistory extends HistoryNav {
  step: (delta: number) => void;
  backToLive: () => void;
}

/** The history strip for this state (pure; useAnswerHistory adds the actions). */
export function answerHistoryNav(live: LiveViewState): HistoryNav {
  const history = selectAnswerHistory(live);
  const last = history.length - 1;
  const liveId = live.currentAnswerId;
  // Live is the newest entry once its answer has words. While it's still thinking, after it failed, or after Clear it
  // isn't in the list, and live is one step past the end: ‹ lands on the newest entry instead of skipping it, and ›
  // from there comes back.
  const liveIndex = liveId !== null && history[last] === liveId ? last : history.length;
  const shown = selectDisplayedAnswer(live);
  const found = shown ? history.indexOf(shown.answer_id) : -1;
  const index = found === -1 ? liveIndex : found;
  // A live answer outside the list is numbered after it ("4 of 4" while it's thinking); nothing shown has no number.
  const liveOutside = liveId !== null && liveId in live.answers && liveIndex === history.length;
  const total = history.length + (liveOutside ? 1 : 0);
  const pinned = live.pinnedAnswerId !== null;
  const browsing = live.viewedAnswerId !== null && !pinned;
  return {
    history,
    index,
    liveIndex,
    position: found !== -1 ? found + 1 : shown ? total : null,
    total,
    canPrev: !pinned && index > 0,
    canNext: !pinned && index < liveIndex,
    browsing,
    newAnswer: browsing && live.currentAnswerId !== live.browseFromAnswerId,
  };
}

/** "3 of 5", or "3 earlier answers" when nothing is shown (after Clear). */
export function historyLabel({ position, total }: Pick<HistoryNav, "position" | "total">): string {
  if (position !== null) return `${position} of ${total}`;
  return `${total} earlier answer${total === 1 ? "" : "s"}`;
}

/** Where a step goes: the answer to show, null for live, or undefined when there's nowhere to go (or it's pinned). */
export function stepTarget(nav: HistoryNav, delta: number): string | null | undefined {
  if (delta < 0 ? !nav.canPrev : !nav.canNext) return undefined;
  const to = Math.min(nav.liveIndex, Math.max(0, nav.index + delta));
  if (to === nav.index) return undefined;
  return to === nav.liveIndex ? null : (nav.history[to] ?? null);
}

/** Flip back through earlier answers. Stepping onto the live position means "follow live" again. */
export function useAnswerHistory(live: LiveViewState, actions: Pick<LiveActions, "viewAnswer">): AnswerHistory {
  const nav = useMemo(() => answerHistoryNav(live), [live]);
  const step = useCallback(
    (delta: number) => {
      const to = stepTarget(nav, delta);
      if (to !== undefined) actions.viewAnswer(to);
    },
    [actions, nav],
  );
  const backToLive = useCallback(() => actions.viewAnswer(null), [actions]);
  return { ...nav, step, backToLive };
}
