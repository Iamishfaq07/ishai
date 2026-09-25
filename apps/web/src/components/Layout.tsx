import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  CreditCard,
  FolderOpen,
  HistoryIcon,
  House,
  LogOut,
  OrbitWordmark,
  SettingsIcon,
  VerifyEmailBanner,
  cx,
  focusRing,
  type LucideIcon,
} from "@orbit/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

const NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/sessions", label: "Sessions", icon: HistoryIcon },
  { to: "/documents", label: "Documents", icon: FolderOpen },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function initials(name: string | null | undefined, email: string | undefined): string {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Layout() {
  const { user, logout, setUser } = useAuth();
  // Only nag when this server actually locks paid features behind verification.
  const [verificationRequired, setVerificationRequired] = useState(false);
  useEffect(() => {
    api.authConfig().then((c) => setVerificationRequired(c.email_verification === "required")).catch(() => undefined);
  }, []);
  const location = useLocation();
  const navigate = useNavigate();
  const signOut = () => void logout().then(() => navigate("/login"));

  return (
    <div className="min-h-full pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm dark:focus:bg-zinc-900"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-white/70 backdrop-blur-xl dark:border-white/5 dark:bg-zinc-950/60">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
          <NavLink to="/" className={cx("rounded-lg", focusRing)} aria-label="Orbit home">
            <OrbitWordmark size={26} />
          </NavLink>

          <nav aria-label="Main" className="hidden flex-1 items-center gap-1 md:flex">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cx(
                    "relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-indigo-500/10 text-indigo-700 dark:bg-white/[0.07] dark:text-white"
                      : "text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
                    focusRing,
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={cx("h-4 w-4", isActive && "text-indigo-500 dark:text-indigo-300")} />
                    {label}
                    {isActive && (
                      <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-gradient-to-r from-indigo-500 to-aurora-400" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 text-sm md:ml-0">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-aurora-500 text-xs font-semibold text-white shadow-glow-sm"
              title={user?.email}
              aria-hidden="true"
            >
              {initials(user?.name, user?.email)}
            </span>
            <span className="hidden max-w-[14rem] truncate text-zinc-500 lg:inline">{user?.email}</span>
            <button
              type="button"
              onClick={signOut}
              className={cx(
                "flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
                focusRing,
              )}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {user && !user.email_verified && verificationRequired && (
        <VerifyEmailBanner
          email={user.email}
          className="px-4 sm:px-6"
          onResend={() => api.requestVerification()}
          onRecheck={async () => {
            const fresh = await api.me();
            setUser(fresh);
            return fresh.email_verified;
          }}
        />
      )}

      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {/* Keyed on the route so each page fades up in. */}
        <div key={location.pathname} className="animate-fade-up">
          <Outlet />
        </div>
      </main>

      {/* Phones: a thumb-reach tab bar instead of a scrolling top nav. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200/70 bg-white/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden dark:border-white/5 dark:bg-zinc-950/75"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cx(
                    "flex flex-col items-center gap-1 px-1 pb-2 pt-2.5 text-[11px] font-medium",
                    isActive ? "text-indigo-600 dark:text-white" : "text-zinc-500 dark:text-zinc-400",
                    focusRing,
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cx(
                        "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                        isActive && "bg-gradient-to-r from-indigo-500/25 to-aurora-400/15",
                      )}
                    >
                      <Icon className={cx("h-5 w-5", isActive && "text-indigo-600 dark:text-indigo-200")} />
                    </span>
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
