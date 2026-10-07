import { Suspense, lazy, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import {
  AudioLines,
  BookOpen,
  ChevronDown,
  CircleQuestionMark,
  CreditCard,
  Download,
  ErrorBoundary,
  FolderOpen,
  HistoryIcon,
  House,
  LogOut,
  MOCK_INTERVIEW_ENABLED,
  OrbitWordmark,
  Search,
  SettingsIcon,
  Target,
  UserRound,
  VerifyEmailBanner,
  ApprovalBanner,
  cx,
  focusRing,
  isDialogOpen,
  isMacPlatform,
  type LucideIcon,
} from "@orbit/ui";
import { api } from "../lib/api";
import { isWindows } from "../lib/audio";
import { useAuth } from "../lib/auth";
import { DESKTOP_DOWNLOAD_URL } from "../lib/desktop";
import { POLICY_LINKS } from "../lib/contact";
import { SHELL_EVENTS, isTypingTarget } from "../lib/shell";
import { JOBS_AI_HOME } from "../pages/jobs/paths";
import { RESUME_AI_HOME } from "../pages/resume/paths";
import { prefetchRoute } from "../routes";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { PRODUCTS, ProductTabs, type ProductId, type ProductSection } from "./products";
import { Sheet } from "./Sheet";
import { Spinner } from "./ui";

// Their own chunks, downloaded the first time they open (or when the search button is hovered).
const loadPalette = () => import("./CommandPalette");
const CommandPalette = lazy(loadPalette);
const HelpDialog = lazy(() => import("./HelpDialog"));

/** The interview copilot's pages: Practice, Sessions, the Story bank, Documents and a new live session. */
const INTERVIEW_PATH = /^\/(mock|sessions|documents|start)(\/|$)/;
function isInterviewPath(pathname: string): boolean {
  return INTERVIEW_PATH.test(pathname);
}

interface NavItem {
  to: string;
  label: string;
  /** The phone tab bar's shorter label. */
  short: string;
  icon: LucideIcon;
  product?: ProductId;
  /** Which addresses the item is current on. */
  current: (pathname: string) => boolean;
}

// One item per product, the same on the top bar and the phone tab bar (where "Me" is the fifth): "where am I" always
// has one of four answers. The interview copilot's daily pages are tabs under "Interview"; Plan & credits, Settings and
// Help are in the account menu ("Me" on phones). The addresses are the same as before, so nothing redirects.
const NAV: NavItem[] = [
  { to: "/", label: "Home", short: "Home", icon: House, current: (p) => p === "/" },
  {
    to: MOCK_INTERVIEW_ENABLED ? "/mock" : "/sessions",
    label: "Interview",
    short: "Interview",
    icon: PRODUCTS.interview.icon,
    product: "interview",
    current: isInterviewPath,
  },
  {
    to: RESUME_AI_HOME,
    label: "Resume AI",
    short: "Resume",
    icon: PRODUCTS.resume.icon,
    product: "resume",
    current: (p) => p === RESUME_AI_HOME || p.startsWith(`${RESUME_AI_HOME}/`),
  },
  {
    to: JOBS_AI_HOME,
    label: "Jobs AI",
    short: "Jobs",
    icon: PRODUCTS.jobs.icon,
    product: "jobs",
    current: (p) => p === JOBS_AI_HOME || p.startsWith(`${JOBS_AI_HOME}/`),
  },
];

/** The tabs between the interview copilot's pages (as Resume AI and Jobs AI have theirs). */
const INTERVIEW_SECTIONS: ProductSection[] = [
  ...(MOCK_INTERVIEW_ENABLED ? [{ to: "/mock", label: "Practice", icon: Target }] : []),
  { to: "/sessions", label: "Sessions", icon: HistoryIcon },
  { to: "/documents/stories", label: "Story bank", icon: BookOpen },
  { to: "/documents", label: "Documents", icon: FolderOpen, end: true },
];

const ME_PATH = /^\/(billing|settings)(\/|$)/;

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
  const { pathname } = location;
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  // A new page opens at its top; Back/Forward (POP) keeps the browser's own scroll position.
  useEffect(() => {
    if (navigationType !== "POP") window.scrollTo(0, 0);
  }, [pathname, navigationType]);
  const signOut = useCallback(() => void logout().then(() => navigate("/login")), [logout, navigate]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [meOpen, setMeOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const openHelp = useCallback(() => {
    setMeOpen(false);
    setHelpOpen(true);
  }, []);

  // Ctrl+K (⌘K on a Mac) anywhere, "/" when not typing: search. Not over another dialog. The live page has its own
  // shortcuts (Ctrl+K focuses its chat there) and isn't inside this layout.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isDialogOpen()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "/" && !mod && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    const onHelp = () => setHelpOpen(true);
    const onSearch = () => setSearchOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(SHELL_EVENTS.help, onHelp);
    window.addEventListener(SHELL_EVENTS.search, onSearch);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(SHELL_EVENTS.help, onHelp);
      window.removeEventListener(SHELL_EVENTS.search, onSearch);
    };
  }, []);
  // A page change closes the phone's "Me" sheet (its links navigate).
  useEffect(() => setMeOpen(false), [pathname]);

  const interview = isInterviewPath(pathname);
  const meActive = ME_PATH.test(pathname);
  const shortcut = isMacPlatform() ? "⌘K" : "Ctrl K";

  return (
    <div className="flex min-h-full flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm dark:focus:bg-zinc-900"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-white/90 dark:border-white/5 dark:bg-zinc-950/85">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6 lg:gap-6">
          <Link to="/" className={cx("shrink-0 rounded-lg", focusRing)} aria-label="Orbit home">
            <OrbitWordmark size={26} />
          </Link>

          <nav aria-label="Main" className="hidden min-w-0 flex-1 items-center gap-0.5 md:flex lg:gap-1">
            {NAV.map(({ to, label, icon: Icon, product, current }) => {
              const active = current(pathname);
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={active ? "page" : undefined}
                  onMouseEnter={() => prefetchRoute(to)}
                  onFocus={() => prefetchRoute(to)}
                  className={cx(
                    "relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-indigo-500/10 text-indigo-700 dark:bg-white/[0.07] dark:text-white"
                      : "text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
                    focusRing,
                  )}
                >
                  <Icon className={cx("h-4 w-4", product ? PRODUCTS[product].text : active && "text-indigo-500 dark:text-indigo-300")} aria-hidden />
                  {label}
                  {active && (
                    <span aria-hidden="true" className="absolute inset-x-3 -bottom-[13px] h-0.5 rounded-full bg-gradient-to-r from-indigo-500 to-aurora-400" />
                  )}
                </Link>
              );
            })}
          </nav>

          <WaitingForAccess />
          <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
            <button
              type="button"
              onClick={openSearch}
              onMouseEnter={() => void loadPalette()}
              onFocus={() => void loadPalette()}
              aria-label={`Search (${shortcut})`}
              aria-haspopup="dialog"
              className={cx(
                "flex h-10 w-10 items-center justify-center gap-2 rounded-full text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
                "lg:w-auto lg:justify-start lg:border lg:border-zinc-200 lg:pl-3 lg:pr-2 lg:dark:border-white/10",
                focusRing,
              )}
            >
              <Search className="h-[18px] w-[18px]" aria-hidden />
              <span className="hidden text-sm lg:inline">Search</span>
              <kbd className="hidden rounded-md bg-zinc-500/10 px-1.5 py-0.5 font-sans text-xs text-zinc-600 lg:inline dark:text-zinc-400">{shortcut}</kbd>
            </button>
            <Link
              to="/settings"
              aria-label="Settings"
              title="Settings"
              aria-current={pathname.startsWith("/settings") ? "page" : undefined}
              onMouseEnter={() => prefetchRoute("/settings")}
              onFocus={() => prefetchRoute("/settings")}
              className={cx(
                "hidden h-10 w-10 items-center justify-center rounded-full transition-colors md:flex",
                pathname.startsWith("/settings")
                  ? "bg-indigo-500/10 text-indigo-600 dark:bg-white/[0.07] dark:text-white"
                  : "text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
                focusRing,
              )}
            >
              <SettingsIcon className="h-[18px] w-[18px]" aria-hidden />
            </Link>
            <div className="hidden md:block">
              <AccountMenu
                name={user?.name ?? null}
                email={user?.email ?? ""}
                onSettings={() => navigate("/settings")}
                onBilling={() => navigate("/billing")}
                onHelp={openHelp}
                onSignOut={signOut}
              />
            </div>
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

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {interview && (
          <ProductTabs
            label="Interview"
            sections={INTERVIEW_SECTIONS}
            action={
              <Link
                to="/start"
                aria-current={pathname === "/start" ? "page" : undefined}
                onMouseEnter={() => prefetchRoute("/start")}
                onFocus={() => prefetchRoute("/start")}
                className={cx(
                  // TODO(ws-a): buttonClass("secondary") once the design layer exports it.
                  "inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors",
                  pathname === "/start"
                    ? "border-indigo-500/40 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200"
                    : "border-zinc-200 bg-white/90 text-zinc-900 hover:border-zinc-300 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-zinc-100 dark:hover:bg-white/10",
                  focusRing,
                )}
              >
                <AudioLines className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden />
                Start live session
              </Link>
            }
          />
        )}
        {/* Keyed on the route so each page fades up in. TODO(ws-a): view transitions replace this once they ship. */}
        <div key={pathname} className="animate-fade-up">
          {/* Inside the layout, and reset by that key on every navigation: a page that fails to load (its code gone
              after a deploy) or to render shows an error with Reload while the nav stays usable. */}
          <ErrorBoundary>
            {/* Inside the layout: the nav stays put while a page's code arrives. */}
            <Suspense
              fallback={
                // TODO(ws-a): a page Skeleton here instead of the spinner.
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

      {/* One quiet line under every page: Help in the same place each time, and the policies. */}
      <footer className="mx-auto w-full max-w-6xl px-4 pb-6 pt-2 text-xs sm:px-6">
        <nav aria-label="Help and policies" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-200/70 pt-4 dark:border-white/5">
          <button type="button" onClick={openHelp} className={footerLink}>
            Help
          </button>
          {POLICY_LINKS.map(({ href, label }) => (
            <a key={href} href={href} className={footerLink}>
              {label}
            </a>
          ))}
        </nav>
      </footer>

      {/* Phones: a thumb-reach tab bar, one tab per product and "Me". */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200/70 bg-white/95 pb-[env(safe-area-inset-bottom)] md:hidden dark:border-white/5 dark:bg-zinc-950/90"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {NAV.map(({ to, label, short, icon: Icon, product, current }) => {
            const active = current(pathname);
            return (
              <li key={to} className="min-w-0">
                <Link
                  to={to}
                  aria-label={short !== label ? label : undefined}
                  aria-current={active ? "page" : undefined}
                  onTouchStart={() => prefetchRoute(to)}
                  className={tabClass(active)}
                >
                  <TabIcon icon={Icon} active={active} className={product && !active ? PRODUCTS[product].text : undefined} />
                  {short}
                </Link>
              </li>
            );
          })}
          <li className="min-w-0">
            <button
              type="button"
              onClick={() => setMeOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={meOpen}
              aria-label="Me: plan, settings, help and sign out"
              className={cx(tabClass(meActive || meOpen), "w-full")}
            >
              <TabIcon icon={UserRound} active={meActive || meOpen} />
              Me
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={meOpen} onClose={() => setMeOpen(false)} title={user?.name || "Your account"} titleId="me-title">
        <MeMenu
          email={user?.email ?? ""}
          onNavigate={(to) => {
            setMeOpen(false);
            navigate(to);
          }}
          onHelp={openHelp}
          onSignOut={signOut}
        />
      </Sheet>

      {searchOpen && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setSearchOpen(false)} onHelp={openHelp} onSignOut={signOut} />
        </Suspense>
      )}
      {helpOpen && (
        <Suspense fallback={null}>
          <HelpDialog
            open
            onClose={() => setHelpOpen(false)}
            onSearch={() => {
              setHelpOpen(false);
              setSearchOpen(true);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

const footerLink = cx(
  "inline-flex min-h-6 items-center rounded py-1 text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-white",
  focusRing,
);

/** A phone tab: 12 px labels (the smallest UI text); five of them fit a 360 px phone with room between. */
function tabClass(active: boolean): string {
  return cx(
    "flex min-h-14 flex-col items-center justify-center gap-1 whitespace-nowrap px-0.5 pb-2 pt-2.5 text-xs font-medium",
    active ? "text-indigo-700 dark:text-white" : "text-zinc-600 dark:text-zinc-400",
    focusRing,
  );
}

function TabIcon({ icon: Icon, active, className }: { icon: LucideIcon; active: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-gradient-to-r from-indigo-500/25 to-aurora-400/15")}
    >
      <Icon className={cx("h-5 w-5", active ? "text-indigo-700 dark:text-indigo-200" : className)} />
    </span>
  );
}

/** The phone's "Me" tab: the account menu as a sheet, with big rows for thumbs. */
function MeMenu({
  email,
  onNavigate,
  onHelp,
  onSignOut,
}: {
  email: string;
  onNavigate: (to: string) => void;
  onHelp: () => void;
  onSignOut: () => void;
}) {
  const row = cx(
    "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-base text-zinc-800 hover:bg-zinc-900/5 dark:text-zinc-100 dark:hover:bg-white/5",
    focusRing,
  );
  const icon = "h-5 w-5 text-zinc-500 dark:text-zinc-400";
  return (
    <div className="px-3 pb-4 pt-2">
      <p className="truncate px-3 pb-2 text-sm text-zinc-600 dark:text-zinc-400">{email}</p>
      <ul className="space-y-0.5">
        <li>
          <button type="button" className={row} onClick={() => onNavigate("/billing")}>
            <CreditCard className={icon} aria-hidden /> Plan &amp; credits
          </button>
        </li>
        <li>
          <button type="button" className={row} onClick={() => onNavigate("/settings")}>
            <SettingsIcon className={icon} aria-hidden /> Settings
          </button>
        </li>
        <li>
          <button type="button" className={row} onClick={onHelp}>
            <CircleQuestionMark className={icon} aria-hidden /> Help
          </button>
        </li>
        {isWindows() && (
          <li>
            <a href={DESKTOP_DOWNLOAD_URL} className={row}>
              <Download className={icon} aria-hidden /> Get the Windows app
            </a>
          </li>
        )}
        <li className="pt-1">
          <button type="button" className={row} onClick={onSignOut}>
            <LogOut className={icon} aria-hidden /> Sign out
          </button>
        </li>
      </ul>
    </div>
  );
}

/** Avatar button → account menu: who's signed in, plan & credits, settings, help, the Windows app, sign out. */
function AccountMenu({
  name,
  email,
  onSettings,
  onBilling,
  onHelp,
  onSignOut,
}: {
  name: string | null;
  email: string;
  onSettings: () => void;
  onBilling: () => void;
  onHelp: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    // Focus starts on the first item, so the arrow keys work straight away.
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // Arrow keys move between the items, as in any menu; Tab leaves it.
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Tab") setOpen(false);
  };
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
        ref={buttonRef}
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
        <ChevronDown className={cx("h-4 w-4 text-zinc-500 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
          className="glass-panel absolute right-0 top-full z-30 mt-2 w-64 animate-scale-in rounded-2xl p-1.5 shadow-xl"
        >
          <div className="px-3 py-2">
            {name && <p className="truncate text-sm font-medium">{name}</p>}
            <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">{email}</p>
          </div>
          <div className="my-1 h-px bg-zinc-200 dark:bg-white/10" />
          <button type="button" role="menuitem" className={item} onClick={choose(onBilling)}>
            <CreditCard className="h-4 w-4 text-zinc-500" aria-hidden />
            Plan &amp; credits
          </button>
          <button type="button" role="menuitem" className={item} onClick={choose(onSettings)}>
            <SettingsIcon className="h-4 w-4 text-zinc-500" aria-hidden />
            Settings
          </button>
          <button type="button" role="menuitem" className={item} onClick={choose(onHelp)}>
            <CircleQuestionMark className="h-4 w-4 text-zinc-500" aria-hidden />
            Help
          </button>
          {isWindows() && (
            <a role="menuitem" href={DESKTOP_DOWNLOAD_URL} className={item} onClick={() => setOpen(false)}>
              <Download className="h-4 w-4 text-zinc-500" aria-hidden />
              Get the Windows app
            </a>
          )}
          <div className="my-1 h-px bg-zinc-200 dark:bg-white/10" />
          <button type="button" role="menuitem" className={item} onClick={choose(onSignOut)}>
            <LogOut className="h-4 w-4 text-zinc-500" aria-hidden />
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
