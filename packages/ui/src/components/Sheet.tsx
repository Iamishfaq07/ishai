import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { currentMotion } from "../hooks/useMotion";
import { usePresence } from "../hooks/usePresence";
import { X } from "../icons";
import { cx, focusRing } from "./cx";

/** Dialog width from `sm` up. Phones always use the full width, as a sheet from the bottom. */
export type SheetSize = "sm" | "md" | "lg" | "xl" | "2xl";

const WIDTH: Record<SheetSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
};

// Panels open on top of each other (a credits panel from an edit panel). The page stays still until the last one
// closes, in whatever order they close; each saving and restoring `overflow` itself would let the page scroll under
// a panel still open when the one below it closed first.
let locks = 0;
let lockedFrom = { overflow: "", gutter: "" };

/**
 * Stops the page scrolling until every caller has released it. Returns the release. It holds the page's own scroller
 * (<html>), not <body>: the app's html clips sideways (overflow-x), so a hidden overflow on body made body a box of
 * its own a screen tall, and a page scrolled down showed blank (or jumped to its top) behind the dialog. A classic
 * scrollbar's space stays reserved while it's hidden, so nothing shifts sideways either.
 */
export function lockScroll(): () => void {
  const root = document.documentElement;
  if (locks++ === 0) {
    lockedFrom = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
    const bar = typeof window !== "undefined" ? window.innerWidth - root.clientWidth : 0;
    if (bar > 0) root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) {
      root.style.overflow = lockedFrom.overflow;
      root.style.scrollbarGutter = lockedFrom.gutter;
    }
  };
}

// Open panels, newest last, so the one underneath can tell when it's on top again (its light sweeps once more).
const stack: object[] = [];
const listeners = new Set<() => void>();
function changed() {
  for (const fn of listeners) fn();
}

/**
 * A light sweeps along the panel's top edge when it opens and when a panel opened over it closes: the key bumps
 * each time it becomes the top one.
 */
function useSweep(open: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!open) return;
    const me = {};
    stack.push(me);
    let top = true;
    const onChange = () => {
      const now = stack[stack.length - 1] === me;
      if (now && !top) setN((x) => x + 1);
      top = now;
    };
    listeners.add(onChange);
    changed();
    return () => {
      listeners.delete(onChange);
      stack.splice(stack.indexOf(me), 1);
      changed();
    };
  }, [open]);
  return n;
}

const MORPH = "height 240ms cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * When the panel's content grows or shrinks (a step changes, an error appears), its height glides to the new size
 * instead of jumping. The content is measured inside the scroll area, where the panel's own height can't affect it.
 */
function useMorph(open: boolean) {
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = panel.current;
    const inner = content.current;
    if (!open || !box || !inner || typeof ResizeObserver === "undefined") return;
    let last = inner.offsetHeight;
    let shown = box.offsetHeight;
    const settle = () => {
      box.style.height = "";
      box.style.transition = "";
      shown = box.offsetHeight;
    };
    const ro = new ResizeObserver(() => {
      const next = inner.offsetHeight;
      const delta = next - last;
      last = next;
      if (!delta || currentMotion() !== "full") return void (shown = box.offsetHeight);
      const from = shown;
      box.style.transition = "";
      box.style.height = "";
      const to = box.offsetHeight; // the natural height now (capped by max-height)
      if (to === from) return;
      box.style.height = `${from}px`;
      void box.offsetHeight; // start from the old height
      box.style.transition = MORPH;
      box.style.height = `${to}px`;
      shown = to;
    });
    box.addEventListener("transitionend", settle);
    ro.observe(inner);
    return () => {
      ro.disconnect();
      box.removeEventListener("transitionend", settle);
      settle();
    };
  }, [open]);
  return { panel, content };
}

/** A closing panel plays its exit for this long (--dur-quick) before it leaves the page. */
const EXIT_MS = 160;

/**
 * The one modal panel (also exported as `Dialog`). `placement="center"` (the default) is a sheet from the bottom on phones and a centred dialog
 * from `sm` up. `placement="end"` is a full-height panel from the right, under confirm dialogs. Rendered on
 * `document.body` so a sticky bar cannot cover it. Focus moves in, stays in, and returns on close. Escape, the
 * close button and a press on the backdrop close it. The page behind does not scroll.
 * Closing plays a short exit (a dialog settles back as it fades, a phone sheet drops away, a side panel slides out;
 * a fade at Gentle, nothing at Off): for that moment it shows what it last showed, is no longer a dialog to screen
 * readers, and lets presses through to the page.
 */
export function Sheet({
  open,
  onClose,
  title,
  titleId,
  children,
  className,
  size = "lg",
  footer,
  placement = "center",
  detail,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Defaults to a generated id. Pass one when something else must point at the title. */
  titleId?: string;
  children: ReactNode;
  className?: string;
  size?: SheetSize;
  /** Pinned under the scrolling body (the main action stays in view). */
  footer?: ReactNode;
  /** `center` is a sheet on phones and a dialog from `sm` up. `end` is a full-height panel from the right. */
  placement?: "center" | "end";
  /** Lines under the title (an email, badges). Not inside the heading. */
  detail?: ReactNode;
}) {
  const generatedId = useId();
  const labelId = titleId ?? generatedId;
  const ref = useFocusTrap<HTMLDivElement>(open, { onEscape: onClose });
  const sweep = useSweep(open);
  const { panel, content } = useMorph(open);
  const { mounted, leaving } = usePresence(open, EXIT_MS);
  // While it leaves, it keeps showing what it showed when it was open (the caller may already have cleared it).
  const shown = useRef({ title, children, footer, detail });
  if (open) shown.current = { title, children, footer, detail };
  const view = shown.current;

  useEffect(() => {
    if (!open) return;
    return lockScroll();
  }, [open]);

  if (!mounted || typeof document === "undefined") return null;

  const end = placement === "end";
  return createPortal(
    <div
      inert={leaving || undefined}
      aria-hidden={leaving || undefined}
      className={cx(
        end
          ? "fixed inset-0 z-dialog flex justify-end bg-zinc-950/40"
          : "fixed inset-0 z-dialog flex items-end justify-center bg-zinc-950/50 sm:items-center sm:p-4",
        leaving ? "pointer-events-none animate-fade-out" : "animate-fade-in",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !leaving) onClose();
      }}
    >
      <div
        ref={(el) => {
          ref.current = el;
          panel.current = el;
        }}
        role={leaving ? undefined : "dialog"}
        aria-modal={leaving ? undefined : "true"}
        aria-labelledby={leaving ? undefined : labelId}
        className={
          end
            ? cx(
                "relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-zinc-200 bg-zinc-50 shadow-dialog dark:border-white/10 dark:bg-zinc-950",
                leaving ? "animate-panel-out" : "animate-panel-in",
                className,
              )
            : cx(
                // Phones: a sheet that rises from the bottom edge. From sm: a dialog that fades in from a touch smaller.
                // 88% of the screen as it is now (dvh), not of the screen with Safari's bars hidden (vh): the top of a
                // tall sheet stayed under the address bar.
                "relative flex max-h-[88vh] supports-[height:100dvh]:max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-zinc-200 bg-white shadow-dialog sm:rounded-2xl dark:border-white/10 dark:bg-zinc-950",
                leaving ? "animate-sheet-down sm:animate-dialog-out" : "animate-sheet-up sm:animate-dialog-in",
                WIDTH[size],
                !view.footer && "pb-[env(safe-area-inset-bottom)]",
                className,
              )
        }
      >
        <span key={sweep} aria-hidden="true" className="sheet-sweep" />
        <div
          className={cx(
            "flex shrink-0 gap-3 border-b",
            end
              ? "items-start border-zinc-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-zinc-950 sm:px-5"
              : "items-center border-zinc-200/70 px-5 py-3.5 dark:border-white/10",
          )}
        >
          <div className="min-w-0 flex-1">
            <h2 id={leaving ? undefined : labelId} className="truncate font-display text-lg font-semibold tracking-tight">
              {view.title}
            </h2>
            {view.detail}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cx(
              "hit-area relative -mr-1.5 flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 active:bg-zinc-900/10 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white dark:active:bg-white/10",
              focusRing,
            )}
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div ref={content}>{view.children}</div>
        </div>
        {view.footer && (
          <div className="shrink-0 border-t border-zinc-200 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-white/10">
            {view.footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The modal dialog: the same component as Sheet (a bottom sheet on phones, a centred dialog from sm up). */
export const Dialog = Sheet;

/**
 * A dialog's footer buttons, in one order everywhere: the way out first, the main action last (rightmost from sm
 * up). On a phone they stack full width with the main action on top, nearest the thumb.
 */
export function DialogActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end [&>*]:w-full sm:[&>*]:w-auto", className)}>
      {children}
    </div>
  );
}
