import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { MonthlyPlan, PlanInfo } from "@orbit/types";
import { Building2, Check, CircleCheck, Minus, Sparkles, cx, focusRing } from "@orbit/ui";
import { api } from "../lib/api";
import { contactHref } from "../lib/contactForm";
import { formatDate } from "../lib/format";

/**
 * The pricing tiers, laid out the way SaaS pricing pages are: Free, the monthly plans (from the server:
 * billing/monthly.py), and Enterprise (talk to us), each with what it includes, then a side-by-side comparison.
 * Used on the landing page (buttons lead to sign-up) and Plan & billing (buttons buy).
 */

const TAGLINE: Record<string, string> = {
  free: "Try everything, pay only for the AI you use.",
  basic: "For an active job search: unlimited resume AI and regular practice.",
  pro: "For interview season: hours of live help and mock interviews every month.",
  unlimited: "No caps on interview minutes.",
};

function n(value: number | null, unit = ""): string {
  return value === null ? "Unlimited" : `${value.toLocaleString("en-IN")}${unit}`;
}

function rupees(v: number): string {
  return `₹${v.toLocaleString("en-IN")}`;
}

/** The Free plan's limits, as the server has them. */
function useFreePlan(): PlanInfo | null {
  const [free, setFree] = useState<PlanInfo | null>(null);
  useEffect(() => {
    api
      .listPlans()
      .then((plans) => setFree(plans.find((p) => p.name === "free") ?? null))
      .catch(() => undefined);
  }, []);
  return free;
}

function Feature({ children, off = false }: { children: ReactNode; off?: boolean }) {
  return (
    <li className={cx("flex items-start gap-2", off && "text-zinc-400 dark:text-zinc-500")}>
      {off ? (
        <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      )}
      <span>{children}</span>
    </li>
  );
}

type Cta = { label: string; to?: string; from?: string; onClick?: () => void; disabled?: boolean; primary?: boolean };

function CtaButton({ cta }: { cta: Cta }) {
  const cls = cx(
    "mt-6 inline-flex w-full items-center justify-center rounded-xl px-4 py-2.5 text-sm font-semibold transition",
    cta.primary
      ? "bg-indigo-600 text-white shadow-sm hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-400"
      : "bg-zinc-900/5 text-zinc-900 ring-1 ring-zinc-900/10 hover:bg-zinc-900/10 dark:bg-white/5 dark:text-white dark:ring-white/10 dark:hover:bg-white/10",
    cta.disabled && "pointer-events-none opacity-50",
    focusRing,
  );
  if (cta.to) return <Link to={cta.to} state={cta.from ? { from: cta.from } : undefined} className={cls}>{cta.label}</Link>;
  return (
    <button type="button" className={cls} onClick={cta.onClick} disabled={cta.disabled}>
      {cta.label}
    </button>
  );
}

function Tier({ name, price, per, tagline, badge, highlight, cta, note, children }: {
  name: string; price: string; per?: string; tagline: string; badge?: string; highlight?: boolean; cta: Cta;
  note?: ReactNode; children: ReactNode;
}) {
  return (
    <li
      className={cx(
        "relative flex flex-col rounded-2xl bg-white p-6 ring-1 dark:bg-zinc-900/60",
        highlight ? "ring-2 ring-indigo-500 shadow-xl shadow-indigo-500/10 dark:ring-indigo-400" : "ring-zinc-900/10 dark:ring-white/10",
      )}
    >
      {badge && (
        <span className="absolute -top-3 left-6 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white dark:bg-indigo-500">
          {badge}
        </span>
      )}
      <h3 className="font-display text-lg font-semibold">{name}</h3>
      <p className="mt-1 min-h-[2.5rem] text-sm text-zinc-600 dark:text-zinc-400">{tagline}</p>
      <p className="mt-4 flex items-baseline gap-1">
        <span className="font-display text-4xl font-semibold tracking-tight tabular-nums">{price}</span>
        {per && <span className="text-sm font-medium text-zinc-500">{per}</span>}
      </p>
      <CtaButton cta={cta} />
      {note && <p className="mt-2 text-center text-xs text-zinc-500">{note}</p>}
      <ul className="mt-6 space-y-2.5 border-t border-zinc-900/5 pt-6 text-sm text-zinc-700 dark:border-white/5 dark:text-zinc-300">{children}</ul>
    </li>
  );
}

export interface PricingTiersProps {
  monthly: MonthlyPlan[] | null;
  welcome?: { resume_credits: number; interview_minutes: number } | null;
  /** Signed in: the account's plan and when a paid month ends; the buttons buy. Signed out: they lead to sign-up. */
  current?: { plan: string; until: string | null } | null;
  onBuy?: (m: MonthlyPlan) => void;
  busy?: boolean;
}

export function PricingTiers({ monthly, welcome, current, onBuy, busy = false }: PricingTiersProps) {
  const plans = [...(monthly ?? [])].sort((a, b) => a.price_inr - b.price_inr);
  const popular = plans.length >= 2 ? plans[plans.length - 1]!.id : undefined;
  const signedIn = Boolean(onBuy);
  const onFree = signedIn && (!current || !plans.some((m) => m.plan === current.plan));

  return (
    <ul className={cx("grid gap-5 sm:grid-cols-2", plans.length >= 2 ? "xl:grid-cols-4" : "xl:grid-cols-3")}>
      <Tier
        name="Free"
        price="₹0"
        per="forever"
        tagline={TAGLINE.free!}
        cta={signedIn ? { label: onFree ? "Your current plan" : "Included", disabled: true } : { label: "Start free", to: "/register" }}
      >
        {welcome?.interview_minutes ? <Feature>{welcome.interview_minutes} interview minutes to start</Feature> : null}
        {welcome?.resume_credits ? <Feature>{welcome.resume_credits} Resume AI credit{welcome.resume_credits === 1 ? "" : "s"} to start</Feature> : null}
        <Feature>Resume editor, ATS score, PDF and Word downloads</Feature>
        <Feature>Job matches, AI fit checks and the tracker</Feature>
        <Feature>More AI and minutes with credit packs, whenever you need them</Feature>
        <Feature off>Unlimited Resume AI</Feature>
      </Tier>
      {plans.map((m) => {
        const mine = current?.plan === m.plan && Boolean(current?.until);
        const cta: Cta = signedIn
          ? { label: mine ? `Add ${m.days} days · ${rupees(m.price_inr)}` : `Get ${m.label}`, onClick: () => onBuy?.(m), disabled: busy || !m.buyable, primary: m.id === popular || mine }
          : { label: `Get ${m.label}`, to: "/register", from: `/billing?pack=${m.id}`, primary: m.id === popular };
        return (
          <Tier
            key={m.id}
            name={m.label}
            price={rupees(m.price_inr)}
            per={m.days === 30 ? "/ month" : `/ ${m.days} days`}
            tagline={TAGLINE[m.plan] ?? ""}
            badge={mine ? "Your plan" : m.id === popular ? "Most popular" : undefined}
            highlight={mine || (!current?.until && m.id === popular)}
            cta={cta}
            note={mine && current?.until ? `Active until ${formatDate(current.until)}` : "Billed once. Never auto-renews."}
          >
            {m.resume_ai && <Feature><strong className="font-semibold">Unlimited Resume AI</strong>: fixes, rewrites, tailoring, cover letters</Feature>}
            <Feature>{n(m.live_minutes)} live interview minutes</Feature>
            <Feature>{n(m.mock_minutes)} mock and video interview minutes</Feature>
            <Feature>{n(m.screenshots)} screenshot answers</Feature>
            <Feature>{n(m.documents)} documents</Feature>
            <Feature>Sessions up to {m.max_session_minutes} minutes</Feature>
          </Tier>
        );
      })}
      <Tier
        name="Enterprise"
        price="Custom"
        tagline="For colleges, placement cells, bootcamps and teams."
        cta={{ label: "Contact us", to: contactHref({ topic: "business", from: "/pricing" }) }}
      >
        <Feature>Access for a whole batch or team</Feature>
        <Feature>Interview minutes and limits sized to your group</Feature>
        <Feature>Unlimited Resume AI for everyone</Feature>
        <Feature>One payment for the group, arranged with us</Feature>
      </Tier>
    </ul>
  );
}

/** The side-by-side comparison under the tiers. */
export function PlanComparison({ monthly }: { monthly: MonthlyPlan[] | null }) {
  const free = useFreePlan();
  const plans = [...(monthly ?? [])].sort((a, b) => a.price_inr - b.price_inr);
  if (!plans.length) return null;
  const yes = <Check className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="Included" />;
  const rows: Array<[string, ReactNode, ...ReactNode[]]> = [
    ["Price", "₹0", ...plans.map((m) => `${rupees(m.price_inr)} / month`), "Custom"],
    ["Resume editor, ATS score, downloads", yes, ...plans.map(() => yes), yes],
    ["Job matches, fit checks, tracker", yes, ...plans.map(() => yes), yes],
    ["Resume AI", "1 credit per action (a fix: 1/5)", ...plans.map((m) => (m.resume_ai ? "Unlimited" : "Credits")), "Unlimited"],
    ["Live interview minutes", "From credits", ...plans.map((m) => `${n(m.live_minutes)} / month`), "Custom"],
    ["Mock and video interview minutes", "From credits", ...plans.map((m) => `${n(m.mock_minutes)} / month`), "Custom"],
    ["Screenshot answers", free ? `${n(free.screenshots)} / month` : "Limited", ...plans.map((m) => `${n(m.screenshots)} / month`), "Custom"],
    ["Documents", free ? n(free.documents) : "Limited", ...plans.map((m) => n(m.documents)), "Custom"],
    ["Longest session", free ? `${free.max_session_minutes} min` : "—", ...plans.map((m) => `${m.max_session_minutes} min`), "Custom"],
    ["Renewal", "—", ...plans.map(() => "Never automatic"), "Arranged with us"],
  ];
  return (
    <div className="mt-10 overflow-x-auto rounded-2xl ring-1 ring-zinc-900/10 dark:ring-white/10">
      <table className="w-full min-w-[40rem] text-sm">
        <caption className="sr-only">Compare plans</caption>
        <thead className="bg-zinc-50 text-left dark:bg-white/[0.03]">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">Compare plans</th>
            <th scope="col" className="px-4 py-3 text-center font-semibold">Free</th>
            {plans.map((m) => (
              <th key={m.id} scope="col" className="px-4 py-3 text-center font-semibold">
                <span className="inline-flex items-center gap-1">{m.label}{m === plans[plans.length - 1] && plans.length > 1 && <Sparkles className="h-3.5 w-3.5 text-indigo-500" aria-hidden />}</span>
              </th>
            ))}
            <th scope="col" className="px-4 py-3 text-center font-semibold">
              <span className="inline-flex items-center gap-1"><Building2 className="h-3.5 w-3.5" aria-hidden /> Enterprise</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-900/5 dark:divide-white/5">
          {rows.map(([label, ...cells]) => (
            <tr key={label}>
              <th scope="row" className="px-4 py-3 text-left font-normal text-zinc-700 dark:text-zinc-300">{label}</th>
              {cells.map((c, i) => (
                <td key={i} className="px-4 py-3 text-center tabular-nums text-zinc-700 dark:text-zinc-300">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
