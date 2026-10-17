import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { stickItems, stickJump, stickScrolled, stickStart, type StickState } from "../live/stickToBottom";
import { useMotion } from "./useMotion";

/**
 * Follows new content at the bottom *only* while the user is already there (within 48 px). Once they scroll up to
 * read, their position is left alone (and new lines are counted, `unseen`) until they come back down or press "Jump
 * to latest", which scrolls down (smoothly at Full motion, at once otherwise) and follows again.
 *
 * Following happens in the same frame as the change, before paint, so nothing jumps: a layout effect when
 * `dependency` changes, and observers for everything else that moves the bottom (a line still being heard growing,
 * the panel resizing, a chat answer streaming in). Scrolls the hook makes itself are told apart from the user's.
 *
 * `ref` is a callback ref for the scrolling element (it may mount later, e.g. after an empty state); `count` is the
 * number of finished lines, for the "new" count.
 */
export function useStickyScroll<T extends HTMLElement>(
  dependency: unknown,
  { count = 0 }: { count?: number } = {},
): { ref: (el: T | null) => void; atBottom: boolean; unseen: number; jumpToLatest: () => void; onScroll: () => void } {
  const el = useRef<T | null>(null);
  const [state, setState] = useState<StickState>(() => stickStart(count));
  const motion = useMotion();
  const live = useRef({ state, count, motion });
  live.current = { state, count, motion };
  // The scrollTop the hook set last (its scroll event isn't the user's), and until when a smooth jump is running.
  const expected = useRef<number | null>(null);
  const jumping = useRef(0);
  const observers = useRef<{ resize: ResizeObserver; mutate: MutationObserver } | null>(null);

  const pin = useCallback(() => {
    const node = el.current;
    if (!node || !live.current.state.stuck || jumping.current > performance.now()) return;
    const bottom = node.scrollHeight - node.clientHeight;
    if (Math.abs(node.scrollTop - bottom) < 1) return;
    expected.current = bottom;
    node.scrollTop = bottom;
  }, []);

  const cancelJump = useCallback(() => {
    jumping.current = 0;
  }, []);

  const ref = useCallback(
    (node: T | null) => {
      if (el.current === node) return;
      observers.current?.resize.disconnect();
      observers.current?.mutate.disconnect();
      el.current?.removeEventListener("wheel", cancelJump);
      el.current?.removeEventListener("touchstart", cancelJump);
      el.current?.removeEventListener("keydown", cancelJump);
      el.current = node;
      observers.current = null;
      if (!node) return;
      const resize = new ResizeObserver(pin);
      resize.observe(node);
      for (const child of Array.from(node.children)) resize.observe(child);
      const mutate = new MutationObserver((records) => {
        for (const r of records) r.addedNodes.forEach((n) => n.parentNode === node && n instanceof Element && resize.observe(n));
        pin();
      });
      mutate.observe(node, { childList: true, subtree: true, characterData: true });
      observers.current = { resize, mutate };
      // The user taking over (a wheel, a touch, a key) stops a smooth jump in its tracks.
      node.addEventListener("wheel", cancelJump, { passive: true });
      node.addEventListener("touchstart", cancelJump, { passive: true });
      node.addEventListener("keydown", cancelJump);
      pin();
    },
    [pin, cancelJump],
  );

  useLayoutEffect(() => () => ref(null), [ref]);
  useLayoutEffect(pin, [dependency, pin]);
  useLayoutEffect(() => setState((s) => stickItems(s, count)), [count]);

  const onScroll = useCallback(() => {
    const node = el.current;
    if (!node) return;
    if (expected.current !== null && Math.abs(node.scrollTop - expected.current) < 2) {
      expected.current = null;
      return;
    }
    expected.current = null;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (jumping.current > performance.now()) {
      if (distance > 1) return; // still on its way down
      jumping.current = 0;
    }
    setState((s) => stickScrolled(s, distance, live.current.count));
  }, []);

  const jumpToLatest = useCallback(() => {
    const node = el.current;
    setState((s) => stickJump(s, live.current.count));
    if (!node) return;
    const bottom = node.scrollHeight - node.clientHeight;
    if (live.current.motion === "full" && typeof node.scrollTo === "function") {
      jumping.current = performance.now() + 900;
      node.scrollTo({ top: bottom, behavior: "smooth" });
      // Lines that arrived on the way down: catch up once it lands.
      window.setTimeout(() => {
        jumping.current = 0;
        pin();
      }, 920);
    } else {
      expected.current = bottom;
      node.scrollTop = bottom;
    }
  }, [pin]);

  return { ref, atBottom: state.stuck, unseen: state.unseen, jumpToLatest, onScroll };
}
