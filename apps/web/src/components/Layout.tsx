import { Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import {
  ChevronDown,
  CreditCard,
  ErrorBoundary,
  FolderOpen,
  HistoryIcon,
  House,
  LogOut,
  MOCK_INTERVIEW_ENABLED,
  OrbitWordmark,
  SettingsIcon,
  Target,
  VerifyEmailBanner,
  ApprovalBanner,
  cx,
  focusRing,
  type LucideIcon,
} from "@orbit/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { prefetchRoute } from "../routes";
import { Spinner } from "./ui";

// Daily destinations only. Plan & billing lives in the account menu (and Settings): nobody checks it daily.
const NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: "/", label: "Home", icon: House, end: true },
  ...(MOCK_INTERVIEW_ENABLED ? [{ to: "/mock", label: "Practice", icon: Target }] : []),
  { to: "/sessions", label: "Sessions", icon: HistoryIcon },
  { to: "/documents", label: "Documents", icon: FolderOpen },
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
  const navigationType = useNavigationType();
  // A new page opens at its top; Back/Forward (POP) keeps the browser's own scroll position.
  useEffect(() => {
    if (navigationType !== "POP") window.scrollTo(0, 0);
  }, [location.pathname, navigationType]);
  const signOut = () => void logout().then(() => navigate("/login"));

  return (
    <div className="min-h-full pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm dark:focus:bg-zinc-900"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-white/90 dark:border-white/5 dark:bg-zinc-950/85">
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
                onMouseEnter={() => prefetchRoute(to)}
                onFocus={() => prefetchRoute(to)}
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

          <WaitingForAccess />
          <AccountMenu
            name={user?.name ?? null}
            email={user?.email ?? ""}
            onBilling={() => navigate("/billing")}
            onSignOut={signOut}
          />
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

      {/* One banner at a time: verifying the email comes first. */}
      {user?.approval_pending && !(!user.email_verified && verificationRequired) && (
        <ApprovalBanner
          className="px-4 sm:px-6"
          onRecheck={async () => {
            const fresh = await api.me();
            setUser(fresh);
            return Boolean(fresh.approval_pending);
          }}
        />
      )}

      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {/* Keyed on the route so each page fades up in. */}
        <div key={location.pathname} className="animate-fade-up">
          {/* Inside the layout, and reset by that key on every navigation: a page that fails to load (its code gone
              after a deploy) or to render shows an error with Reload while the nav stays usable. */}
          <ErrorBoundary>
            {/* Inside the layout: the nav stays put while a page's code arrives. */}
            <Suspense
              fallback={
                <div className="flex min-h-[40vh] items-center justify-center">
                  <Spinner />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>

      {/* Phones: a thumb-reach tab bar instead of a scrolling top nav. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200/70 bg-white/95 pb-[env(safe-area-inset-bottom)] md:hidden dark:border-white/5 dark:bg-zinc-950/90"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                onTouchStart={() => prefetchRoute(to)}
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

/** Avatar button → account menu: who's signed in, plan & billing, sign out. */
function AccountMenu({
  name,
  email,
  onBilling,
  onSignOut,
}: {
  name: string | null;
  email: string;
  onBilling: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const item = cx(
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-900/5 dark:text-zinc-200 dark:hover:bg-white/5",
    focusRing,
  );
  const choose = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div ref={ref} className="relative ml-auto md:ml-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className={cx("flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 hover:bg-zinc-900/5 dark:hover:bg-white/5", focusRing)}
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-aurora-500 text-xs font-semibold text-white shadow-glow-sm">
          {initials(name, email)}
        </span>
        <ChevronDown className={cx("h-4 w-4 text-zinc-500 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          className="glass-panel absolute right-0 top-full z-30 mt-2 w-64 animate-scale-in rounded-2xl p-1.5 shadow-xl"
        >
          <div className="px-3 py-2">
            {name && <p className="truncate text-sm font-medium">{name}</p>}
            <p className="truncate text-xs text-zinc-500">{email}</p>
          </div>
          <div className="my-1 h-px bg-zinc-200 dark:bg-white/10" />
          <button type="button" role="menuitem" className={item} onClick={choose(onBilling)}>
            <CreditCard className="h-4 w-4 text-zinc-500" />
            Plan &amp; billing
          </button>
          <button type="button" role="menuitem" className={item} onClick={choose(onSignOut)}>
            <LogOut className="h-4 w-4 text-zinc-500" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Admin only: how many new accounts are waiting for access, linking to Users & access. The in-app side of the
 * sign-up email, and the only one on a server without SMTP. Re-counted on every page change and each minute.
 */
function WaitingForAccess() {
  const { pathname } = useLocation();
  const [admin, setAdmin] = useState(false);
  const [count, setCount] = useState(0);
  const [payments, setPayments] = useState(0);
  useEffect(() => {
    api.adminStatus().then((s) => setAdmin(s.is_admin)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!admin) return;
    const load = () => {
      void api.adminUsers("pending").then((r) => setCount(r.users.length)).catch(() => undefined);
      void api.adminPayments("submitted").then((r) => setPayments(r.waiting)).catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [admin, pathname]);
  if (!admin || !(count || payments)) return null;
  const badge =
    "mr-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-500/30 hover:bg-amber-500/25 dark:text-amber-200";
  return (
    <>
      {payments > 0 && (
        <Link to="/admin/payments" className={badge} aria-label={`${payments} UPI ${payments === 1 ? "payment" : "payments"} to check`}>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
          {payments} to check
        </Link>
      )}
      {count > 0 && (
        <Link to="/admin/users" className={badge} aria-label={`${count} new ${count === 1 ? "account is" : "accounts are"} waiting for access`}>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
          {count} waiting
        </Link>
      )}
    </>
  );
}
