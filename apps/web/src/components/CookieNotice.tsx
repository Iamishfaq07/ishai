import { useEffect, useState } from "react";
import { cx, focusRing } from "@orbit/ui";

const KEY = "orbit.cookies.v1";

/** A notice, not a wall. The only cookie is the sign-in cookie. OK remembers the choice on this device. */
export function CookieNotice() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      setShow(localStorage.getItem(KEY) !== "1");
    } catch {
      setShow(true);
    }
  }, []);
  if (!show) return null;

  const accept = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode: hide it for this view anyway */
    }
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Cookies"
      className="fixed inset-x-3 z-50 rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-800 shadow-lg bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-4 md:left-4 md:right-auto md:max-w-sm dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <p>
        Orbit uses one sign-in cookie and saves settings on this device. No advertising cookies.{" "}
        <a href="/cookies.html" className={cx("font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
          Cookie policy
        </a>
      </p>
      <button
        type="button"
        onClick={accept}
        className={cx("mt-3 inline-flex min-h-10 items-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500", focusRing)}
      >
        OK
      </button>
    </div>
  );
}
