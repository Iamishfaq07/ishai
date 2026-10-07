import { Suspense, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import {
  Briefcase,
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
  Sparkles,
  Target,
  VerifyEmailBanner,
  ApprovalBanner,
  cx,
  focusRing,
  type LucideIcon,
} from "@orbit/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { JOBS_AI_HOME } from "../pages/jobs/paths";
import { RESUME_AI_HOME } from "../pages/resume/paths";
import { prefetchRoute } from "../routes";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { AiPill } from "./products";
import { Spinner } from "./ui";

// Daily destinations only, the same on the top bar and the phone tab bar. Settings sits beside the account menu (a
// gear, and in the menu), and Plan & billing in the menu: nobody opens them daily, and six destinations fit a 360 px
// phone and a 768 px tablet without wrapping. `ai`: Orbit's AI products, Resume AI and Jobs AI ("Resume" / "Jobs" and
// the gradient AI pill).
const NAV: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean; ai?: boolean }> = [
  { to: "/", label: "Home", icon: House, end: true },
  ...(MOCK_INTERVIEW_ENABLED ? [{ to: "/mock", label: "Practice", icon: Target }] : []),
  { to: "/sessions", label: "Sessions", icon: HistoryIcon },
  { to: "/documents", label: "Documents", icon: FolderOpen },
  { to: RESUME_AI_HOME, label: "Resume AI", icon: Sparkles, ai: true },
  { to: JOBS_AI_HOME, label: "Jobs AI", icon: Briefcase, ai: true },
];

/** The phone tab bar's columns: one per destination (Tailwind needs the class names written out). */
const PHONE_COLUMNS: Record<number, string> = { 4: "grid-cols-4", 5: "grid-cols-5", 6: "grid-cols-6" };

/** A nav label; Resume AI's is "Resume" with the AI pill, Jobs AI's "Jobs" (their links' aria-labels read the name). */
function NavLabel({ label, ai, small = false }: { label: string; ai?: boolean; small?: boolean }) {
  if (!ai) return <>{label}</>;
  return (
    <span className={cx("inline-flex items-center", small ? "gap-0.5" : "gap-1")}>
      {label.replace(/\s*AI$/, "")}
      <AiPill className={small ? "px-[2px] text-[0.5625rem] leading-[0.75rem]" : undefined} />
    </span>
  );
}

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
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6 lg:gap-6">
          <NavLink to="/" className={cx("shrink-0 rounded-lg", focusRing)} aria-label="Orbit home">
            <OrbitWordmark size={26} />
          </NavLink>

          {/* Narrow laptops and tablets (md): labels only, so six destinations fit beside Settings and the account menu. */}
          <nav aria-label="Main" className="hidden min-w-0 flex-1 items-center gap-0.5 md:flex lg:gap-1">
            {NAV.map(({ to, label, icon: Icon, end, ai }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                aria-label={ai ? label : undefined}
                onMouseEnter={() => prefetchRoute(to)}
                onFocus={() => prefetchRoute(to)}
                className={({ isActive }) =>
                  cx(
                    "relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-2.5 py-2 text-sm font-medium transition-colors lg:px-3",
                    isActive
                      ? "bg-indigo-500/10 text-indigo-700 dark:bg-white/[0.07] dark:text-white"
                      : "text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
                    focusRing,
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={cx(
                        "hidden h-4 w-4 lg:block",
                        (isActive || ai) && "text-indigo-500 dark:text-indigo-300",
                      )}
                    />
                    <NavLabel label={label} ai={ai} />
                    {isActive && (
                      <span className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-gradient-to-r from-indigo-500 to-aurora-400" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <WaitingForAccess />
          <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
            <NavLink
              to="/settings"
              aria-label="Settings"
              title="Settings"
              onMouseEnter={() => prefetchRoute("/settings")}
              onFocus={() => prefetchRoute("/settings")}
              className={({ isActive }) =>
                cx(
                  "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
                  isActive
                    ? "bg-indigo-500/10 text-indigo-600 dark:bg-white/[0.07] dark:text-white"
                    : "text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
                  focusRing,
                )
              }
            >
              <SettingsIcon className="h-[18px] w-[18px]" aria-hidden />
            </NavLink>
            <AccountMenu
              name={user?.name ?? null}
              email={user?.email ?? ""}
              onSettings={() => navigate("/settings")}
              onBilling={() => navigate("/billing")}
              onSignOut={signOut}
            />
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

      <AnnouncementBanner className="sm:px-6" />

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
        <ul className={cx("mx-auto grid max-w-lg", PHONE_COLUMNS[NAV.length])}>
          {NAV.map(({ to, label, icon: Icon, end, ai }) => (
            <li key={to} className="min-w-0">
              <NavLink
                to={to}
                end={end}
                aria-label={ai ? label : undefined}
                onTouchStart={() => prefetchRoute(to)}
                className={({ isActive }) =>
                  cx(
                    // 10px under 380 px: six labels ("Documents" the widest) fit a 360 px phone with room between them.
                    "flex flex-col items-center gap-1 whitespace-nowrap px-0.5 pb-2 pt-2.5 text-[10px] font-medium min-[380px]:text-[11px]",
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
                      <Icon className={cx("h-5 w-5", isActive ? "text-indigo-600 dark:text-indigo-200" : ai && "text-indigo-500 dark:text-indigo-300")} />
                    </span>
                    <NavLabel label={label} ai={ai} small />
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

/** Avatar button → account menu: who's signed in, settings, plan & billing, sign out. */
function AccountMenu({
  name,
  email,
  onSettings,
  onBilling,
  onSignOut,
}: {
  name: string | null;
  email: string;
  onSettings: () => void;
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
    <div ref={ref} className="relative">
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
          <button type="button" role="menuitem" className={item} onClick={choose(onSettings)}>
            <SettingsIcon className="h-4 w-4 text-zinc-500" />
            Settings
          </button>
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
      void api.adminUsers("pending", "", { limit: 1 }).then((r) => setCount(r.total ?? r.users.length)).catch(() => undefined);
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
        <Link to="/admin/users?only=pending" className={badge} aria-label={`${count} new ${count === 1 ? "account is" : "accounts are"} waiting for access`}>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
          {count} waiting
        </Link>
      )}
    </>
  );
}
