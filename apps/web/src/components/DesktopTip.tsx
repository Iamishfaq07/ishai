import { useState } from "react";
import { Laptop, X, cx, focusRing, safeLocal } from "@orbit/ui";

const KEY = "orbit.desktopTip.v1";

function dismissed(): boolean {
  try {
    return safeLocal.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Phones only, until dismissed: everything works here, and a computer gives resumes and interview practice more room. */
export function DesktopTip({ className }: { className?: string }) {
  const [hidden, setHidden] = useState(dismissed);
  if (hidden) return null;
  const dismiss = () => {
    try {
      safeLocal.setItem(KEY, "1");
    } catch {
      /* storage off: hidden for this visit */
    }
    setHidden(true);
  };
  return (
    <div role="note" className={cx("border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-[0.8125rem] text-zinc-700 sm:hidden dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300", className)}>
      <div className="flex items-center gap-2.5">
        <Laptop className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
        <p className="min-w-0 flex-1">
          <span className="font-medium text-zinc-900 dark:text-white">Best on a computer.</span> A laptop or PC gives resumes and practice more room.
        </p>
        <button type="button" onClick={dismiss} aria-label="Dismiss this tip"
                className={cx("-mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 dark:hover:bg-white/5", focusRing)}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
