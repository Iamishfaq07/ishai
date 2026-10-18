import { useLayoutEffect, useRef, type RefObject } from "react";
import { currentMotion } from "./useMotion";

/**
 * Lists that change in place (DESIGN.md "Interaction"): when items are added, removed or reordered, the ones that stay
 * glide to their new places (FLIP: where each was drawn just before the change, then played from there with a
 * transform), a new one fades and rises in, and a removed one fades out where it was, under the others as they close
 * the gap. A card moved from one column to another (the tracker's board) glides across, as long as both columns are
 * inside the same container.
 *
 *   const list = useFlip<HTMLUListElement>(items.map((i) => i.id).join());
 *   <ul ref={list}>{items.map((i) => <li key={i.id} data-flip={i.id}>…</li>)}</ul>
 *
 * `key` changes when the list does. The "before" places are read while the component renders the change, just ahead
 * of React applying it, so nothing that moved earlier (a chart loading above, a scroll) can make an item jump. Only
 * transform and opacity animate, so nothing around the list shifts (no layout shift); the list's own height changes
 * at once. Full motion moves; Gentle only fades items in and out; Off changes the list at once. The first render
 * never animates. Table rows don't get an exit (a row can't float free of its table).
 */

type Box = { x: number; y: number; w: number; h: number };

const MOVE_MS = 240; // --dur-panel
const ENTER_MS = 240;
const EXIT_MS = 140;
const EASE_STANDARD = "cubic-bezier(0.2, 0, 0, 1)";
const EASE_ENTER = "cubic-bezier(0.05, 0.7, 0.1, 1)";
/** Past this many items a change just happens: measuring hundreds of cards on every change isn't worth it. */
const MAX_ITEMS = 200;


/** The list's own items (an item of a list nested inside belongs to that list's hook). */
function items(root: HTMLElement): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-flip]")) {
    const owner = el.parentElement?.closest("[data-flip-root]");
    if (owner && owner !== root) continue;
    const key = el.dataset.flip;
    if (key && !out.has(key)) out.set(key, el);
  }
  return out;
}

/** Where each item is drawn on screen right now (with any animation it's playing). Hidden ones are left out. */
function drawn(root: HTMLElement): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const [key, el] of items(root)) {
    const r = el.getBoundingClientRect();
    if (r.width || r.height) out.set(key, { x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return out;
}

/** The translation an element's own FLIP animation adds right now (0 when none is playing). */
function offsetOf(el: Element, playing: WeakMap<Element, Animation>): { x: number; y: number } {
  const a = playing.get(el);
  if (!a || a.playState !== "running") return { x: 0, y: 0 };
  const t = getComputedStyle(el).transform;
  if (!t || t === "none" || typeof DOMMatrixReadOnly === "undefined") return { x: 0, y: 0 };
  const m = new DOMMatrixReadOnly(t);
  return { x: m.m41, y: m.m42 };
}

/**
 * A removed item's copy, fading where the item was drawn. It goes first in the list, so the items that stay (drawn
 * after it) pass over it, and it's `hidden` to the list's spacing rules (Tailwind's space-y / divide-y skip
 * [hidden]), so nothing else moves for it. Inert and hidden from screen readers; gone once it has played.
 */
function ghost(root: HTMLElement, node: HTMLElement, box: Box, full: boolean) {
  const g = node.cloneNode(true) as HTMLElement;
  for (const el of [g, ...g.querySelectorAll<HTMLElement>("[id], [data-flip]")]) {
    el.removeAttribute("id");
    el.removeAttribute("data-flip");
  }
  g.hidden = true;
  g.inert = true;
  g.setAttribute("aria-hidden", "true");
  g.setAttribute("data-flip-ghost", "");
  Object.assign(g.style, {
    position: "absolute",
    margin: "0",
    left: "0px",
    top: "0px",
    width: `${box.w}px`,
    height: `${box.h}px`,
    boxSizing: "border-box",
    pointerEvents: "none",
  });
  root.insertBefore(g, root.firstChild);
  // [hidden] hides an item that has no display class of its own: show it (the spacing rules still skip it).
  if (getComputedStyle(g).display === "none") g.style.display = "block";
  const at = g.getBoundingClientRect();
  g.style.left = `${box.x - at.left}px`;
  g.style.top = `${box.y - at.top}px`;
  const frames = full ? [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.98)" }] : [{ opacity: 1 }, { opacity: 0 }];
  const a = g.animate(frames, { duration: EXIT_MS, easing: EASE_STANDARD, fill: "forwards" });
  const done = () => g.remove();
  a.onfinish = done;
  a.oncancel = done;
  setTimeout(done, EXIT_MS + 250);
}

export function useFlip<T extends HTMLElement>(
  key: unknown,
  { enter = true, exit = true, ref: given }: { enter?: boolean; exit?: boolean; ref?: RefObject<T | null> } = {},
): RefObject<T | null> {
  const own = useRef<T>(null);
  const ref = given ?? own;
  const committed = useRef<{ key: unknown } | null>(null);
  const before = useRef<Map<string, Box> | null>(null);
  const playing = useRef(new WeakMap<Element, Animation>());
  // Records the list's removals as React makes them; the effect takes the records in the same task (takeRecords), so
  // an exit can show a copy of exactly what was there. It stays connected across changes (disconnecting would drop
  // what it had just recorded) and moves only if the list's element does.
  const watcher = useRef<{ el: HTMLElement; mo: MutationObserver } | null>(null);

  // Rendering a change: read where everything is drawn now, before React applies it (getSnapshotBeforeUpdate's job).
  const current = ref.current;
  if (current && committed.current && !Object.is(committed.current.key, key) && currentMotion() !== "off") before.current = drawn(current);

  useLayoutEffect(() => {
    const el = ref.current;
    const was = before.current;
    before.current = null;
    const first = committed.current === null;
    committed.current = { key };
    if (!el) return;
    el.setAttribute("data-flip-root", "");
    // What React just took out of the list.
    const gone = new Map<string, HTMLElement>();
    for (const r of watcher.current?.el === el ? watcher.current.mo.takeRecords() : [])
      for (const node of r.removedNodes) if (node instanceof HTMLElement && !node.isConnected && node.dataset.flip) gone.set(node.dataset.flip, node);
    if (exit && watcher.current?.el !== el && typeof MutationObserver !== "undefined") {
      watcher.current?.mo.disconnect();
      const mo = new MutationObserver(() => undefined);
      mo.observe(el, { childList: true, subtree: true });
      watcher.current = { el, mo };
    }
    const motion = currentMotion();
    if (first || !was || motion === "off") return;
    const now = items(el);
    if (now.size > MAX_ITEMS) return;
    // Removed: a copy fades where it was. An item that moved to another column is still here under its key, so it
    // glides instead.
    if (exit)
      for (const [k, box] of was) {
        const node = gone.get(k);
        if (!now.has(k) && node && node.tagName !== "TR") ghost(el, node, box, motion === "full");
      }
    for (const [k, item] of now) {
      const old = was.get(k);
      if (!old) {
        if (enter && item.getBoundingClientRect().height)
          item.animate(
            motion === "full" ? [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }],
            { duration: ENTER_MS, easing: EASE_ENTER },
          );
        continue;
      }
      if (motion !== "full") continue;
      // From where it was drawn to where it's laid out now (without what a move still playing adds).
      const r = item.getBoundingClientRect();
      const off = offsetOf(item, playing.current);
      const dx = old.x - (r.left - off.x);
      const dy = old.y - (r.top - off.y);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      playing.current.get(item)?.cancel();
      playing.current.set(item, item.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: MOVE_MS, easing: EASE_STANDARD }));
    }
  }, [key, ref, enter, exit]);

  useLayoutEffect(
    () => () => {
      watcher.current?.mo.disconnect();
      watcher.current = null;
    },
    [],
  );

  return ref;
}
