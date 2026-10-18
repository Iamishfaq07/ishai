import { Suspense, lazy, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useFlip } from "../hooks/useFlip";
import { currentMotion } from "../hooks/useMotion";

/**
 * Toasts: short, polite confirmations ("Saved to tracker", "Copied", "1 credit used") with an optional Undo, read
 * out by screen readers. `toast("Copied")` or `toast({ message: "Story deleted", action: { label: "Undo", onClick } })`
 * from anywhere; mount <ToastHost /> once near the app root. Not for errors the user must act on (ErrorNote) or
 * questions (confirmDialog).
 */
/** `neutral` (and `info`, the same) for a plain confirmation, `success` when something finished, `warning` when it
 *  half-worked, `error` when it failed (with what to do in `detail`). */
export type ToastTone = "neutral" | "info" | "success" | "warning" | "error";

export interface ToastOptions {
  /** What happened, in a few words, using the action's own name: "Saved to tracker", "Story deleted". */
  message: string;
  /** An optional second line. */
  detail?: string;
  tone?: ToastTone;
  /** One button on the toast, e.g. `{ label: "Undo", onClick: restore }`. Pressing it also closes the toast. */
  action?: { label: string; onClick: () => void };
  /** A toast with the same id is replaced (and its time restarts) instead of stacking another. */
  id?: string;
  /** How long it stays, in ms: default 5 s, 8 s with an action, 7 s for an error; 0 keeps it until closed. The clock
   *  stops while a toast is hovered or focused and while the tab is hidden. */
  duration?: number;
  /** Replaces the tone's icon (a celebration passes its burst). Decorative. */
  icon?: ReactNode;
}

export interface ToastItem extends ToastOptions {
  id: string;
  tone: ToastTone;
  duration: number;
  /** Playing its exit; gone from the list once that ends. */
  leaving: boolean;
}

/** Exits run shorter than enters (--dur-quick). */
const EXIT_MS = 160;

/** The toast list and its clocks, without React (tested in Toast.test.ts). */
export function createToastQueue({ max = 3, exitMs = () => EXIT_MS }: { max?: number; exitMs?: () => number } = {}) {
  let toasts: readonly ToastItem[] = [];
  let seq = 0;
  const listeners = new Set<() => void>();
  const holds = new Set<string>();
  const clocks = new Map<string, { handle?: ReturnType<typeof setTimeout>; endsAt: number; left: number }>();
  const exits = new Map<string, ReturnType<typeof setTimeout>>();

  const set = (next: readonly ToastItem[]) => {
    toasts = next;
    listeners.forEach((l) => l());
  };
  const start = (id: string) => {
    const c = clocks.get(id);
    if (!c || holds.size > 0 || c.handle !== undefined) return;
    c.endsAt = Date.now() + c.left;
    c.handle = setTimeout(() => dismiss(id), c.left);
  };
  const stop = (id: string) => {
    const c = clocks.get(id);
    if (c?.handle === undefined) return;
    clearTimeout(c.handle);
    c.handle = undefined;
    c.left = Math.max(0, c.endsAt - Date.now());
  };
  const forget = (id: string) => {
    stop(id);
    clocks.delete(id);
    clearTimeout(exits.get(id));
    exits.delete(id);
  };
  const remove = (id: string) => {
    forget(id);
    set(toasts.filter((t) => t.id !== id));
  };

  function show(input: string | ToastOptions): string {
    const options = typeof input === "string" ? { message: input } : input;
    const id = options.id ?? `toast-${++seq}`;
    const tone = options.tone ?? "neutral";
    const duration = options.duration ?? (options.action ? 8000 : tone === "error" ? 7000 : 5000);
    const item: ToastItem = { ...options, id, tone, duration, leaving: false };
    forget(id);
    const at = toasts.findIndex((t) => t.id === id);
    const next = at >= 0 ? toasts.map((t, i) => (i === at ? item : t)) : [...toasts, item];
    set(next);
    // Too many on screen: the oldest make way.
    const showing = next.filter((t) => !t.leaving);
    showing.slice(0, Math.max(0, showing.length - max)).forEach((t) => dismiss(t.id));
    if (duration > 0) {
      clocks.set(id, { endsAt: 0, left: duration });
      start(id);
    }
    return id;
  }

  function dismiss(id: string): void {
    const item = toasts.find((t) => t.id === id);
    if (!item || item.leaving) return;
    forget(id);
    const wait = exitMs();
    if (wait <= 0) return remove(id);
    set(toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    exits.set(
      id,
      setTimeout(() => remove(id), wait),
    );
  }

  return {
    show,
    dismiss,
    /** Presses the toast's button, then closes it. */
    act(id: string): void {
      const item = toasts.find((t) => t.id === id);
      if (!item || item.leaving) return;
      item.action?.onClick();
      dismiss(id);
    },
    /** Stops (`on`) or restarts every clock, for one reason at a time: hover, focus, a hidden tab. */
    hold(reason: string, on: boolean): void {
      if (on === holds.has(reason)) return;
      if (on) {
        holds.add(reason);
        clocks.forEach((_, id) => stop(id));
      } else {
        holds.delete(reason);
        clocks.forEach((_, id) => start(id));
      }
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    snapshot: (): readonly ToastItem[] => toasts,
  };
}

// The cards (markup and icons) load with the first toast, or once the page is idle: nothing on the first screen.
const ToastCards = lazy(() => import("./ToastCards"));
const preload = () => void import("./ToastCards");

// Off: a closed toast goes at once. Gentle and Full fade it out.
const queue = createToastQueue({ exitMs: () => (currentMotion() === "off" ? 0 : EXIT_MS) });

/** Shows a toast; returns its id (for `dismissToast`). */
export function toast(input: string | ToastOptions): string {
  return queue.show(input);
}

export function dismissToast(id: string): void {
  queue.dismiss(id);
}

/**
 * Where toasts appear: bottom centre on phones (above the tab bar, in thumb reach), bottom right from 768 px. One
 * polite live region that is always in the page, so each new toast is announced once; nothing takes focus.
 */
export function ToastHost() {
  const toasts = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
  const list = useRef<HTMLOListElement>(null);
  // A toast arriving or leaving moves the others: they glide to their new places (each toast plays its own entrance and exit).
  useFlip(toasts.map((t) => t.id).join(" "), { ref: list, enter: false, exit: false });
  // A toast closed under the pointer or with focus inside it leaves without a pointerleave or blur: re-check both
  // whenever the list changes, so the clocks never stay stopped.
  useEffect(() => {
    queue.hold("pointer", list.current?.matches(":hover") ?? false);
    queue.hold("focus", list.current?.contains(document.activeElement) ?? false);
  }, [toasts]);
  useEffect(() => {
    const onVisibility = () => queue.hold("hidden", document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    const idle = setTimeout(preload, 3000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimeout(idle);
    };
  }, []);

  return (
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-toast md:inset-x-auto md:bottom-6 md:right-6"
    >
      <ol
        ref={list}
        aria-live="polite"
        className="flex flex-col items-stretch gap-2 md:w-[22rem]"
        onFocus={() => queue.hold("focus", true)}
        onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && queue.hold("focus", false)}
      >
        {toasts.length > 0 && (
          <Suspense fallback={null}>
            <ToastCards toasts={toasts} onAct={queue.act} onDismiss={queue.dismiss} onHold={queue.hold} />
          </Suspense>
        )}
      </ol>
    </section>
  );
}
