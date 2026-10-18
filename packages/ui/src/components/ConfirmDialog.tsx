import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { usePresence } from "../hooks/usePresence";
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
  // Closing plays the dialog's exit (Sheet's, shorter than its entrance) with the question it asked still on it.
  const { mounted, leaving } = usePresence(pending !== null, 160);
  const asked = useRef<Pending | null>(null);
  if (pending) asked.current = pending;
  const shown = pending ?? asked.current;

  if (!mounted || !shown) return null;
  const canConfirm = !shown.typeToConfirm || typed === shown.typeToConfirm;

  return (
    <div
      inert={leaving || undefined}
      aria-hidden={leaving || undefined}
      className={
        "fixed inset-0 z-confirm flex items-end justify-center bg-zinc-950/50 p-4 sm:items-center " +
        (leaving ? "pointer-events-none animate-fade-out" : "animate-fade-in")
      }
      onMouseDown={(e) => e.target === e.currentTarget && !leaving && close(false)}
    >
      <div
        ref={dialogRef}
        role={leaving ? undefined : "alertdialog"}
        aria-modal={leaving ? undefined : "true"}
        aria-labelledby={leaving ? undefined : "orbit-confirm-title"}
        aria-describedby={!leaving && shown.body ? "orbit-confirm-body" : undefined}
        className={
          "w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-dialog dark:border-white/10 dark:bg-zinc-950 " +
          (leaving ? "animate-sheet-down sm:animate-dialog-out" : "animate-sheet-up sm:animate-dialog-in")
        }
      >
        <h2 id="orbit-confirm-title" className="font-display text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {shown.title}
        </h2>
        {shown.body && (
          <p id="orbit-confirm-body" className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">
            {shown.body}
          </p>
        )}
        {shown.typeToConfirm && (
          <div className="mt-4 space-y-1.5">
            <label htmlFor="orbit-confirm-typed" className="block text-sm text-zinc-700 dark:text-zinc-300">
              Type <strong className="font-semibold text-zinc-900 dark:text-white">{shown.typeToConfirm}</strong> to confirm
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
            {shown.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            ref={confirmRef}
            variant={shown.danger ? "destructive" : "primary"}
            block
            disabled={!canConfirm}
            disabledReason={shown.typeToConfirm ? `Type ${shown.typeToConfirm} to confirm` : undefined}
            onClick={() => close(true)}
          >
            {shown.confirmLabel ?? "Confirm"}
          </Button>
        </div>
      </div>
    </div>
  );
}
