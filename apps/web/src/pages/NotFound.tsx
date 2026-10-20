import { useRef, type PointerEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, buttonClass, useMotion } from "@orbit/ui";
import { PublicLayout } from "../marketing/PublicLayout";
import { recoveryFor } from "../lib/notFound";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const link = buttonClass("secondary", "md", "min-h-11 px-4");
const primary = buttonClass("primary", "md", "min-h-11 px-4");

/**
 * An address that isn't a page. When the address says where it was heading (/practice/..., /jobs/...), the first
 * button goes there; the probe above the heading leans toward the cursor while it searches.
 */
export function NotFoundPage() {
  useDocumentTitle("Page not found", "That address isn't a page on Orbit. Go home, or open Resume, Jobs, or contact.");
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
    <PublicLayout>
      <div onPointerMove={follow} className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center px-5 py-20 sm:px-8">
        <svg viewBox="0 0 220 120" className="mb-4 h-28 w-auto self-start overflow-visible" aria-hidden="true" focusable="false">
          <ellipse cx="70" cy="70" rx="62" ry="18" fill="none" stroke="rgb(var(--site-line-strong))" strokeWidth="1" strokeDasharray="3 5" />
          <circle cx="70" cy="70" r="24" fill="rgb(var(--site-surface))" stroke="rgb(var(--site-line-strong))" strokeWidth="1" />
          <path d="M52 62 a24 24 0 0 1 36 -6" fill="none" stroke="rgb(var(--accent-500))" strokeWidth="1.5" strokeLinecap="round" />
          <g ref={probe} style={{ transition: "transform var(--dur-panel) var(--ease-standard)" }}>
            <g className="cosmic-float">
              <line x1="150" y1="44" x2="132" y2="58" stroke="rgb(var(--accent-500))" strokeOpacity="0.5" strokeWidth="1" strokeDasharray="2 3" />
              <rect x="150" y="30" width="22" height="16" rx="3" fill="rgb(var(--site-surface))" stroke="rgb(var(--accent-600))" strokeWidth="1.25" />
              <rect x="134" y="35" width="14" height="6" rx="1.5" fill="rgb(var(--accent-500) / 0.18)" stroke="rgb(var(--accent-600))" strokeWidth="1" />
              <rect x="174" y="35" width="14" height="6" rx="1.5" fill="rgb(var(--accent-500) / 0.18)" stroke="rgb(var(--accent-600))" strokeWidth="1" />
              <circle cx="161" cy="26" r="2.25" fill="rgb(var(--accent-600))" />
            </g>
          </g>
          <path d="M200 90 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5z" fill="rgb(var(--accent-400))" />
        </svg>
        <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">404</p>
        <h1 className="mk-h2 mt-3 text-zinc-950 dark:text-white">This page isn't here</h1>
        <p className="mk-lead mt-4 text-zinc-600 dark:text-zinc-300">
          {recovery ? "That link is old or mistyped, but it looks like you were heading here:" : "The link may be old, or the address was typed wrong."}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {recovery && (
            <Link to={recovery.to} className={primary}>
              {recovery.label} <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          )}
          <Link to="/" className={link}>Go home</Link>
          {recovery?.to !== "/resume-ai" && <Link to="/resume-ai" className={link}>Resume</Link>}
          {recovery?.to !== "/jobs/matches" && <Link to="/jobs" className={link}>Jobs</Link>}
          {recovery?.to !== "/contact" && <Link to="/contact" className={link}>Contact</Link>}
        </div>
      </div>
    </PublicLayout>
  );
}
