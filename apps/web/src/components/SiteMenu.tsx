import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, cx, focusRing } from "@orbit/ui";

const LINKS = [
  { to: "/", label: "Home" },
  { to: "/resume-ai", label: "Resume AI" },
  { to: "/jobs", label: "Jobs AI" },
  { to: "/warmup", label: "Free practice" },
  { to: "/#pricing", label: "Pricing" },
  { to: "/contact", label: "Contact" },
  { to: "/login", label: "Sign in" },
];

/** The public pages' menu. Desktop keeps its own links; this is the phone menu, so a narrow screen doesn't overflow. */
export function SiteMenu() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "grid h-10 w-10 place-items-center rounded-full text-zinc-700 hover:bg-zinc-900/5 md:hidden dark:text-zinc-200 dark:hover:bg-white/10",
          focusRing,
        )}
        aria-label={open ? "Close menu" : "Open menu"}
      >
        {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>
      {open && (
        <nav
          id="site-menu"
          aria-label="Site"
          className="absolute inset-x-0 top-full z-30 border-b border-zinc-200 bg-white px-3 py-2 shadow-lg md:hidden dark:border-white/10 dark:bg-zinc-950"
        >
          <ul className="grid gap-1">
            {LINKS.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  onClick={() => setOpen(false)}
                  className={cx(
                    "flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-white/10",
                    focusRing,
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </>
  );
}
