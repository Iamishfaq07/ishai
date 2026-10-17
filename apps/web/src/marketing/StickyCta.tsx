import { useEffect, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { X, buttonClass, cx, focusRing, safeLocal } from "@orbit/ui";

const DISMISSED = "orbit.site.cta.v1";
const COOKIES = "orbit.cookies.v1";

function read(key: string): string | null {
  try {
    return safeLocal.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The front page's one prompt, for phones and tablets (on wide screens the sticky header already carries Start
 * free): a slim bar that rises in once the hero's buttons have scrolled away, and steps aside near the page's own
 * closing call to action and the footer. Never over content people are reading (it sits left of the support button,
 * in the space the cookie note uses, and waits until that note is dismissed), never a timer or a countdown, and ×
 * dismisses it for good on this device.
 *
 * `after`: the element whose leaving the screen brings the bar in (the hero's buttons). `before`: the element whose
 * arrival sends it away (the closing call to action).
 */
export function StickyCta({ after, before, line }: { after: RefObject<HTMLElement | null>; before: RefObject<HTMLElement | null>; line: string }) {
  const [dismissed, setDismissed] = useState(() => read(DISMISSED) === "1");
  const [pastHero, setPastHero] = useState(false);
  const [nearEnd, setNearEnd] = useState(false);
  const [cookiesDone, setCookiesDone] = useState(() => read(COOKIES) === "1");

  useEffect(() => {
    if (dismissed) return;
    const a = after.current;
    const b = before.current;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.target === a) setPastHero(!e.isIntersecting && e.boundingClientRect.top < 0);
        if (e.target === b) setNearEnd(e.isIntersecting || e.boundingClientRect.top < 0);
      }
    });
    if (a) io.observe(a);
    if (b) io.observe(b);
    // The cookie note is dismissed in another component: look again as the page scrolls (cheap, no polling).
    const onScroll = () => setCookiesDone(read(COOKIES) === "1");
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, [after, before, dismissed]);

  if (dismissed) return null;
  const hidden = !pastHero || nearEnd || !cookiesDone;
  return (
    <div
      role="region"
      aria-label="Get started"
      data-hidden={hidden || undefined}
      aria-hidden={hidden || undefined}
      inert={hidden || undefined}
      className={cx(
        "mk-sticky mk-menu-shadow fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 right-[4.75rem] z-30 flex items-center gap-2 rounded-xl border mk-line mk-surface py-1.5 pl-3 pr-1.5 sm:left-6 sm:right-24 sm:max-w-md lg:hidden",
      )}
    >
      <p className="min-w-0 flex-1 truncate text-[0.8125rem] font-medium text-zinc-800 dark:text-zinc-100">{line}</p>
      <Link to="/register" className={buttonClass("primary", "sm", "min-h-9 shrink-0 px-3 text-[0.8125rem]")}>
        Start free
      </Link>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          try {
            safeLocal.setItem(DISMISSED, "1");
          } catch {
            /* private mode: gone for this visit */
          }
          setDismissed(true);
        }}
        className={cx("grid h-9 w-9 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-900/[0.04] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white", focusRing)}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
