import { useState } from "react";
import { cx, focusRing } from "./cx";

/**
 * Shown while a new account waits for the admin to give it access (sign-up approval). Sessions and AI are locked
 * until then (the API answers 403 `approval_pending`). "Check again" re-reads the account, since access is
 * granted from somewhere else.
 */
export function ApprovalBanner({ onRecheck, className }: { onRecheck: () => Promise<boolean>; className?: string }) {
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const recheck = () => {
    setChecking(true);
    setNote(null);
    onRecheck()
      .then((waiting) => setNote(waiting ? "Still waiting. We'll email you as soon as it's ready." : null))
      .catch(() => undefined)
      .finally(() => setChecking(false));
  };
  return (
    <div
      role="status"
      className={cx(
        "border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0">
          Your account is waiting for approval. You can look around; sessions and AI features unlock when it's
          approved, and we'll email you.
        </span>
        <button type="button" onClick={recheck} disabled={checking} className={cx("font-medium underline underline-offset-2 disabled:opacity-50", focusRing)}>
          {checking ? "Checking…" : "Check again"}
        </button>
        {note && <span>{note}</span>}
      </div>
    </div>
  );
}
