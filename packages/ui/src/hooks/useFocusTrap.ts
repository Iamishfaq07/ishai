import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// Open dialogs, newest last. Only the top one handles Tab and Escape, so a confirm over an edit dialog closes alone.
const openDialogs: object[] = [];

/** True while a modal dialog is open: page-wide shortcuts (the live hotkeys) must not act behind it. */
export function isDialogOpen(): boolean {
  return openDialogs.length > 0;
}

/** Marks a dialog open (on top of any others) until `release()`. */
export function registerDialog(): { isTop: () => boolean; release: () => void } {
  const token = {};
  openDialogs.push(token);
  return {
    isTop: () => openDialogs[openDialogs.length - 1] === token,
    release: () => {
      const i = openDialogs.indexOf(token);
      if (i !== -1) openDialogs.splice(i, 1);
    },
  };
}

/** Where Tab moves focus among `count` focusable elements; `current` -1 means focus isn't inside the dialog. */
export function nextFocusIndex(current: number, count: number, backwards: boolean): number {
  if (count === 0) return -1;
  if (current < 0) return backwards ? count - 1 : 0;
  return (current + (backwards ? count - 1 : 1)) % count;
}

export interface FocusTrapOptions {
  /** Escape closes the dialog (left alone when not given). */
  onEscape?: () => void;
  /** What to focus on open; defaults to the first focusable element, else the dialog itself. */
  initialFocus?: () => HTMLElement | null;
}

/**
 * Modal dialog focus: moves focus into the dialog when `active` turns on, keeps Tab and Shift+Tab cycling inside it,
 * closes on Escape, and puts focus back where it was on close. Put the returned ref on the dialog element.
 */
export function useFocusTrap<T extends HTMLElement>(active: boolean, options: FocusTrapOptions = {}): RefObject<T | null> {
  const ref = useRef<T>(null);
  // Read at key time: callers pass fresh closures every render, and that mustn't re-run the open/close effect.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const root = ref.current;
    if (!active || !root) return;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = registerDialog();
    const focusable = () =>
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);

    const first = optionsRef.current.initialFocus?.() ?? focusable()[0];
    if (first) first.focus();
    else {
      if (!root.hasAttribute("tabindex")) root.tabIndex = -1;
      root.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!dialog.isTop() || e.defaultPrevented) return;
      if (e.key === "Escape" && optionsRef.current.onEscape) {
        e.preventDefault();
        optionsRef.current.onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusable();
      const i = list.indexOf(document.activeElement as HTMLElement);
      // Inside the dialog the browser's own order applies; only wrap at the ends, or pull a stray focus back in.
      const atEdge = e.shiftKey ? i === 0 : i === list.length - 1;
      if (i === -1 || atEdge) {
        e.preventDefault();
        list[nextFocusIndex(i, list.length, e.shiftKey)]?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      dialog.release();
      if (restore?.isConnected) restore.focus();
    };
  }, [active]);

  return ref;
}
