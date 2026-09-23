import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

const NEAR_BOTTOM_PX = 48;

/**
 * Follows new content at the bottom *only* while the user is already at the bottom.
 * Once they scroll up to read, position is left alone until they return (or click "Jump to latest").
 */
export function useStickyScroll<T extends HTMLElement>(
  dependency: unknown,
): { ref: RefObject<T>; atBottom: boolean; jumpToLatest: () => void; onScroll: () => void } {
  const ref = useRef<T>(null);
  const stickRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
    stickRef.current = near;
    setAtBottom(near);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [dependency]);

  const jumpToLatest = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setAtBottom(true);
  }, []);

  return { ref, atBottom, jumpToLatest, onScroll };
}
