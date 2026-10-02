import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { cx, focusRing } from "./cx";

/**
 * In-app confirmation dialog replacing window.confirm / window.prompt (which look foreign, can't be styled or
 * themed, and block the page). Promise-based: `if (!(await confirmDialog({...}))) return;`. Mount <ConfirmHost />
 * once near the app root.
 */
export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
  /** Require typing this exact word before the confirm button enables (e.g. "DELETE"). */
  typeToConfirm?: string;
}

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };
const EVENT = "orbit:confirm";

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<Pending>(EVENT, { detail: { ...options, resolve } }));
  });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onOpen = (e: Event) => {
      setTyped("");
      setPending((e as CustomEvent<Pending>).detail);
    };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  const close = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };
  // Focus starts on the confirm button (or the type-to-confirm box), stays in the dialog, and goes back on close.
  const dialogRef = useFocusTrap<HTMLDivElement>(pending !== null, {
    onEscape: () => close(false),
    initialFocus: () => (pending?.typeToConfirm ? inputRef.current : confirmRef.current),
  });

  if (!pending) return null;
  const canConfirm = !pending.typeToConfirm || typed === pending.typeToConfirm;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && close(false)}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="orbit-confirm-title"
        aria-describedby={pending.body ? "orbit-confirm-body" : undefined}
        className="w-full max-w-sm animate-fade-up rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h2 id="orbit-confirm-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {pending.title}
        </h2>
        {pending.body && (
          <p id="orbit-confirm-body" className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
            {pending.body}
          </p>
        )}
        {pending.typeToConfirm && (
          <label className="mt-3 block text-sm">
            <span className="text-zinc-600 dark:text-zinc-300">
              Type <span className="font-mono font-semibold">{pending.typeToConfirm}</span> to confirm
            </span>
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canConfirm && close(true)}
              className={cx("mt-1 block w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900", focusRing)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => close(false)}
            className={cx("rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800", focusRing)}
          >
            {pending.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={!canConfirm}
            onClick={() => close(true)}
            className={cx(
              "rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40",
              pending.danger ? "bg-rose-600 hover:bg-rose-500" : "bg-indigo-600 hover:bg-indigo-500",
              focusRing,
            )}
          >
            {pending.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
