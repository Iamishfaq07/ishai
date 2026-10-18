import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "../icons";
import { cx, focusRing } from "./cx";
import type { ToastItem } from "./Toast";

const TONE = {
  neutral: { icon: Info, className: "text-zinc-500 dark:text-zinc-400" },
  info: { icon: Info, className: "text-zinc-500 dark:text-zinc-400" },
  warning: { icon: TriangleAlert, className: "text-amber-600 dark:text-amber-300" },
  success: { icon: CircleCheck, className: "text-emerald-600 dark:text-emerald-400" },
  error: { icon: CircleAlert, className: "text-rose-600 dark:text-rose-400" },
} as const;

/** The toasts themselves, inside ToastHost's live region (a chunk of its own, loaded with the first toast). */
export default function ToastCards({
  toasts,
  onAct,
  onDismiss,
  onHold,
}: {
  toasts: readonly ToastItem[];
  onAct: (id: string) => void;
  onDismiss: (id: string) => void;
  onHold: (reason: string, on: boolean) => void;
}) {
  return toasts.map((t) => {
    const tone = TONE[t.tone];
    return (
      <li
        key={t.id}
        data-flip={t.id}
        onPointerEnter={() => onHold("pointer", true)}
        onPointerLeave={() => onHold("pointer", false)}
        onKeyDown={(e) => e.key === "Escape" && onDismiss(t.id)}
        className={cx(
          "pointer-events-auto flex items-start gap-3 rounded-xl border border-zinc-200 bg-white px-3.5 py-3 text-sm text-zinc-900 shadow-toast dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100",
          // In: up from below and a touch smaller. Out: the same way back, faster; the rest close up (useFlip).
          t.leaving ? "pointer-events-none animate-toast-out" : "animate-toast-in",
        )}
      >
        <span aria-hidden="true" className={cx("relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center", tone.className)}>
          {t.icon ?? <tone.icon className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t.message}</p>
          {t.detail && <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-300">{t.detail}</p>}
        </div>
        {t.action && (
          <button
            type="button"
            onClick={() => onAct(t.id)}
            className={cx("-my-1 shrink-0 rounded-lg px-2.5 py-1 font-semibold text-indigo-700 hover:bg-indigo-500/10 active:bg-indigo-500/20 dark:text-indigo-300", focusRing)}
          >
            {t.action.label}
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => onDismiss(t.id)}
          className={cx(
            "hit-area relative -my-1 -mr-1.5 shrink-0 rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-800 active:bg-zinc-900/10 dark:hover:bg-white/10 dark:hover:text-zinc-100 dark:active:bg-white/15",
            focusRing,
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </li>
    );
  });
}
