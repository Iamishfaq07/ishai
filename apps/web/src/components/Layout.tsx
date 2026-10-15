import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { Link, Outlet, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import {
  ArrowUpRight,
  AudioLines,
  BadgeIndianRupee,
  BookOpen,
  ChevronDown,
  Code2,
  CreditCard,
  Download,
  ErrorBoundary,
  FolderOpen,
  GraduationCap,
  HistoryIcon,
  IdCard,
  LayoutGrid,
  House,
  LogOut,
  MessageCircle,
  MessageSquareQuote,
  MOCK_INTERVIEW_ENABLED,
  OrbitWordmark,
  Search,
  SettingsIcon,
  ShieldCheck,
  VerifyEmailBanner,
  ApprovalBanner,
  buttonClass,
  cx,
  focusRing,
  isDialogOpen,
  isMacPlatform,
  Skeleton,
  type LucideIcon,
} from "@orbit/ui";
import { api } from "../lib/api";
import { isWindows } from "../lib/audio";
import { useAuth } from "../lib/auth";
import { DESKTOP_BETA, DESKTOP_DOWNLOAD_URL } from "../lib/desktop";
import { CONTACT_PAGE, POLICY_LINKS } from "../lib/contact";
import { SHELL_EVENTS, isTypingTarget, openSupport } from "../lib/shell";
import { JOBS_AI_HOME } from "../pages/jobs/paths";
import { OFFERS_HOME } from "../pages/offers/model";
import { LINKEDIN_HOME } from "../pages/linkedin/model";
import { CODE_HOME } from "../pages/code/paths";
import { KASHSEC_URL, LEARN_HOME } from "../pages/learn/links";
import { RESUME_AI_HOME } from "../pages/resume/paths";
import { prefetchRoute } from "../routes";
import { AnnouncementBanner } from "./AnnouncementBanner";
import { AppError } from "./AppError";
import { AiPill, PRODUCTS, ProductTabs, type ProductId, type ProductSection } from "./products";
import { Sheet } from "./Sheet";

// Their own chunks, downloaded the first time they open (or when the search button is hovered).
const loadPalette = () => import("./CommandPalette");
const CommandPalette = lazy(loadPalette);

/** Practice's page: mock interviews, with prep and progress. */
const PRACTICE_PATH = /^\/mock(\/|$)/;
function isPracticePath(pathname: string): boolean {
  return PRACTICE_PATH.test(pathname);
}
/** The interview copilot's pages: a new live session, past sessions, and the documents and stories its answers draw
 *  on (the story bank is under /documents). */
const COPILOT_PATH = /^\/(sessions|documents|start)(\/|$)/;
function isCopilotPath(pathname: string): boolean {
  return COPILOT_PATH.test(pathname);
}

interface NavItem {
  to: string;
  label: string;
  /** The shorter label: the top bar's when the full names don't fit. */
  short: string;
  /** The phone tab bar's label, when even shorter than `short` (it fits six tabs on a 360 px screen). */
  tab?: string;
  icon: LucideIcon;
  product?: ProductId;
  /** Which addresses the item is current on. */
  current: (pathname: string) => boolean;
  /** False: on phones it's in the "Me" sheet, not the tab bar (which fits six). */
  phone?: false;
  /** An AI tool: its name shows with the AI mark at its top right ("Resume" + AI) instead of the word. */
  ai?: true;
}

// One item per product, the same on the top bar and the phone tab bar (where "Me" is the last): the interview copilot
// (live help, with its sessions, documents and story bank) and Practice (mock interviews) are separate products.
// Plan & credits, Settings and Support are in the account menu ("Me" on phones). The addresses are the same as before, so
// nothing redirects.
const NAV: NavItem[] = [
  // Short naming shows Home as its icon alone (the logo next to it also goes home), so the products keep their names.
  { to: "/", label: "Home", short: "", tab: "Home", icon: House, current: (p) => p === "/" },
  {
    to: "/sessions",
    label: "Copilot AI",
    short: "Copilot AI",
    tab: "Copilot",
    icon: PRODUCTS.interview.icon,
    product: "interview",
    ai: true,
    current: isCopilotPath,
  },
  // Practice is mock interviews: with them switched off there's nothing to practise here.
  ...(MOCK_INTERVIEW_ENABLED
    ? [{ to: "/mock", label: "Practice", short: "Practice", icon: PRODUCTS.practice.icon, product: "practice" as const, ai: true as const, current: isPracticePath }]
    : []),
  {
    to: RESUME_AI_HOME,
    label: "Resume AI",
    short: "Resume AI",
    tab: "Resume",
    icon: PRODUCTS.resume.icon,
    product: "resume",
    ai: true,
    current: (p) => p === RESUME_AI_HOME || p.startsWith(`${RESUME_AI_HOME}/`),
  },
  { to: LINKEDIN_HOME, ai: true, label: "LinkedIn AI", short: "LinkedIn AI", icon: IdCard, phone: false, current: (p) => p === LINKEDIN_HOME || p.startsWith(`${LINKEDIN_HOME}/`) },
  // Learning AI holds Code AI (and links KashSec): one item for both.
  { to: LEARN_HOME, ai: true, label: "Learning AI", short: "Learning AI", icon: GraduationCap, phone: false, current: (p) => /^\/(learn|code)(\/|$)/.test(p) },
  { to: OFFERS_HOME, ai: true, label: "Offer AI", short: "Offer AI", icon: BadgeIndianRupee, phone: false, current: (p) => p === OFFERS_HOME || p.startsWith(`${OFFERS_HOME}/`) },
  {
    to: JOBS_AI_HOME,
    label: "Jobs AI",
    short: "Jobs AI",
    tab: "Jobs",
    icon: PRODUCTS.jobs.icon,
    product: "jobs",
    ai: true,
    current: (p) => p === JOBS_AI_HOME || p.startsWith(`${JOBS_AI_HOME}/`),
  },
];
/** The phone tab bar's tabs; the rest are in the "Me" sheet. */
const PHONE_NAV = NAV.filter((n) => n.phone !== false);
const MORE_TOOLS = NAV.filter((n) => n.phone === false);

/** The tabs between the interview copilot's pages (as Resume AI and Jobs AI have theirs). Practice is one page, so it
 *  has none. */
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

const ME_PATH = /^\/(billing|settings)(\/|$)/;

/** How the top bar names its items: full names, the short ones, or icons alone (named on hover and for readers). */
type NavFit = "full" | "short" | "icons";
const NAV_FITS: NavFit[] = ["full", "short", "icons"];

/**
 * The widest naming that fits the top bar right now. Breakpoints can't decide it: the text size setting scales every
 * label but not the breakpoints, so at 1024 px with large text the full names ran ~100 px into the search button.
 * It tries each naming on the nav itself and keeps the first that fits, again when the bar or the text size changes.
 */
function useNavFit(ref: RefObject<HTMLElement | null>): NavFit {
  const [fit, setFit] = useState<NavFit>("full");
  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const measure = () => {
      const best = NAV_FITS.find((f) => {
        nav.dataset.fit = f;
        return nav.scrollWidth <= nav.clientWidth + 1;
      }) ?? "icons";
      nav.dataset.fit = best;
      setFit(best);
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(nav);
    const textSize = new MutationObserver(measure); // Settings → text size sets the root's font size
    textSize.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => {
      resized.disconnect();
      textSize.disconnect();
    };
  }, [ref]);
  return fit;
}

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
  const [meOpen, setMeOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const openSupportChat = useCallback(() => {
    setMeOpen(false);
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
  // A page change closes the phone's "Me" sheet (its links navigate).
  useEffect(() => setMeOpen(false), [pathname]);

  const navRef = useRef<HTMLElement>(null);
  const navFit = useNavFit(navRef);
  const copilot = isCopilotPath(pathname);
  const learning = /^\/(learn|code)(\/|$)/.test(pathname);
  const meActive = ME_PATH.test(pathname) || MORE_TOOLS.some((t) => t.current(pathname));
  const shortcut = isMacPlatform() ? "⌘K" : "Ctrl K";

  return (
    <div className="flex min-h-full flex-col pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm dark:focus:bg-zinc-900"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-white dark:border-white/5 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:gap-5">
          <Link to="/" className={cx("shrink-0 rounded-lg", focusRing)} aria-label="Orbit home">
            <OrbitWordmark size={26} />
          </Link>

          <nav ref={navRef} aria-label="Main" data-fit={navFit} className="group hidden min-w-0 flex-1 items-center gap-0.5 md:flex lg:gap-1">
            {NAV.map(({ to, label, short, icon: Icon, product, current, ai }) => {
              const active = current(pathname);
              return (
                <Link
                  key={to}
                  to={to}
                  aria-label={label}
                  title={navFit === "icons" || (navFit === "short" && !short) ? label : undefined}
                  aria-current={active ? "page" : undefined}
                  onMouseEnter={() => prefetchRoute(to)}
                  onFocus={() => prefetchRoute(to)}
                  className={cx(
                    "relative flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition-colors group-data-[fit=short]:gap-1.5 group-data-[fit=short]:px-2",
                    active
                      ? "bg-indigo-500/10 text-indigo-700 dark:bg-white/[0.07] dark:text-white"
                      : "text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white",
                    focusRing,
                  )}
                >
                  <Icon className={cx("h-4 w-4", product ? PRODUCTS[product].text : active && "text-indigo-500 dark:text-indigo-300")} aria-hidden />
                  <span className="hidden group-data-[fit=full]:inline">{ai ? <AiName name={label} /> : label}</span>
                  {short && <span className="hidden group-data-[fit=short]:inline">{ai ? <AiName name={short} /> : short}</span>}
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
                "2xl:w-auto 2xl:justify-start 2xl:border 2xl:border-zinc-200 2xl:pl-3 2xl:pr-2 2xl:dark:border-white/10",
                focusRing,
              )}
            >
              <Search className="h-[18px] w-[18px]" aria-hidden />
              <span className="hidden text-sm 2xl:inline">Search</span>
              <kbd className="hidden rounded-md bg-zinc-500/10 px-1.5 py-0.5 font-sans text-xs text-zinc-600 2xl:inline dark:text-zinc-400">{shortcut}</kbd>
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

      <main id="main" className="mx-auto min-h-[100dvh] w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
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
        {/* Keyed on the route so each page fades up in. TODO(ws-a): view transitions replace this once they ship. */}
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

      {/* Phones: a thumb-reach tab bar, one tab per product and "Me" (at most six, which fit a 360 px screen). Solid, not
          see-through: page text scrolling under the labels made them hard to read. */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200/70 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.12)] md:hidden dark:border-white/5 dark:bg-zinc-950 dark:shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.6)]"
      >
        <ul className={cx("mx-auto grid max-w-lg", PHONE_NAV.length + 1 >= 6 ? "grid-cols-6" : "grid-cols-5")}>
          {PHONE_NAV.map(({ to, label, short, tab, icon: Icon, product, current, ai }) => {
            const active = current(pathname);
            const name = tab ?? short;
            return (
              <li key={to} className="min-w-0">
                <Link
                  to={to}
                  aria-label={name !== label ? label : undefined}
                  aria-current={active ? "page" : undefined}
                  onTouchStart={() => prefetchRoute(to)}
                  className={tabClass(active)}
                >
                  <span className="relative">
                    <TabIcon icon={Icon} active={active} className={product && !active ? PRODUCTS[product].text : undefined} />
                    {ai && <AiPill className="absolute -right-3.5 -top-1 scale-90" />}
                  </span>
                  {name}
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
              aria-label={`More: ${MORE_TOOLS.map((t) => t.label).join(", ")}, plan, settings, support and sign out`}
              className={cx(tabClass(meActive || meOpen), "w-full")}
            >
              <TabIcon icon={LayoutGrid} active={meActive || meOpen} />
              More
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

const footerLink = cx(
  "inline-flex min-h-6 items-center rounded py-1 text-zinc-600 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-white",
  focusRing,
);

/** A phone tab: 12 px labels (the smallest UI text); five of them fit a 360 px phone with room between. */
/** "Resume AI" shown as "Resume" with the AI mark at its top right (the name stays whole for screen readers). */
function AiName({ name }: { name: string }) {
  return (
    <span className="inline-flex items-start">
      {name.replace(/ AI$/, "")}
      <AiPill className="ml-0.5 -translate-y-1.5 scale-90" />
    </span>
  );
}

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
        {MORE_TOOLS.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <button type="button" className={row} onClick={() => onNavigate(to)}>
              <Icon className={cx(icon, "text-indigo-500 dark:text-indigo-400")} aria-hidden /> {label}
            </button>
          </li>
        ))}
        <li className={MORE_TOOLS.length ? "border-t border-zinc-200 pt-1 dark:border-white/10" : undefined}>
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
function WaitingForAccess() {
  const { pathname } = useLocation();
  const [admin, setAdmin] = useState(false);
  const [count, setCount] = useState(0);
  const [payments, setPayments] = useState(0);
  const [messages, setMessages] = useState(0);
  useEffect(() => {
    api.adminStatus().then((s) => setAdmin(s.is_admin)).catch(() => undefined);
  }, []);
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
