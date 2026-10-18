import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Where a sliding indicator sits (the pill under a segmented control's choice, the line under the chosen tab): the
 * chosen item's left edge and width inside `list`, read before paint whenever `key` changes and again whenever the
 * list or an item changes size (a font arriving, the window narrowing), so the indicator never sits askew.
 */
export function useIndicator(list: RefObject<HTMLElement | null>, selector: string, key: string): { left: number; width: number } | null {
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const read = () => {
      const el = root.querySelector<HTMLElement>(selector);
      setMark((m) => {
        if (!el) return null;
        const next = { left: el.offsetLeft, width: el.offsetWidth };
        return m && m.left === next.left && m.width === next.width ? m : next;
      });
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(root);
    for (const child of root.children) ro.observe(child);
    return () => ro.disconnect();
  }, [list, selector, key]);
  return mark;
}
