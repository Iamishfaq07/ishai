import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";

/** Hover this long before a tooltip shows (a pointer passing over shouldn't light them up). */
const DELAY_MS = 400;
/** Within this long of one closing, the next one shows at once and without its fade (moving along a toolbar). */
const WARM_MS = 500;
let lastClosed = 0;
let openCount = 0;

type Handler<E> = ((e: E) => void) | undefined;
const chain =
  <E,>(a: Handler<E>, b: (e: E) => void) =>
  (e: E) => {
    a?.(e);
    b(e);
  };

/**
 * A short label shown on hover (after a moment) and on keyboard focus (at once), never on a click or a tap. It only
 * repeats or adds to what's on screen: never put information people need only there (phones can't hover). Escape,
 * a press, a scroll or the pointer leaving hide it. Drawn on the page's top layer (a portal, fixed in place), so a
 * card's edge or a dialog can't clip it, and it adds nothing to the layout: the child is the only element in place.
 * `describe` (the default) also makes it the child's description for screen readers; IconButton turns that off,
 * since its tooltip is its name.
 */
export function Tooltip({
  content,
  children,
  side = "top",
  describe = true,
}: {
  content: ReactNode;
  children: ReactElement<Record<string, unknown>>;
  side?: "top" | "bottom";
  describe?: boolean;
}) {
  const [open, setOpen] = useState<false | { warm: boolean }>(false);
  const [ready, setReady] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  useEffect(() => setReady(true), []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const show = (el: HTMLElement, delay: number) => {
    anchor.current = el;
    clearTimeout(timer.current);
    const warm = openCount > 0 || Date.now() - lastClosed < WARM_MS;
    if (warm || delay === 0) return setOpen({ warm });
    timer.current = setTimeout(() => setOpen({ warm: false }), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  // While open: count it (so a neighbour shows warm), and close on Escape, a press, a scroll or a resize.
  useEffect(() => {
    if (!open) return;
    openCount++;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", hide, { capture: true, passive: true });
    window.addEventListener("resize", hide);
    return () => {
      openCount--;
      lastClosed = Date.now();
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", hide, { capture: true });
      window.removeEventListener("resize", hide);
    };
  }, [open]);

  // Placed before it paints: above its element (below when there's no room), kept inside the window.
  useLayoutEffect(() => {
    const el = anchor.current;
    const tip = bubble.current;
    if (!open || !el || !tip) return;
    const a = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const below = side === "bottom" ? a.bottom + 6 + h < window.innerHeight - 4 : a.top - 6 - h < 4;
    const left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), window.innerWidth - w - 8);
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(below ? a.bottom + 6 : a.top - 6 - h)}px`;
    tip.style.setProperty("--tip-from", below ? "-2px" : "2px");
    tip.style.visibility = "";
  }, [open, side]);

  if (!isValidElement(children)) return children;
  const props = children.props;
  const child = cloneElement(children, {
    "aria-describedby": describe ? cx(props["aria-describedby"] as string | undefined, id) || undefined : props["aria-describedby"],
    onPointerEnter: chain(props.onPointerEnter as Handler<PointerEvent<HTMLElement>>, (e) => e.pointerType === "mouse" && show(e.currentTarget, DELAY_MS)),
    onPointerLeave: chain(props.onPointerLeave as Handler<PointerEvent<HTMLElement>>, hide),
    onPointerDown: chain(props.onPointerDown as Handler<PointerEvent<HTMLElement>>, hide),
    onFocus: chain(props.onFocus as Handler<FocusEvent<HTMLElement>>, (e) => e.currentTarget.matches(":focus-visible") && show(e.currentTarget, 0)),
    onBlur: chain(props.onBlur as Handler<FocusEvent<HTMLElement>>, hide),
  });
  return (
    <>
      {child}
      {ready &&
        createPortal(
          <>
            {/* The words for screen readers, always there to be pointed at. */}
            {describe && (
              <span id={id} hidden>
                {content}
              </span>
            )}
            {open && (
              <span
                ref={bubble}
                aria-hidden="true"
                data-warm={open.warm || undefined}
                style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
                className={cx(
                  "pointer-events-none z-tooltip w-max max-w-[min(18rem,calc(100vw-1rem))] rounded-lg bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-popover dark:bg-zinc-100 dark:text-zinc-900",
                  !open.warm && "tooltip-bubble",
                )}
              >
                {content}
              </span>
            )}
          </>,
          document.body,
        )}
    </>
  );
}
