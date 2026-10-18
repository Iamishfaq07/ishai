import { useEffect, useState } from "react";

/** Cards drawn in the first frame, and how many more each idle moment after (docs/PERFORMANCE.md). */
export const FIRST_BATCH = 24;
export const NEXT_BATCH = 40;

/** How many of `total` items to draw after one more step (never fewer than now, never more than there are). */
export function nextCount(current: number, total: number, step = NEXT_BATCH): number {
  return Math.min(total, Math.max(current, 0) + step);
}

/**
 * Long lists drawn a batch at a time: the first `first` items at once, the rest in idle moments after, until all of
 * them are there. A 400-job tracker drawn in one go held a phone's main thread for seconds (every tap waited); in
 * batches the page answers between them, and the whole list is still drawn within a second or so.
 */
export function useProgressiveCount(total: number, first = FIRST_BATCH, step = NEXT_BATCH): number {
  // The first batch is always there, also when the items arrive after the first render (a list still loading).
  const [count, setCount] = useState(first);
  const shown = Math.min(total, Math.max(count, first));
  const done = shown >= total;
  useEffect(() => {
    if (done) return;
    const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const cancelIdle = (window as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    const grow = () => setCount((c) => nextCount(Math.max(c, first), total, step));
    if (idle && cancelIdle) {
      const id = idle(grow, { timeout: 200 });
      return () => cancelIdle(id);
    }
    const id = window.setTimeout(grow, 16);
    return () => window.clearTimeout(id);
  }, [shown, done, total, first, step]);
  return shown;
}
