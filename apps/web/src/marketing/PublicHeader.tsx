import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, ChevronDown, Menu, X, buttonClass, cx, floatingClass, focusRing, lockScroll, useDismiss, useFocusTrap } from "@orbit/ui";
import { useAuth } from "../lib/auth";
import { useIndia } from "../lib/country";
import { BrandLogo } from "./BrandLogo";
import { PRODUCT_TILE, SITE_LINKS, siteProducts, type SiteProduct } from "./catalog";
import { Container, IconTile } from "./primitives";

/**
 * The public site's header, shared by every signed-out page (and the public pages a signed-in person can open): the
 * logo, a Products menu, the sections people look for (pricing, security, contact), and Sign in / Start free. On a
 * phone, the logo, Start free and a menu button that opens the whole site as one sheet. Opaque, sticky, one hairline.
 *
 * `authState` is passed to the sign-in and sign-up links (a product page sends people back to itself), `context` is a
 * short label after the logo ("Resume AI", "Contact"), `actions` replaces the account buttons (Warm-up's "Back to
 * Practice").
 */
export function PublicHeader({ authState, context, actions }: { authState?: { from: string }; context?: ReactNode; actions?: ReactNode }) {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const account = actions ?? (user ? (
    <Link to="/" className={buttonClass("primary", "md", "min-h-10")}>
      Open Orbit <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  ) : (
    <>
      <Link to="/login" state={authState} className={cx(buttonClass("ghost", "md", "hidden min-h-10 sm:inline-flex"))}>
        Sign in
      </Link>
      <Link to="/register" state={authState} className={buttonClass("primary", "md", "min-h-10")}>
        Start free
      </Link>
    </>
  ));

  return (
    <header
      className={cx(
        "sticky top-0 z-30 border-b mk-canvas transition-[border-color,box-shadow] duration-quick",
        scrolled ? "mk-line" : "border-transparent",
      )}
    >
      <Container className="relative flex h-16 items-center gap-2">
        <Link to="/" className={cx("-ml-1 shrink-0 rounded-lg p-1", focusRing)} aria-label="Orbit home">
          <BrandLogo height={26} decorative />
        </Link>
        {context && (
          <>
            <span className="mx-1 hidden h-5 w-px bg-zinc-200 sm:block dark:bg-white/15" aria-hidden="true" />
            <span className="hidden truncate text-sm font-medium text-zinc-700 sm:block dark:text-zinc-200">{context}</span>
          </>
        )}
        <nav aria-label="Main" className="ml-6 hidden items-center gap-0.5 text-sm md:flex">
          <ProductsMenu />
          <NavLink to={SITE_LINKS.companies} also={/^\/roles(\/|$)/} className="hidden lg:inline-flex">
            Interview guides
          </NavLink>
          <NavLink to={SITE_LINKS.pricing}>Pricing</NavLink>
          <NavLink to={SITE_LINKS.security} className="hidden lg:inline-flex">
            Security
          </NavLink>
          <NavLink to="/contact">Contact</NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {account}
          <MobileMenu authState={authState} />
        </div>
      </Container>
    </header>
  );
}

/** A section of the site: current (aria-current, ink) on its own pages; `also` adds addresses that count too. */
function NavLink({ to, children, className, also }: { to: string; children: ReactNode; className?: string; also?: RegExp }) {
  const { pathname } = useLocation();
  const current = !to.includes("#") && (pathname === to || pathname.startsWith(`${to}/`) || Boolean(also?.test(pathname)));
  return (
    <Link
      to={to}
      aria-current={current ? "page" : undefined}
      className={cx(
        "inline-flex min-h-10 items-center rounded-lg px-3 font-medium transition-colors duration-quick hover:bg-zinc-900/[0.04] hover:text-zinc-950 dark:hover:bg-white/5 dark:hover:text-white",
        current ? "text-zinc-950 dark:text-white" : "text-zinc-600 dark:text-zinc-300",
        focusRing,
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** One product in a menu: its mark, name and line. */
function ProductItem({ p, onPick, compact = false }: { p: SiteProduct; onPick: () => void; compact?: boolean }) {
  const external = p.href.endsWith(".html");
  const body = (
    <>
      <IconTile icon={p.icon} tone={PRODUCT_TILE[p.id]} size={compact ? "sm" : "md"} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-950 dark:text-white">{p.name}</span>
        <span className="mt-0.5 block text-[0.8125rem] leading-snug text-zinc-600 dark:text-zinc-400">{p.line}</span>
      </span>
    </>
  );
  const cls = cx("flex items-start gap-3 rounded-xl p-2.5 transition-colors duration-quick hover:bg-zinc-900/[0.04] dark:hover:bg-white/5", focusRing);
  return external ? (
    <a href={p.href} className={cls} onClick={onPick}>
      {body}
    </a>
  ) : (
    <Link to={p.href} className={cls} onClick={onPick}>
      {body}
    </Link>
  );
}

/** Desktop: "Products" opens a panel of all eight, grouped the way people use them. Escape or a click outside closes it. */
function ProductsMenu() {
  const [open, setOpen] = useState(false);
  const india = useIndia();
  const { pathname, hash } = useLocation();
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => setOpen(false), [pathname, hash]);
  // The shared menus' behaviour (@orbit/ui Menu): a click outside or Escape closes it, Escape returns focus.
  useDismiss(open, close, root, button);

  const products = siteProducts(india);
  const main = products.filter((p) => p.main);
  const more = products.filter((p) => !p.main);
  return (
    // Tabbing out of the menu closes it too (a click on the panel's own empty space blurs with no relatedTarget and
    // must leave it open).
    <div ref={root} className="relative" onBlur={(e) => e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node) && setOpen(false)}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "inline-flex min-h-10 items-center gap-1 rounded-lg px-3 font-medium text-zinc-600 transition-colors duration-quick hover:bg-zinc-900/[0.04] hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white",
          open && "bg-zinc-900/[0.04] text-zinc-950 dark:bg-white/5 dark:text-white",
          focusRing,
        )}
      >
        Products
        <ChevronDown className={cx("h-4 w-4 transition-transform duration-quick", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div
          id={id}
          className={cx(floatingClass("popover"), "mk-popover absolute left-0 top-full mt-2 w-[min(24rem,calc(100vw-2rem))] max-h-[calc(100dvh-5rem)] overflow-y-auto rounded-2xl p-3 lg:w-[46rem]")}
        >
          <div className="grid gap-x-4 gap-y-1 lg:grid-cols-2">
            <div>
              <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Interview, prepare, apply</p>
              <ul>
                {main.map((p) => (
                  <li key={p.id}>
                    <ProductItem p={p} onPick={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="px-2.5 pb-1 pt-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">More in your account</p>
              <ul>
                {more.map((p) => (
                  <li key={p.id}>
                    <ProductItem p={p} onPick={() => setOpen(false)} />
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-2 grid gap-x-6 gap-y-2 rounded-xl mk-band px-3.5 py-3 text-sm lg:grid-cols-2">
            <p className="text-zinc-600 dark:text-zinc-300">
              Interview guides:{" "}
              <Link to={SITE_LINKS.companies} onClick={() => setOpen(false)} className={cx("rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                by company
              </Link>{" "}
              and{" "}
              <Link to={SITE_LINKS.roles} onClick={() => setOpen(false)} className={cx("rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                by role
              </Link>
              , free to read.
            </p>
            <Link to={SITE_LINKS.warmup} onClick={() => setOpen(false)} className={cx("inline-flex items-center gap-1 rounded font-medium text-indigo-700 hover:underline lg:justify-self-end dark:text-indigo-300", focusRing)}>
              Try a practice question, free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** Phones and small tablets: the menu button, and the site as one full-screen sheet (focus stays inside; Escape closes). */
export function MobileMenu({ authState, className }: { authState?: { from: string }; className?: string }) {
  const [open, setOpen] = useState(false);
  const { pathname, hash } = useLocation();
  const { user } = useAuth();
  const india = useIndia();
  useEffect(() => setOpen(false), [pathname, hash]);
  // The page behind doesn't scroll while the sheet is open, and stays where it was (lockScroll holds <html>; hiding
  // body's overflow made the page jump).
  useEffect(() => {
    if (!open) return;
    return lockScroll();
  }, [open]);
  const trap = useFocusTrap<HTMLDivElement>(open, { onEscape: () => setOpen(false) });
  const close = () => setOpen(false);
  const link = cx("flex min-h-11 items-center rounded-xl px-3 text-[0.9375rem] font-medium text-zinc-800 hover:bg-zinc-900/[0.04] dark:text-zinc-100 dark:hover:bg-white/5", focusRing);

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cx("grid h-10 w-10 place-items-center rounded-lg text-zinc-700 hover:bg-zinc-900/[0.04] md:hidden dark:text-zinc-200 dark:hover:bg-white/10", focusRing, className)}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div ref={trap} role="dialog" aria-modal="true" aria-label="Site menu" className="mk-drawer fixed inset-0 z-50 flex flex-col mk-canvas md:hidden">
            <div className="flex h-16 shrink-0 items-center justify-between border-b mk-line px-5">
              <Link to="/" onClick={close} className={cx("-ml-1 rounded-lg p-1", focusRing)} aria-label="Orbit home">
                <BrandLogo height={26} decorative />
              </Link>
              <button type="button" onClick={close} aria-label="Close menu" className={cx("grid h-10 w-10 place-items-center rounded-lg text-zinc-700 hover:bg-zinc-900/[0.04] dark:text-zinc-200 dark:hover:bg-white/10", focusRing)}>
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <nav aria-label="Site" className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-3">
              <p className="px-3 pb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">Products</p>
              <ul className="grid gap-0.5">
                {siteProducts(india).map((p) => (
                  <li key={p.id}>
                    <ProductItem p={p} onPick={close} compact />
                  </li>
                ))}
              </ul>
              <div className="my-3 border-t mk-line" />
              <ul className="grid gap-0.5">
                {[
                  [SITE_LINKS.warmup, "Free practice question"],
                  [SITE_LINKS.companies, "Interview guides by company"],
                  [SITE_LINKS.roles, "Interview guides by role"],
                  [SITE_LINKS.pricing, "Pricing"],
                  [SITE_LINKS.security, "Security and privacy"],
                  [SITE_LINKS.howItWorks, "How Orbit works"],
                  ["/contact", "Contact"],
                ].map(([to, label]) => (
                  <li key={to}>
                    <Link to={to!} onClick={close} className={link}>
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="grid shrink-0 grid-cols-2 gap-2 border-t mk-line p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {user ? (
                <Link to="/" onClick={close} className={buttonClass("primary", "lg", "col-span-2 min-h-11")}>
                  Open Orbit
                </Link>
              ) : (
                <>
                  <Link to="/login" state={authState} onClick={close} className={buttonClass("secondary", "lg", "min-h-11")}>
                    Sign in
                  </Link>
                  <Link to="/register" state={authState} onClick={close} className={buttonClass("primary", "lg", "min-h-11")}>
                    Start free
                  </Link>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
