import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import { useMotion } from "../hooks/useMotion";
import { cx } from "./cx";

/**
 * Whether an element has scrolled into view (once: it stays true). True at once where IntersectionObserver is
 * missing, so nothing waits for an event that never comes.
 */
export function useInView<T extends Element>(rootMargin = "0px 0px -10% 0px"): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin, threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView];
}

/**
 * Content that rises into place the first time it scrolls into view. At Gentle it only fades; at Off (or with no
 * JavaScript, or when printing) it's simply there. `delay` staggers neighbours (ms). With `stagger` the element itself
 * stays put and its children come in one after another instead (a grid of cards). The CSS is `.reveal` and
 * `.reveal-stagger` in base.css.
 */
export function Reveal({
  as: Tag = "div",
  delay = 0,
  stagger = false,
  className,
  style,
  children,
  ...rest
}: {
  as?: ElementType;
  delay?: number;
  stagger?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
} & Record<string, unknown>) {
  const [ref, inView] = useInView<HTMLElement>();
  const motion = useMotion();
  return (
    <Tag
      ref={ref}
      data-shown={inView || motion !== "full" ? "" : undefined}
      className={cx(stagger ? "reveal-stagger" : "reveal", className)}
      style={delay ? { ...style, transitionDelay: `${delay}ms` } : style}
      {...rest}
    >
      {children}
    </Tag>
  );
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * A number that counts from `from` to `to` once `start` turns true (at Full motion; otherwise it's `to` straight
 * away). For scores and percentages drawn on illustrations. A render without the browser (the public pages built as
 * HTML: no IntersectionObserver, and no effects run) draws `to`, the finished number, not the one it starts from.
 */
export function useCountUp(to: number, start: boolean, { from = 0, duration = 1100 }: { from?: number; duration?: number } = {}): number {
  const motion = useMotion();
  const animate = motion === "full";
  const [value, setValue] = useState(animate && typeof IntersectionObserver !== "undefined" ? from : to);
  useEffect(() => {
    if (!animate) {
      setValue(to);
      return;
    }
    if (!start) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      setValue(from + (to - from) * easeOut(t));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animate, start, from, to, duration]);
  return value;
}

/**
 * A counted-up number in text, the first time it's in view. Screen readers get the final value only. `format` writes
 * it ("₹12,400", "3 days"), given the value rounded to `decimals`. Proportional figures, as a stat's number should have;
 * add `tabular-nums` to `className` where it lines up in a column.
 */
export function CountUp({
  to,
  from = 0,
  decimals = 0,
  suffix = "",
  format,
  className,
}: {
  to: number;
  from?: number;
  decimals?: number;
  suffix?: string;
  format?: (n: number) => string;
  className?: string;
}) {
  const [ref, inView] = useInView<HTMLSpanElement>();
  // A new value counts on from the last one, not from `from` again. A small step (3 applications) isn't counted at all:
  // "0, 1, 2, 3" in a second reads as a flicker of wrong numbers.
  const [range, setRange] = useState({ from: Math.abs(to - from) < 10 ? to : from, to });
  if (range.to !== to) setRange({ from: Math.abs(to - range.to) < 10 ? to : range.to, to });
  const value = useCountUp(range.to, inView, { from: range.from });
  const text = (n: number) => (format ? format(Number(n.toFixed(decimals))) : `${n.toFixed(decimals)}${suffix}`);
  return (
    <span ref={ref} className={className}>
      <span aria-hidden="true">{text(value)}</span>
      <span className="sr-only">{text(to)}</span>
    </span>
  );
}
