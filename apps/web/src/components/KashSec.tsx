import { useId, useState } from "react";
import { ArrowUpRight, IconButton, KashSecScene, ShieldCheck, X, buttonClass, cx, focusRing, safeLocal } from "@orbit/ui";
import { kashsecUrl, type KashSecPlacement } from "../pages/learn/links";

/**
 * KashSec Academy, the Orbit team's free cybersecurity school (its own site), promoted the same way everywhere
 * (DECISIONS D70): what it really has, in its own words, and a link that opens it in a new tab with where it was
 * found (`kashsecUrl`). Never more than one KashSec card in a view. Its colour is teal, its own brand's.
 */

/** What KashSec has, as its own navigation names it; claim nothing else (no counts, no ratings). */
export const KASHSEC_FEATURES = ["Course paths", "Hands-on labs", "Interview bank", "Timed mock exam"] as const;
export const KASHSEC_TAGLINE = "Free cybersecurity education for complete beginners. Start from zero, learn by doing, and reach a real career.";

const newTab = <span className="sr-only">(opens KashSec in a new tab)</span>;

function Mark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-teal-700 ring-1 ring-inset ring-teal-600/25 dark:bg-zinc-900 dark:text-teal-300 dark:ring-teal-400/25",
        className,
      )}
    >
      <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
    </span>
  );
}

/** The features as chips, each with a teal dot. */
export function KashSecChips({ className }: { className?: string }) {
  return (
    <ul className={cx("flex flex-wrap gap-2", className)} aria-label="On KashSec Academy">
      {KASHSEC_FEATURES.map((f) => (
        <li
          key={f}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-200"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal-500 dark:bg-teal-400" />
          {f}
        </li>
      ))}
    </ul>
  );
}

/**
 * The feature card: KashSec's scene, its tagline, what it has and "Start learning free". Learning AI's band and the
 * dev gallery; the front page builds its own section from the same parts.
 */
export function KashSecFeature({ placement, className }: { placement: KashSecPlacement; className?: string }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cx(
        "scene-host relative overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 sm:p-7 dark:border-white/10 dark:bg-white/[0.03]",
        className,
      )}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 bg-teal-500/70 dark:bg-teal-400/60" />
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-teal-700 dark:text-teal-300">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Free from the Orbit team
          </p>
          <h2 id={id} className="mt-2 font-display text-xl font-semibold text-zinc-950 dark:text-white">
            KashSec Academy
          </h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-300">{KASHSEC_TAGLINE}</p>
          <KashSecChips className="mt-4" />
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <a href={kashsecUrl(placement)} target="_blank" rel="noopener" className={buttonClass("secondary")}>
              Start learning free <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              {newTab}
            </a>
            <span className="text-xs text-zinc-600 dark:text-zinc-400">Free forever · Learn · Practise · Get hired</span>
          </div>
        </div>
        <KashSecScene className="mx-auto hidden w-60 md:block" />
      </div>
    </section>
  );
}

/** "Preparing for a security role?": where the role, a tracked job or a guide is in cybersecurity (lib/security.ts). */
export function KashSecContext({ placement, className }: { placement: KashSecPlacement; className?: string }) {
  return (
    <aside
      aria-label="KashSec Academy"
      className={cx(
        "flex items-start gap-3 rounded-2xl border border-teal-600/20 bg-teal-500/[0.04] p-4 dark:border-teal-400/20 dark:bg-teal-400/[0.05]",
        className,
      )}
    >
      <Mark />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-zinc-950 dark:text-white">Preparing for a security role?</p>
        <p className="mt-0.5 text-zinc-600 dark:text-zinc-300">KashSec&rsquo;s interview bank, hands-on labs and timed mock exam are free.</p>
        <a
          href={kashsecUrl(placement)}
          target="_blank"
          rel="noopener"
          className={cx("mt-1.5 inline-flex min-h-8 items-center gap-1 rounded font-medium text-teal-700 hover:underline dark:text-teal-300", focusRing)}
        >
          Open KashSec Academy <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          {newTab}
        </a>
      </div>
    </aside>
  );
}

const HIDDEN_KEY = "orbit.kashsec.home.hidden";

/** Home's "More from us": KashSec, until it's hidden on this device. */
export function KashSecHomeCard({ className }: { className?: string }) {
  const [hidden, setHidden] = useState(() => safeLocal.getItem(HIDDEN_KEY) === "1");
  if (hidden) return null;
  const hide = () => {
    safeLocal.setItem(HIDDEN_KEY, "1");
    setHidden(true);
  };
  return (
    <aside aria-label="More from us" className={cx("relative flex items-start gap-4 rounded-2xl border border-zinc-200 bg-white p-4 pr-12 dark:border-white/10 dark:bg-white/[0.03]", className)}>
      <Mark />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">More from us</p>
        <p className="mt-0.5 font-semibold text-zinc-950 dark:text-white">KashSec Academy: free cybersecurity, from zero</p>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-300">Course paths, hands-on labs, an interview bank and a timed mock exam. Free forever.</p>
        <a
          href={kashsecUrl("home")}
          target="_blank"
          rel="noopener"
          className={cx("mt-1.5 inline-flex min-h-8 items-center gap-1 rounded text-sm font-medium text-teal-700 hover:underline dark:text-teal-300", focusRing)}
        >
          Start learning free <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          {newTab}
        </a>
      </div>
      <IconButton label="Hide KashSec from Home" icon={X} size="sm" onClick={hide} className="absolute right-2 top-2" />
    </aside>
  );
}
