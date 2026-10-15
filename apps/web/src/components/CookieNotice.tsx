import { useEffect, useState } from "react";
import { X, cx, focusRing, safeLocal } from "@orbit/ui";
import { useAuth } from "../lib/auth";

const KEY = "orbit.cookies.v1";

/** A notice, not a wall. The only cookie is the sign-in cookie. OK remembers the choice on this device. */
export function CookieNotice() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(safeLocal.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;

  const accept = () => {
    try {
      safeLocal.setItem(KEY, "1");
    } catch {
      /* private mode: hide it for this view anyway */
    }
    setShow(false);
  };

  // Only strictly necessary cookies, so a slim one-line bar (not a card over the page) that never hides a button.
  return (
    <div
      role="region"
      aria-label="Cookies"
      className={cx(
        // Phones: left of the support button (right-3, about 3.5rem wide), at its height, so they never overlap.
        "fixed left-3 right-[4.75rem] z-40 flex items-center gap-2 rounded-xl border border-zinc-200 bg-white/95 py-1.5 pl-3 pr-1 text-xs text-zinc-700 shadow-md backdrop-blur md:bottom-3 md:right-auto md:max-w-md dark:border-white/10 dark:bg-zinc-900/95 dark:text-zinc-300",
        user ? "bottom-[calc(4.25rem+env(safe-area-inset-bottom))]" : "bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
    >
      <p className="min-w-0 flex-1">
        Only a sign-in cookie, no advertising.{" "}
        <a href="/cookies.html" className={cx("font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
          Cookie policy
        </a>
      </p>
      <button
        type="button"
        onClick={accept}
        aria-label="Dismiss the cookie note"
        className={cx("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-500/10 hover:text-zinc-800 dark:hover:text-zinc-100", focusRing)}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
