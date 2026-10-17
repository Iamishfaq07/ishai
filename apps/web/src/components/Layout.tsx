import { Suspense, lazy, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import {
  ArrowUpRight,
  AudioLines,
  BookOpen,
  ChevronDown,
  Code2,
  Compass,
  CreditCard,
  Download,
  ErrorBoundary,
  FolderOpen,
  GraduationCap,
  HistoryIcon,
  LogOut,
  MessageCircle,
  MessageSquareQuote,
  MOCK_INTERVIEW_ENABLED,
  OrbitWordmark,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  SettingsIcon,
  ShieldCheck,
  UsersRound,
  VerifyEmailBanner,
  ApprovalBanner,
  Avatar,
  Kbd,
  floatingClass,
  menuItemClass,
  menuKeys,
  useDismiss,
  buttonClass,
  cx,
  focusRing,
  isDialogOpen,
  isMacPlatform,
  safeLocal,
  Skeleton,
  type LucideIcon,
} from "@orbit/ui";
import { api } from "../lib/api";
import { isWindows } from "../lib/audio";
import { useAuth } from "../lib/auth";
import { useCountry } from "../lib/country";
import { DESKTOP_BETA, DESKTOP_DOWNLOAD_URL } from "../lib/desktop";
import { CONTACT_PAGE, POLICY_LINKS } from "../lib/contact";
import { SHELL_EVENTS, isTypingTarget, openSupport } from "../lib/shell";
import { CODE_HOME } from "../pages/code/paths";
import { JOBS_AI_HOME } from "../pages/jobs/paths";
import { KASHSEC_URL, LEARN_HOME } from "../pages/learn/links";
import { OFFERS_HOME } from "../pages/offers/model";
import { RESUME_AI_HOME } from "../pages/resume/paths";
import { prefetchRoute } from "../routes";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { AppError } from "./AppError";
import { COPILOT_PATH, LEARNING_PATH, SIDEBAR_KEY, exploreItems, navGroups, phoneTabs, sidebarCollapsed, type NavItem } from "./nav";
import { PRODUCTS, ProductTabs, type ProductSection } from "./products";
import { Sheet } from "./Sheet";

// Their own chunks, downloaded the first time they open (or when the search button is hovered).
const loadPalette = () => import("./CommandPalette");
const CommandPalette = lazy(loadPalette);

const TABS = phoneTabs();
// The sidebar's groups and the Explore sheet's items: the same everywhere but for Offer AI's mark (the rupee in India).
const useNavGroups = () => navGroups(MOCK_INTERVIEW_ENABLED, useCountry());
const useExploreItems = () => exploreItems(MOCK_INTERVIEW_ENABLED, useCountry());

/** The tabs between the interview copilot's pages (as Resume AI and Jobs AI have theirs). */
const COPILOT_SECTIONS: ProductSection[] = [
  { to: "/sessions", label: "Sessions", icon: HistoryIcon },
  { to: "/documents", label: "Documents", icon: FolderOpen, end: true },
  { to: "/documents/stories", label: "Story bank", icon: BookOpen },
  { to: "/documents/answers", label: "My answers", icon: MessageSquareQuote },
];
/** Learning AI's tabs: its overview and Code AI; KashSec, another site, is a link beside them. */
const LEARN_SECTIONS: ProductSection[] = [
  { to: LEARN_HOME, label: "Overview", icon: GraduationCap, end: true },
  { to: CODE_HOME, label: "Code AI", icon: Code2 },
];
/** Shown when the deployment has the Career Evidence Vault switched on (the account says so). */
const EVIDENCE_SECTION: ProductSection = { to: "/documents/evidence", label: "Evidence", icon: ShieldCheck };

/** The one "New…" menu: the first step of each job, from anywhere. */
const NEW_ACTIONS: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/start", label: "Live interview session", icon: AudioLines },
  ...(MOCK_INTERVIEW_ENABLED ? [{ to: "/mock", label: "Mock interview", icon: PRODUCTS.practice.icon }] : []),
  { to: RESUME_AI_HOME, label: "Resume", icon: PRODUCTS.resume.icon },
  { to: JOBS_AI_HOME, label: "Job search", icon: PRODUCTS.jobs.icon },
  { to: OFFERS_HOME, label: "Offer to compare", icon: CreditCard },
];

const EXPLORE_PATH = /^\/(billing|settings|admin)(\/|$)/;

function initials(name: string | null | undefined, email: string | undefined): string {
  const source = name?.trim() || email?.split("@")[0] || "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Shown while a page's code is still arriving. A header and two cards, not a spinner in an empty main. */
function RouteFallback() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading</span>
      <div className="max-w-sm">
        <Skeleton variant="line" count={2} />
      </div>
      <Skeleton variant="card" count={2} />
    </div>
  );
}

/** Whether the signed-in account is the admin (cheap, once per layout). */
function useIsAdmin(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    api.adminStatus().then((s) => setAdmin(s.is_admin)).catch(() => undefined);
  }, []);
  return admin;
}

/** The sidebar's collapsed state, remembered on this device. */
function useSidebar(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => sidebarCollapsed(safeLocal.getItem(SIDEBAR_KEY), window.innerWidth));
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      safeLocal.setItem(SIDEBAR_KEY, c ? "expanded" : "collapsed");
      return !c;
    });
  }, []);
  return [collapsed, toggle];
}

export function Layout() {
  const { user, logout, setUser } = useAuth();
  const explore = useExploreItems();
  // Only nag when this server actually locks paid features behind verification.
  const [verificationRequired, setVerificationRequired] = useState(false);
  useEffect(() => {
    api.authConfig().then((c) => setVerificationRequired(c.email_verification === "required")).catch(() => undefined);
  }, []);
  // The signed-in app is calm: no starfield, opaque cards (base.css html.app-shell).
  useEffect(() => {
    document.documentElement.classList.add("app-shell");
    return () => document.documentElement.classList.remove("app-shell");
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
  const admin = useIsAdmin();
  const [collapsed, toggleSidebar] = useSidebar();

  const [searchOpen, setSearchOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const openSupportChat = useCallback(() => {
    setExploreOpen(false);
    openSupport();
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
    const onSearch = () => setSearchOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(SHELL_EVENTS.search, onSearch);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(SHELL_EVENTS.search, onSearch);
    };
  }, []);
  // A page change closes the phone's Explore sheet (its links navigate).
  useEffect(() => setExploreOpen(false), [pathname]);

  const copilot = COPILOT_PATH.test(pathname);
  const learning = LEARNING_PATH.test(pathname);
  const exploreActive = EXPLORE_PATH.test(pathname) || explore.some((t) => t.current(pathname));
  const shortcut = isMacPlatform() ? "⌘K" : "Ctrl K";

  return (
    <div className="flex min-h-full">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm dark:focus:bg-zinc-900"
      >
        Skip to content
      </a>

      <Sidebar
        collapsed={collapsed}
        onToggle={toggleSidebar}
        pathname={pathname}
        admin={admin}
        onHelp={openSupportChat}
      />

      <div className="flex min-w-0 flex-1 flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-white dark:border-white/5 dark:bg-zinc-950">
          <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2.5 sm:px-6">
            <Link to="/" className={cx("shrink-0 rounded-lg md:hidden", focusRing)} aria-label="Orbit home">
              <OrbitWordmark size={24} />
            </Link>
            <button
              type="button"
              onClick={openSearch}
              onMouseEnter={() => void loadPalette()}
              onFocus={() => void loadPalette()}
              // The visible words come first (WCAG 2.5.3): on phones they're hidden, so the label still says them.
              aria-label={`Search or jump to… ${shortcut}`}
              aria-haspopup="dialog"
              className={cx(
                "ml-auto flex h-10 items-center gap-2 rounded-xl text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 md:ml-0 md:w-full md:max-w-sm md:border md:border-zinc-200 md:bg-zinc-50 md:pl-3 md:pr-2 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white md:dark:border-white/10 md:dark:bg-white/[0.03]",
                "w-10 justify-center md:justify-start",
                focusRing,
              )}
            >
              <Search className="h-[18px] w-[18px] shrink-0" aria-hidden />
              <span className="hidden flex-1 text-left text-sm md:inline">Search or jump to…</span>
              <Kbd className="hidden md:inline-flex">{shortcut}</Kbd>
            </button>
            <div className="flex shrink-0 items-center gap-1 md:ml-auto">
              <WaitingForAccess admin={admin} />
              <NewMenu onNavigate={navigate} />
              <div className="hidden md:block">
                <AccountMenu
                  name={user?.name ?? null}
                  email={user?.email ?? ""}
                  onSettings={() => navigate("/settings")}
                  onBilling={() => navigate("/billing")}
                  onHelp={openSupportChat}
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

        <main id="main" className="mx-auto min-h-[100dvh] w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
          {learning && (
            <ProductTabs
              label="Learning AI"
              sections={LEARN_SECTIONS}
              action={
                <a href={KASHSEC_URL} target="_blank" rel="noopener" className={buttonClass("secondary", "md", "min-h-10")}>
                  <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-300" aria-hidden /> KashSec: free security and AI lessons
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              }
            />
          )}
          {copilot && (
            <ProductTabs
              label="Interview copilot"
              sections={user?.evidence_vault ? [...COPILOT_SECTIONS, EVIDENCE_SECTION] : COPILOT_SECTIONS}
              action={
                <Link
                  to="/start"
                  aria-current={pathname === "/start" ? "page" : undefined}
                  onMouseEnter={() => prefetchRoute("/start")}
                  onFocus={() => prefetchRoute("/start")}
                  className={
                    pathname === "/start"
                      ? cx(
                          "inline-flex min-h-10 items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3.5 text-sm font-medium text-indigo-700 dark:text-indigo-200",
                          focusRing,
                        )
                      : buttonClass("secondary", "md", "min-h-10")
                  }
                >
                  <AudioLines className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden />
                  Start live session
                </Link>
              }
            />
          )}
          {/* Keyed on the route so each page fades up in. */}
          <div key={pathname} className="animate-fade-up">
            {/* Inside the layout, and reset by that key on every navigation: a page that fails to load (its code gone
                after a deploy) or to render shows an error with Reload while the nav stays usable. */}
            <ErrorBoundary fallback={(error, reset) => <AppError error={error} reset={reset} />}>
              {/* Inside the layout: the nav stays put while a page's code arrives. */}
              <Suspense fallback={<RouteFallback />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>

        {/* One quiet line under every page: Support in the same place each time, and the policies. */}
        <footer className="mx-auto w-full max-w-6xl px-4 pb-6 pt-2 text-xs sm:px-6">
          <nav aria-label="Support and policies" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-200/70 pt-4 dark:border-white/5">
            <button type="button" onClick={openSupportChat} className={footerLink}>
              Support
            </button>
            <Link to={CONTACT_PAGE} className={footerLink}>
              Contact us
            </Link>
            {POLICY_LINKS.map(({ href, label }) => (
              <a key={href} href={href} className={footerLink}>
                {label}
              </a>
            ))}
            <span className="text-zinc-400">© {new Date().getFullYear()} Orbit</span>
          </nav>
        </footer>
      </div>

      {/* Phones: five destinations in thumb reach (four tabs and Explore). Solid, so page text never scrolls under the
          labels. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200/70 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.12)] md:hidden dark:border-white/5 dark:bg-zinc-950 dark:shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.6)]"
      >
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {TABS.map(({ to, label, tab, icon: Icon, current }) => {
            const active = current(pathname);
            const name = tab ?? label;
            return (
              <li key={to} className="min-w-0">
                <Link
                  to={to}
                  aria-label={name !== label ? label : undefined}
                  aria-current={active ? "page" : undefined}
                  onTouchStart={() => prefetchRoute(to)}
                  className={tabClass(active)}
                >
                  <TabIcon icon={Icon} active={active} />
                  {name}
                </Link>
              </li>
            );
          })}
          <li className="min-w-0">
            <button
              type="button"
              onClick={() => setExploreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={exploreOpen}
              aria-label={`Explore: ${explore.map((t) => t.label).join(", ")}, plan, settings, support and sign out`}
              className={cx(tabClass(exploreActive || exploreOpen), "w-full")}
            >
              <TabIcon icon={Compass} active={exploreActive || exploreOpen} />
              Explore
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={exploreOpen} onClose={() => setExploreOpen(false)} title="Explore" titleId="explore-title">
        <ExploreMenu
          name={user?.name ?? null}
          email={user?.email ?? ""}
          pathname={pathname}
          admin={admin}
          onNavigate={(to) => {
            setExploreOpen(false);
            navigate(to);
          }}
          onHelp={openSupportChat}
          onSignOut={signOut}
        />
      </Sheet>

      {searchOpen && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setSearchOpen(false)} onHelp={openSupportChat} onSignOut={signOut} />
        </Suspense>
      )}
    </div>
  );
}

/**
 * Desktop and tablets: the tools grouped by task (prepare, apply, interview and the offer), with the account's own
 * places at the foot. Collapses to icons (named on hover and for screen readers); the choice is kept on this device.
 */
function Sidebar({
  collapsed,
  onToggle,
  pathname,
  admin,
  onHelp,
}: {
  collapsed: boolean;
  onToggle: () => void;
  pathname: string;
  admin: boolean;
  onHelp: () => void;
}) {
  const groups = useNavGroups();
  const foot: Array<{ to: string; label: string; icon: LucideIcon }> = [
    { to: "/billing", label: "Plan & credits", icon: CreditCard },
    { to: "/settings", label: "Settings", icon: SettingsIcon },
    ...(admin ? [{ to: "/admin/users", label: "Admin", icon: UsersRound }] : []),
  ];
  return (
    <aside
      aria-label="Orbit"
      className={cx(
        "sticky top-0 z-30 hidden h-[100dvh] shrink-0 flex-col border-r border-zinc-200/70 bg-white transition-[width] duration-200 md:flex dark:border-white/5 dark:bg-zinc-950",
        collapsed ? "w-[4.25rem]" : "w-60",
      )}
    >
      <div className={cx("flex h-[3.75rem] items-center border-b border-zinc-200/70 dark:border-white/5", collapsed ? "justify-center px-2" : "justify-between pl-4 pr-2")}>
        {!collapsed && (
          <Link to="/" className={cx("rounded-lg", focusRing)} aria-label="Orbit home">
            <OrbitWordmark size={24} />
          </Link>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
          title={collapsed ? "Expand" : "Collapse"}
          aria-expanded={!collapsed}
          className={cx("flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white", focusRing)}
        >
          {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden /> : <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />}
        </button>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group) => (
          <div key={group.label ?? "top"} className={group.label ? "mt-4" : undefined}>
            {group.label &&
              (collapsed ? (
                <div className="mx-3 mb-2 h-px bg-zinc-200 dark:bg-white/10" aria-hidden />
              ) : (
                <p className="mb-1 px-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">{group.label}</p>
              ))}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.id}>
                  <SideLink item={item} active={item.current(pathname)} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-zinc-200/70 px-2 py-2 dark:border-white/5">
        <ul className="space-y-0.5">
          {foot.map(({ to, label, icon: Icon }) => {
            const active = pathname === to || pathname.startsWith(`${to}/`) || (to.startsWith("/admin") && pathname.startsWith("/admin"));
            return (
              <li key={to}>
                <Link
                  to={to}
                  aria-label={collapsed ? label : undefined}
                  title={collapsed ? label : undefined}
                  aria-current={active ? "page" : undefined}
                  onMouseEnter={() => prefetchRoute(to)}
                  className={sideClass(active, collapsed)}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                  {!collapsed && label}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={onHelp} aria-label={collapsed ? "Support" : undefined} title={collapsed ? "Support" : undefined} className={cx(sideClass(false, collapsed), "w-full")}>
              <MessageCircle className="h-[18px] w-[18px] shrink-0" aria-hidden />
              {!collapsed && "Support"}
            </button>
          </li>
        </ul>
      </div>
    </aside>
  );
}

function sideClass(active: boolean, collapsed: boolean): string {
  return cx(
    "relative flex min-h-10 items-center gap-3 rounded-lg text-sm font-medium transition-colors duration-150",
    collapsed ? "justify-center px-0" : "px-3",
    active
      ? "bg-zinc-900/[0.06] text-zinc-900 dark:bg-white/[0.07] dark:text-white"
      : "text-zinc-600 hover:bg-zinc-900/[0.04] hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
    focusRing,
  );
}

function SideLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  // One colour for every icon (the accent marks the page you're on), and each tool by its whole name ("Resume AI"):
  // a different colour and an AI badge per item read as noise in a list people scan all day.
  const { to, label, icon: Icon } = item;
  return (
    <Link
      to={to}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => prefetchRoute(to)}
      onFocus={() => prefetchRoute(to)}
      className={sideClass(active, collapsed)}
    >
      {/* Grows in when you arrive on the page (base.css .nav-mark). */}
      {active && <span aria-hidden className="nav-mark absolute inset-y-2 left-0 w-0.5 rounded-full bg-indigo-600 dark:bg-indigo-400" />}
      <Icon className={cx("h-[18px] w-[18px] shrink-0", active ? "text-indigo-600 dark:text-indigo-300" : "text-zinc-500 dark:text-zinc-400")} aria-hidden />
      {!collapsed && label}
    </Link>
  );
}

/** "New…": start the first step of any job from anywhere (a live session, a mock, a resume, a search, an offer). */
function NewMenu({ onNavigate }: { onNavigate: (to: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  // Escape (focus back on New) or a press outside closes it; focus starts on the first item.
  useDismiss(open, close, ref, buttonRef);
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="New"
        className={cx(buttonClass("primary", "sm", "h-9 gap-1.5 px-3"))}
      >
        <Plus className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">New</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="New"
          onKeyDown={(e) => menuKeys(e, menuRef.current, close)}
          className={cx(floatingClass("menu"), "absolute right-0 top-full mt-2 w-60 origin-top-right animate-menu-in p-1")}
        >
          {NEW_ACTIONS.map(({ to, label, icon: Icon }) => (
            <button
              key={to}
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => {
                setOpen(false);
                onNavigate(to);
              }}
            >
              <Icon className="h-4 w-4 text-zinc-500" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// The shared menu row (packages/ui Menu): arrow keys, first letters, Escape and outside presses work the same in
// every menu.
const menuItem = menuItemClass();

/** Phones: Explore lists every other tool (with the AI mark), then the account's places, in big rows for thumbs. */
function ExploreMenu({
  name,
  email,
  pathname,
  admin,
  onNavigate,
  onHelp,
  onSignOut,
}: {
  name: string | null;
  email: string;
  pathname: string;
  admin: boolean;
  onNavigate: (to: string) => void;
  onHelp: () => void;
  onSignOut: () => void;
}) {
  const explore = useExploreItems();
  const row = cx(
    "flex min-h-12 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-base text-zinc-800 hover:bg-zinc-900/5 dark:text-zinc-100 dark:hover:bg-white/5",
    focusRing,
  );
  const icon = "h-5 w-5 text-zinc-500 dark:text-zinc-400";
  return (
    <div className="px-3 pb-4 pt-2">
      <ul className="grid grid-cols-2 gap-2">
        {explore.map((item) => {
          const active = item.current(pathname);
          const Icon = item.icon;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => onNavigate(item.to)}
                className={cx(
                  "flex min-h-[4.5rem] w-full flex-col items-start justify-between gap-2 rounded-2xl border p-3 text-left text-sm font-medium",
                  active ? "border-indigo-500/40 bg-indigo-500/10" : "border-zinc-200 hover:bg-zinc-900/5 dark:border-white/10 dark:hover:bg-white/5",
                  focusRing,
                )}
              >
                <Icon className="h-5 w-5 text-zinc-500 dark:text-zinc-400" aria-hidden />
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 truncate px-3 pb-1 text-sm text-zinc-600 dark:text-zinc-400">{name ? `${name} · ${email}` : email}</p>
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
        {admin && (
          <li>
            <button type="button" className={row} onClick={() => onNavigate("/admin/users")}>
              <UsersRound className={icon} aria-hidden /> Admin
            </button>
          </li>
        )}
        <li>
          <button type="button" className={row} onClick={onHelp}>
            <MessageCircle className={icon} aria-hidden /> Support
          </button>
        </li>
        {isWindows() && (
          <li>
            <a href={DESKTOP_DOWNLOAD_URL} className={row}>
              <Download className={icon} aria-hidden /> Get the Windows app{DESKTOP_BETA && " (beta)"}
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
      className={cx("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-indigo-600/10 dark:bg-indigo-400/15")}
    >
      <Icon className={cx("h-5 w-5", active ? "text-indigo-700 dark:text-indigo-200" : cx("text-zinc-500 dark:text-zinc-400", className))} />
    </span>
  );
}

/** Avatar button → account menu: who's signed in, plan & credits, settings, support, the Windows app, sign out. */
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
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, ref, buttonRef);
  // Focus starts on the first item, so the arrow keys work straight away.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => menuKeys(e, menuRef.current, close);
  const item = menuItemClass();
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
        // The initials it shows are in its name too (WCAG 2.5.3: say what you see).
        aria-label={`${initials(name, email)} account menu`}
        className={cx("flex items-center gap-1.5 rounded-full p-0.5 pr-1.5 hover:bg-zinc-900/5 dark:hover:bg-white/5", focusRing)}
      >
        <Avatar name={name || email} size="sm" className="h-8 w-8" />
        <ChevronDown className={cx("h-4 w-4 text-zinc-500 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
          className={cx(floatingClass("menu"), "absolute right-0 top-full mt-2 w-64 origin-top-right animate-menu-in p-1")}
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
            <MessageCircle className="h-4 w-4 text-zinc-500" aria-hidden />
            Support
          </button>
          {isWindows() && (
            <a role="menuitem" href={DESKTOP_DOWNLOAD_URL} className={item} onClick={() => setOpen(false)}>
              <Download className="h-4 w-4 text-zinc-500" aria-hidden />
              Get the Windows app{DESKTOP_BETA && " (beta)"}
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
 * Admin only: how many new accounts are waiting for access (linking to Users & access), UPI payments to check, and
 * unread Contact messages (linking to the Inbox: the only notice of a new message, which sends no email). The in-app
 * side of the sign-up email, and the only one on a server without SMTP. Re-counted on every page change and each
 * minute.
 */
function WaitingForAccess({ admin }: { admin: boolean }) {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  const [payments, setPayments] = useState(0);
  const [messages, setMessages] = useState(0);
  useEffect(() => {
    if (!admin) return;
    const load = () => {
      void api.adminUsers("pending", "", { limit: 1 }).then((r) => setCount(r.total ?? r.users.length)).catch(() => undefined);
      void api.adminPayments("submitted").then((r) => setPayments(r.waiting)).catch(() => undefined);
      void api.adminInbox({ status: "new", limit: 1 }).then((r) => setMessages(r.counts.new)).catch(() => undefined);
    };
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [admin, pathname]);
  if (!admin || !(count || payments || messages)) return null;
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
      {messages > 0 && (
        <Link to="/admin/inbox?status=new" className={badge} aria-label={`${messages} unread ${messages === 1 ? "message" : "messages"} in the Inbox`}>
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
          {messages > 99 ? "99+" : messages} unread
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
