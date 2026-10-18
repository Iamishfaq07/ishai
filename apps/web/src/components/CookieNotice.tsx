import { useEffect, useState } from "react";
import { Cookie, X, cx, focusRing, safeLocal } from "@orbit/ui";
import { useAuth } from "../lib/auth";
import "../marketing/site.css";

const KEY = "orbit.cookies.v1";

/**
 * A notice, not a wall. The only cookie is the sign-in cookie (strictly necessary, so there is nothing to consent
 * to); settings are saved on the device. Dismissing it is remembered on this device. A slim card in the corner that
 * never covers a button: on phones left of the support button, on wide screens bottom left, opposite it.
 */
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

  return (
    <div
      role="region"
      aria-label="Cookies"
      className={cx(
        // Phones: left of the support button (right-3, about 3.5rem wide), at its height, so they never overlap.
        "fixed left-3 right-[4.75rem] z-40 flex items-center gap-2.5 rounded-xl border border-[rgb(var(--site-line))] bg-[rgb(var(--site-surface))] py-1.5 pl-3 pr-1 text-[0.8125rem] text-zinc-700 shadow-[0_8px_24px_-12px_rgb(var(--ink-900)/0.25)] md:bottom-5 md:left-5 md:right-auto md:max-w-sm dark:text-zinc-300 dark:shadow-[0_12px_32px_-12px_rgb(0_0_0/0.6)]",
        user ? "bottom-[calc(4.25rem+env(safe-area-inset-bottom))]" : "bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
    >
      <Cookie className="h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        Only a sign-in cookie, no advertising.{" "}
        <a href="/cookies" className={cx("rounded font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
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
