import { useRef, type PointerEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, OrbitWordmark, cx, focusRing, useMotion } from "@orbit/ui";
import { Footer } from "../components/Footer";
import { SiteMenu } from "../components/SiteMenu";
import { recoveryFor } from "../lib/notFound";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const link = cx(
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 hover:border-zinc-300 dark:border-white/10 dark:bg-white/5 dark:text-zinc-100",
  focusRing,
);
const primary = cx(
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-500",
  focusRing,
);

/**
 * An address that isn't a page. When the address says where it was heading (/practice/..., /jobs/...), the first
 * button goes there; the probe above the heading leans toward the cursor while it searches.
 */
export function NotFoundPage() {
  useDocumentTitle("Page not found", "That address isn't a page on Orbit. Go home, or open Resume AI, Jobs AI, or contact.");
  const { pathname } = useLocation();
  const recovery = recoveryFor(pathname);
  const probe = useRef<SVGGElement>(null);
  const still = useMotion() !== "full";

  // The probe drifts a few pixels toward the pointer: a transform written straight to the element, no re-render.
  const follow = (e: PointerEvent<HTMLElement>) => {
    if (still || e.pointerType === "touch" || !probe.current) return;
    const box = e.currentTarget.getBoundingClientRect();
    const dx = ((e.clientX - box.left) / box.width - 0.5) * 24;
    const dy = ((e.clientY - box.top) / box.height - 0.5) * 16;
    probe.current.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
  };

  return (
    <div className="flex min-h-full flex-col overflow-x-clip">
      <header className="relative border-b border-zinc-200/70 bg-white dark:border-white/5 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className={cx("shrink-0 rounded-lg", focusRing)} aria-label="Orbit home">
            <OrbitWordmark size={26} />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <SiteMenu />
            <Link to="/register" className={cx(link, "border-transparent bg-indigo-600 text-white hover:bg-indigo-500")}>
              Start free
            </Link>
          </div>
        </div>
      </header>
      <main id="main" onPointerMove={follow} className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-16">
        <svg viewBox="0 0 220 120" className="mb-4 h-28 w-auto self-start overflow-visible" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id="nf-planet" cx="35%" cy="35%">
              <stop offset="0" stopColor="#a5b4fc" />
              <stop offset="1" stopColor="#4f46e5" />
            </radialGradient>
          </defs>
          <ellipse cx="70" cy="70" rx="62" ry="18" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeDasharray="3 6" className="text-zinc-500" />
          <circle cx="70" cy="70" r="24" fill="url(#nf-planet)" />
          <g ref={probe} style={{ transition: "transform 240ms cubic-bezier(0.22, 1, 0.36, 1)" }}>
            <g className="cosmic-float">
              <line x1="150" y1="44" x2="132" y2="58" stroke="#38bdf8" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 4" className="cosmic-link" />
              <rect x="150" y="30" width="22" height="16" rx="3" fill="#0ea5e9" />
              <rect x="134" y="35" width="14" height="6" rx="1.5" fill="#7dd3fc" />
              <rect x="174" y="35" width="14" height="6" rx="1.5" fill="#7dd3fc" />
              <circle className="cosmic-blink" cx="161" cy="26" r="2.5" fill="#34d399" />
            </g>
          </g>
          <path className="cosmic-blink" d="M200 90 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z" fill="#818cf8" />
        </svg>
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-300">404</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">This page isn't here</h1>
        <p className="mt-2 text-base text-zinc-600 dark:text-zinc-300">
          {recovery ? "That link is old or mistyped, but it looks like you were heading here:" : "The link may be old, or the address was typed wrong."}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {recovery && (
            <Link to={recovery.to} className={primary}>
              {recovery.label} <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
          <Link to="/" className={link}>Go home</Link>
          {recovery?.to !== "/resume-ai" && <Link to="/resume-ai" className={link}>Resume AI</Link>}
          {recovery?.to !== "/jobs/matches" && <Link to="/jobs" className={link}>Jobs AI</Link>}
          {recovery?.to !== "/contact" && <Link to="/contact" className={link}>Contact</Link>}
        </div>
      </main>
      <Footer />
    </div>
  );
}
