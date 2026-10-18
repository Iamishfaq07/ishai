import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, cx, focusRing, useMotion } from "@orbit/ui";
import { useNear } from "./motion";

/**
 * A row of cards that scrolls sideways (templates, job cards): native scrolling with snap points, so a swipe, a
 * trackpad and the arrow keys (the row takes focus) all work, plus Previous and Next buttons that move it one card.
 * It never moves on its own. Inside the page's width, so the page itself never scrolls sideways.
 *
 * `render(i, near)`: each card, told whether it's near the screen yet; a heavy card draws a placeholder until then
 * (the built HTML draws the first `eager` for real, the rest as placeholders with their words).
 */
export function Carousel({ label, count, render, eager = 3, itemClass }: {
  label: string;
  count: number;
  render: (i: number, near: boolean) => ReactNode;
  eager?: number;
  itemClass?: string;
}) {
  const track = useRef<HTMLUListElement>(null);
  const motion = useMotion();
  // Nothing more is drawn until the row itself is within a screen of the viewport.
  const [box, rowNear] = useNear<HTMLDivElement>();
  const [near, setNear] = useState<boolean[]>(() => Array.from({ length: count }, (_, i) => i < eager));
  const [ends, setEnds] = useState({ start: true, end: false });

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const onScroll = () => setEnds({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [count]);

  useEffect(() => {
    const el = track.current;
    if (!el || !rowNear) return;
    const items = [...el.children] as HTMLElement[];
    // Then a card is drawn once it's within the row's width of the row's visible part.
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).map((e) => items.indexOf(e.target as HTMLElement));
        if (seen.length) setNear((prev) => prev.map((v, i) => v || seen.includes(i)));
      },
      { root: el, rootMargin: "0px 100% 0px 100%" },
    );
    for (const item of items) io.observe(item);
    return () => io.disconnect();
  }, [count, rowNear]);

  const move = (dir: 1 | -1) => {
    const el = track.current;
    const first = el?.children[0] as HTMLElement | undefined;
    if (!el || !first) return;
    const step = first.getBoundingClientRect().width + parseFloat(getComputedStyle(el).columnGap || "0");
    el.scrollBy({ left: dir * step, behavior: motion === "full" ? "smooth" : "auto" });
  };

  const button = (dir: 1 | -1) => (
    <button
      type="button"
      onClick={() => move(dir)}
      disabled={dir === -1 ? ends.start : ends.end}
      aria-label={dir === -1 ? "Previous" : "Next"}
      className={cx(
        "grid h-10 w-10 place-items-center rounded-full border mk-line mk-surface text-zinc-700 transition-colors duration-quick hover:bg-zinc-50 active:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-white/5 dark:active:bg-white/10",
        focusRing,
      )}
    >
      {dir === -1 ? <ChevronLeft className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
    </button>
  );

  return (
    <div ref={box} role="region" aria-roledescription="carousel" aria-label={label}>
      <ul
        ref={track}
        tabIndex={0}
        aria-label={`${label}: scroll sideways or use the arrow keys`}
        className={cx("kp-track -mx-5 flex gap-4 overflow-x-auto scroll-px-5 px-5 pb-2 sm:-mx-8 sm:scroll-px-8 sm:px-8", focusRing)}
      >
        {Array.from({ length: count }, (_, i) => (
          <li key={i} aria-roledescription="slide" aria-label={`${i + 1} of ${count}`} className={cx("shrink-0", itemClass)}>
            {render(i, near[i] ?? false)}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex items-center justify-end gap-2">
        {button(-1)}
        {button(1)}
      </div>
    </div>
  );
}
