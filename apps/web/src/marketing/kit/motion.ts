import { useEffect, useRef, useState } from "react";
import { useInView, useMotion } from "@orbit/ui";

/**
 * How the product pages' renders move (DECISIONS D79): each one plays a short sequence the first time it's in view,
 * then rests on its final frame. Its CSS parts (`.kp-*` in site.css) play when the box gets `data-shown`; its
 * JavaScript parts (typing, counting, steps) follow a clock that starts at the same moment.
 *
 * - Full motion: the sequence plays once.
 * - Gentle: the final frame at once (nothing moves or waits its turn); only a fade that marks a change, the tracker
 *   card's landing ring, plays when the render is seen.
 * - Off, data saver, and the HTML the build writes (prerender/shim.ts turns data saver on): the final frame from the
 *   start, `data-still` keeping the CSS parts in place too.
 *
 * Nothing here touches the browser at module scope or while rendering, so the pages render in the build.
 */

/** Data saver: the visitor asked for less, so pictures draw finished (as the front page's live answer does). */
function saveData(): boolean {
  return typeof navigator !== "undefined" && Boolean((navigator as { connection?: { saveData?: boolean } }).connection?.saveData);
}

export interface Play<T extends Element> {
  ref: React.RefObject<T | null>;
  /** It has been in view (true at once in the build, and wherever IntersectionObserver is missing). */
  shown: boolean;
  /** Its JavaScript sequence may run: Full motion, no data saver, in a browser. */
  play: boolean;
  /** For the box: `className="kp"` plus these. */
  attrs: { "data-shown"?: ""; "data-still"?: "" };
}

export function usePlay<T extends Element>(): Play<T> {
  const [ref, inView] = useInView<T>();
  const motion = useMotion();
  const still = saveData() || typeof IntersectionObserver === "undefined" || motion === "off";
  const play = motion === "full" && !still;
  const shown = inView || still;
  return {
    ref,
    shown,
    play,
    attrs: { ...(shown ? { "data-shown": "" as const } : {}), ...(still ? { "data-still": "" as const } : {}) },
  };
}

/**
 * Milliseconds since the sequence started (from `start`, once `play`), up to `end`; Infinity when it isn't playing or
 * has finished, so "t >= x" is the final frame everywhere else. `run` restarts it (Play again).
 */
export function useClock(start: boolean, play: boolean, end: number, run = 0): number {
  const [t, setT] = useState(() => (play ? 0 : Infinity));
  useEffect(() => {
    if (!play) {
      setT(Infinity);
      return;
    }
    if (!start) return;
    setT(0);
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now() - t0;
      if (now >= end) {
        setT(Infinity);
        window.clearInterval(id);
      } else setT(now);
    }, 50);
    return () => window.clearInterval(id);
  }, [start, play, end, run]);
  return t;
}

/** The words of `text` shown at time `t` when they're typed from `at`, one every `every` ms (all of them once done). */
export function typedWords(text: string, t: number, at: number, every = 45): { shown: string; typing: boolean } {
  const words = text.split(" ");
  if (t === Infinity) return { shown: text, typing: false };
  const n = Math.max(0, Math.min(words.length, Math.floor((t - at) / every)));
  return { shown: words.slice(0, n).join(" "), typing: n > 0 && n < words.length };
}

/** How many of the steps at these times (ms) have happened by `t`. */
export function stepsDone(times: readonly number[], t: number): number {
  return times.filter((at) => t >= at).length;
}

/** A CSS part's delay: `style={at(600)}` sets --d (and optionally --x/--y for `.kp-in`). */
export function at(ms: number, from?: { x?: number; y?: number }): React.CSSProperties {
  const style: Record<string, string> = { "--d": `${ms}ms` };
  if (from?.x !== undefined) style["--x"] = `${from.x}px`;
  if (from?.y !== undefined) style["--y"] = `${from.y}px`;
  return style as React.CSSProperties;
}

/**
 * Whether a heavy render (a whole resume page) should be drawn yet: once it's within a screen of the viewport. The
 * built HTML draws the light placeholder instead (there's no IntersectionObserver there), keeping the page small.
 */
export function useNear<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: "100% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near];
}
