import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, BadgeIndianRupee, Banknote, MessagesSquare, GraduationCap, IdCard, ShieldCheck, cx, focusRing, type LucideIcon } from "@orbit/ui";
import { useIndia } from "../lib/country";
import { KASHSEC_URL, LEARN_HOME } from "../pages/learn/links";
import { LINKEDIN_HOME } from "../pages/linkedin/model";
import { OFFERS_HOME } from "../pages/offers/model";
import { AiPill } from "./products";

type Tool = { to: string; name: string; icon: LucideIcon; line: string };

/** Orbit's newer tools, as the sign-in screens and the front page show them (in India; moreTools words them for elsewhere). */
export const MORE_TOOLS: Tool[] = [
  { to: LINKEDIN_HOME, name: "LinkedIn", icon: IdCard, line: "Score your LinkedIn profile against the role you want, and fix what recruiters search for." },
  { to: OFFERS_HOME, name: "Offer", icon: BadgeIndianRupee, line: "What an offer pays each month, how it compares with the market, and a plan to ask for more." },
  { to: LEARN_HOME, name: "Learning", icon: GraduationCap, line: "Coding-round practice with an AI interviewer's review, and free cybersecurity lessons." },
];

/** The tools for where the visitor applies: outside India, Offer AI's take-home is rupee-only, so it promises the first
 *  year's value, and its mark isn't the rupee. */
function useMoreTools(): Tool[] {
  const india = useIndia();
  if (india) return MORE_TOOLS;
  return MORE_TOOLS.map((t) =>
    t.to === OFFERS_HOME
      ? { ...t, icon: Banknote, line: "What an offer is worth in its first year, how it compares with the market, and a plan to ask for more." }
      : t,
  );
}

/** The tools as one line of chips: for the sign-in panel, where space is short. */
export function MoreToolChips({ dark = false, practice = false }: { dark?: boolean; practice?: boolean }) {
  const more = useMoreTools();
  const tools = practice ? [{ name: "Practice", icon: MessagesSquare }, ...more] : more;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Also in Orbit">
      {tools.map(({ name, icon: Icon }) => (
        <li key={name} className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", dark ? "bg-white/[0.06] text-white ring-1 ring-white/10" : "bg-indigo-500/10 text-indigo-800 dark:text-indigo-200")}>
          <Icon className="h-3.5 w-3.5" aria-hidden /> {name}
        </li>
      ))}
    </ul>
  );
}

/**
 * KashSec, free cybersecurity and AI lessons (its own site). `tone` "dark" for the sign-in panel; "card" elsewhere.
 */
export function KashSecPromo({ tone = "card", className }: { tone?: "dark" | "card"; className?: string }) {
  const dark = tone === "dark";
  return (
    <a
      href={KASHSEC_URL}
      target="_blank"
      rel="noopener"
      className={cx(
        "group flex items-center gap-3 rounded-2xl",
        dark ? "p-2.5 bg-emerald-400/10 ring-1 ring-emerald-300/20 hover:bg-emerald-400/15" : "orbit-card lift p-4",
        focusRing,
        className,
      )}
    >
      <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", dark ? "bg-emerald-400/15 text-emerald-200" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300")}>
        <ShieldCheck className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx("flex flex-wrap items-center gap-1.5 text-sm font-semibold", dark ? "text-white" : "")}>
          {dark ? "Learn cybersecurity and AI for free on KashSec" : "Learn cybersecurity for free"}
          <span className={cx("rounded-full px-1.5 py-px text-[0.625rem] font-bold uppercase tracking-wide", dark ? "bg-emerald-300/20 text-emerald-100" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>Free</span>
        </span>
        {!dark && <span className="block text-xs text-zinc-600 dark:text-zinc-400">KashSec: cybersecurity and AI lessons, free for everyone.</span>}
      </span>
      <ArrowUpRight className={cx("h-4 w-4 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5", dark ? "text-emerald-200" : "text-emerald-600 dark:text-emerald-300")} aria-hidden />
      <span className="sr-only">(opens KashSec in a new tab)</span>
    </a>
  );
}

/** The newer tools as cards with a line each (the front page). */
export function MoreToolCards() {
  const tools = useMoreTools();
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
      {tools.map(({ to, name, icon: Icon, line }) => (
        <li key={name} className="min-w-0">
          <Link to={to} className={cx("orbit-card lift flex h-full flex-col rounded-2xl p-5", focusRing)}>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <span className="mt-3 flex items-center gap-1 font-display text-lg font-semibold">{name} <AiPill /></span>
            <span className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{line}</span>
            <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-medium text-indigo-700 dark:text-indigo-300">
              Open {name} AI <ArrowRight className="h-4 w-4" aria-hidden />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
