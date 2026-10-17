import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { Button, Input } from "./ui";

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
      className="fixed inset-0 z-confirm flex animate-fade-in items-end justify-center bg-zinc-950/50 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && close(false)}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="orbit-confirm-title"
        aria-describedby={pending.body ? "orbit-confirm-body" : undefined}
        className="w-full max-w-md animate-sheet-up rounded-2xl border border-zinc-200 bg-white p-5 shadow-dialog sm:animate-dialog-in dark:border-white/10 dark:bg-zinc-950"
      >
        <h2 id="orbit-confirm-title" className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {pending.title}
        </h2>
        {pending.body && (
          <p id="orbit-confirm-body" className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">
            {pending.body}
          </p>
        )}
        {pending.typeToConfirm && (
          <div className="mt-4 space-y-1.5">
            <label htmlFor="orbit-confirm-typed" className="block text-sm text-zinc-700 dark:text-zinc-300">
              Type <strong className="font-semibold text-zinc-900 dark:text-white">{pending.typeToConfirm}</strong> to confirm
            </label>
            <Input
              id="orbit-confirm-typed"
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canConfirm && close(true)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        )}
        {/* Phones: full-width buttons, the confirming one nearest the thumb. From sm: right-aligned, confirm last. */}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" block onClick={() => close(false)}>
            {pending.cancelLabel ?? "Cancel"}
          </Button>
          <Button ref={confirmRef} variant={pending.danger ? "destructive" : "primary"} block disabled={!canConfirm} onClick={() => close(true)}>
            {pending.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  );
}
