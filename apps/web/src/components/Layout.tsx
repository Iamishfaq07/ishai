import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { cx, focusRing } from "@orbit/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { errorText } from "../lib/format";

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/sessions", label: "Sessions" },
  { to: "/documents", label: "Documents" },
  { to: "/mock", label: "Mock" },
  { to: "/billing", label: "Billing" },
  { to: "/settings", label: "Settings" },
];

function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const resend = () => {
    setState("sending");
    setError(null);
    api
      .requestVerification()
      .then(() => setState("sent"))
      .catch((err: unknown) => {
        setError(errorText(err));
        setState("idle");
      });
  };
  return (
    <div role="status" className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Confirm <strong>{email}</strong> — we sent you a verification link.
        </span>
        {state === "sent" ? (
          <span className="font-medium">New link sent.</span>
        ) : (
          <button type="button" onClick={resend} disabled={state === "sending"} className={cx("font-medium underline disabled:opacity-50", focusRing)}>
            {state === "sending" ? "Sending…" : "Resend link"}
          </button>
        )}
        {error && <span className="text-rose-700 dark:text-rose-300">{error}</span>}
      </div>
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm dark:focus:bg-zinc-900">
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <NavLink to="/" className={cx("flex items-center gap-2 font-semibold tracking-tight", focusRing)}>
            <span className="h-5 w-5 rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 ring-2 ring-indigo-400/30" aria-hidden="true" />
            Orbit
          </NavLink>
          <nav aria-label="Main" className="flex flex-1 gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    "rounded-lg px-3 py-1.5 text-sm font-medium",
                    isActive
                      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
                    focusRing,
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-zinc-500 sm:inline">{user?.email}</span>
            <button
              type="button"
              onClick={() => void logout().then(() => navigate("/login"))}
              className={cx("rounded-lg px-2 py-1 text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white", focusRing)}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      {user && !user.email_verified && <VerifyEmailBanner email={user.email} />}
      <main id="main" className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
