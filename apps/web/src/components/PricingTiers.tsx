import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CreditPack, MonthlyPlan, PlanInfo } from "@orbit/types";
import { Building2, Check, CircleCheck, Minus, Sparkles, buttonClass, cx, focusRing } from "@orbit/ui";
import { api } from "../lib/api";
import { contactHref } from "../lib/contactForm";
import { useIndia } from "../lib/country";
import { formatDate } from "../lib/format";

/**
 * The pricing tiers, laid out the way SaaS pricing pages are: Free, the monthly plans (from the server:
 * billing/monthly.py), and Enterprise (talk to us), each with what it includes, then a side-by-side comparison.
 * Used on the landing page (buttons lead to sign-up) and Plan & billing (buttons buy).
 */

const FREE_TAGLINE = "Try everything, pay only for the AI you use.";

/** A plan's line under its name, by length. */
function tagline(m: MonthlyPlan): string {
  if (m.days >= 360) return "Your whole job search, at the lowest price a month.";
  if (m.days >= 85) return "Three months of interview season, paid once.";
  if (m.days <= 7) return "A week of interviews: for a hiring sprint.";
  return "Full access for a month of interviews.";
}

/** "/ month", "/ 3 months", "/ year". */
export function periodLabel(days: number): string {
  if (days === 7) return "/ week";
  if (days === 30) return "/ month";
  if (days === 365) return "/ year";
  if (days % 30 === 0) return `/ ${days / 30} months`;
  return `/ ${days} days`;
}

/** How long an allowance lasts, after "50 hours of live interview help": " a month", or for a plan shorter than a
 * month its own days (it has the whole allowance for them, DECISIONS D57). */
export function allowanceSpan(days: number): string {
  if (days >= 30) return " a month";
  return days === 7 ? ", to use in the week" : `, to use in the ${days} days`;
}

function n(value: number | null, unit = ""): string {
  return value === null ? "Unlimited" : `${value.toLocaleString("en-IN")}${unit}`;
}

/** Interview time as people say it: "50 hours" from 3000 minutes, "90 minutes" otherwise. */
function time(minutes: number | null): string {
  if (minutes === null) return "Unlimited";
  return minutes >= 120 && minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} minutes`;
}

/** An amount in the buyer's currency: "₹3,599" or "$53.99". */
function money(v: number, currency: string = "INR"): string {
  if (currency === "USD") return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return rupees(v);
}

/** A pack's or plan's price as the server wrote it for this buyer (rupees from older servers). */
function priceOf(p: { price_text?: string; price_inr: number }): string {
  return p.price_text ?? rupees(p.price_inr);
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
    <li className={cx("flex items-start gap-2", off && "text-zinc-400")}>
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
      ? "bg-indigo-600 text-white hover:bg-indigo-700"
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
        highlight ? "ring-2 ring-indigo-500 dark:ring-indigo-400" : "ring-zinc-900/10 dark:ring-white/10",
      )}
    >
      {badge && (
        <span className="absolute -top-3 left-6 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white">
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

/** "₹0" or "$0" for the Free tier: the plans' currency once they're here, the visitor's country until then. */
function useZero(plans: MonthlyPlan[]): string {
  const india = useIndia();
  const currency = plans[0]?.currency ?? (india ? "INR" : "USD");
  return currency === "USD" ? "$0" : "₹0";
}

export function PricingTiers({ monthly, welcome, current, onBuy, busy = false }: PricingTiersProps) {
  const plans = [...(monthly ?? [])].sort((a, b) => a.price_inr - b.price_inr);
  const zero = useZero(plans);
  const india = useIndia();
  // The server's badge ("Most popular") picks the highlighted plan; without one, the dearest of two or more.
  const popular = plans.find((m) => m.badge === "Most popular")?.id ?? (plans.length >= 2 ? plans[plans.length - 1]!.id : undefined);
  const signedIn = Boolean(onBuy);
  const onFree = signedIn && (!current || !plans.some((m) => m.plan === current.plan));

  return (
    <ul className={cx("grid gap-5 sm:grid-cols-2", plans.length >= 3 ? "xl:grid-cols-4" : plans.length === 2 ? "xl:grid-cols-3" : "xl:grid-cols-2")}>
      <Tier
        name="Free"
        price={zero}
        per="forever"
        tagline={FREE_TAGLINE}
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
        const span = allowanceSpan(m.days);
        const cta: Cta = signedIn
          ? { label: mine ? `Extend · ${priceOf(m)}` : `Get ${m.label}`, onClick: () => onBuy?.(m), disabled: busy || !m.buyable, primary: m.id === popular || mine }
          : { label: `Get ${m.label}`, to: "/register", from: `/billing?pack=${m.id}`, primary: m.id === popular };
        return (
          <Tier
            key={m.id}
            name={m.label}
            price={priceOf(m)}
            per={periodLabel(m.days)}
            tagline={tagline(m)}
            badge={m.badge ?? undefined}
            highlight={m.id === popular}
            cta={cta}
            note={
              mine && current?.until
                ? `Your plan is active until ${formatDate(current.until)}`
                : m.days > 30 && (m.per_month_text || m.per_month_inr)
                  ? `${m.per_month_text ?? rupees(m.per_month_inr!)} a month, billed once. Never auto-renews.`
                  : "Billed once. Never auto-renews."
            }
          >
            {m.resume_ai && <Feature><strong className="font-semibold">Unlimited Resume AI</strong>: fixes, rewrites, tailoring, cover letters</Feature>}
            <Feature>{time(m.live_minutes)} of live interview help{span}</Feature>
            <Feature>{time(m.mock_minutes)} of mock and video interviews{span}</Feature>
            <Feature>{n(m.screenshots)} screenshot answers</Feature>
            <Feature>{n(m.documents)} documents</Feature>
            <Feature>Sessions up to {m.max_session_minutes} minutes</Feature>
          </Tier>
        );
      })}
      <li className="flex flex-col gap-4 rounded-2xl bg-white p-6 ring-1 ring-zinc-900/10 sm:col-span-2 md:flex-row md:items-center xl:col-span-full dark:bg-zinc-900/60 dark:ring-white/10">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10" aria-hidden="true">
          <Building2 className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold">Enterprise</h3>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
            {india
              ? "For colleges, placement cells, bootcamps and teams: access for a whole batch, interview time and limits sized to your group, unlimited Resume AI for everyone, and one payment arranged with us."
              : "For universities, career services, bootcamps and teams: access for a whole cohort, interview time and limits sized to your group, unlimited Resume AI for everyone, and one payment arranged with us."}
          </p>
        </div>
        <Link to={contactHref({ topic: "business", from: "/pricing" })}
              className={buttonClass("secondary", "md", "shrink-0")}>
          Contact us
        </Link>
      </li>
    </ul>
  );
}

/** The side-by-side comparison under the tiers. */
export function PlanComparison({ monthly }: { monthly: MonthlyPlan[] | null }) {
  const free = useFreePlan();
  const plans = [...(monthly ?? [])].sort((a, b) => a.price_inr - b.price_inr);
  const zero = useZero(plans);
  if (!plans.length) return null;
  const yes = <Check className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-label="Included" />;
  // A week's allowance is for its own days (D57), not a month's.
  const per = (m: MonthlyPlan) => (m.days < 30 ? periodLabel(m.days) : "/ month");
  const rows: Array<[string, ReactNode, ...ReactNode[]]> = [
    ["Price", zero, ...plans.map((m) => `${priceOf(m)} ${periodLabel(m.days)}`), "Custom"],
    ["Per month", zero, ...plans.map((m) => (m.days < 30 ? "—" : (m.per_month_text ?? rupees(m.per_month_inr ?? m.price_inr)))), "Custom"],
    ["Resume editor, ATS score, downloads", yes, ...plans.map(() => yes), yes],
    ["Job matches, fit checks, tracker", yes, ...plans.map(() => yes), yes],
    ["Resume AI", "1 credit per action (a fix: 1/5)", ...plans.map((m) => (m.resume_ai ? "Unlimited" : "Credits")), "Unlimited"],
    ["Live interview help", "From credits", ...plans.map((m) => `${time(m.live_minutes)} ${per(m)}`), "Custom"],
    ["Mock and video interviews", "From credits", ...plans.map((m) => `${time(m.mock_minutes)} ${per(m)}`), "Custom"],
    ["Screenshot answers", free ? `${n(free.screenshots)} / month` : "Limited", ...plans.map((m) => (m.screenshots === null ? "Unlimited" : `${n(m.screenshots)} ${per(m)}`)), "Custom"],
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
                <span className="inline-flex items-center gap-1">{m.label}{m.badge === "Most popular" && <Sparkles className="h-3.5 w-3.5 text-indigo-500" aria-hidden />}</span>
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

/** "8" from 480 minutes: interview credits are hours. */
function hours(minutes: number): number {
  return Math.round((minutes / 60) * 10) / 10;
}

/**
 * Credit packs the way interview copilots sell them: interview credits (1 credit = 1 hour, live or mock), bigger packs
 * with free credits on top and a lower price an hour, Resume AI credits included; and an AI-credits pack for Resume AI
 * alone. Signed out, the buttons lead to sign-up; signed in, they buy.
 */
export function CreditPackGrid({ packs, onBuy, busy = false }: { packs: CreditPack[] | null; onBuy?: (p: CreditPack) => void; busy?: boolean }) {
  if (!packs?.length) return null;
  const interview = packs.filter((p) => p.interview_minutes > 0).sort((a, b) => a.price_inr - b.price_inr);
  const aiOnly = packs.filter((p) => p.interview_minutes === 0);
  return (
    <div className="space-y-4">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {interview.map((p) => {
          const total = p.total_minutes ?? p.interview_minutes + (p.bonus_minutes ?? 0);
          const paid = hours(p.interview_minutes);
          const free = hours(p.bonus_minutes ?? 0);
          const cur = p.currency ?? "INR";
          const perHourValue = (p.price ?? p.price_inr) / (total / 60);
          const perHour = money(cur === "USD" ? Math.round(perHourValue * 100) / 100 : Math.round(perHourValue), cur);
          const highlight = p.badge === "Most popular";
          const cta: Cta = onBuy
            ? { label: `Buy · ${priceOf(p)}`, onClick: () => onBuy(p), disabled: busy || !p.buyable, primary: highlight }
            : { label: "Get started", to: "/register", from: `/billing?pack=${p.id}`, primary: highlight };
          return (
            <li key={p.id} className={cx("relative flex flex-col rounded-2xl bg-white p-6 ring-1 dark:bg-zinc-900/60", highlight ? "ring-2 ring-indigo-500 dark:ring-indigo-400" : "ring-zinc-900/10 dark:ring-white/10")}>
              {p.badge && (
                <span className="absolute -top-3 left-6 rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                  {p.badge}
                </span>
              )}
              <p className="flex items-baseline gap-2">
                <span className="font-display text-4xl font-semibold tabular-nums">{hours(total)}</span>
                <span className="text-sm font-medium text-zinc-500">credit{hours(total) === 1 ? "" : "s"}</span>
              </p>
              <p className="mt-1 h-5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                {free > 0 ? `${paid} credits + ${free} free` : ""}
              </p>
              <p className="mt-3 font-display text-2xl font-semibold tabular-nums">{priceOf(p)}</p>
              <p className="text-xs text-zinc-500">{perHour} an hour · paid once</p>
              <CtaButton cta={cta} />
              <ul className="mt-5 space-y-2 border-t border-zinc-900/5 pt-5 text-sm text-zinc-700 dark:border-white/5 dark:text-zinc-300">
                <Feature>{hours(total)} hour{hours(total) === 1 ? "" : "s"} of live or mock interviews</Feature>
                {p.resume_credits > 0 && <Feature>{p.resume_credits} Resume AI credits</Feature>}
                <Feature>Never expire</Feature>
              </ul>
            </li>
          );
        })}
      </ul>
      {aiOnly.map((p) => (
        <div key={p.id} className="flex flex-col gap-3 rounded-2xl bg-white p-5 ring-1 ring-zinc-900/10 sm:flex-row sm:items-center dark:bg-zinc-900/60 dark:ring-white/10">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" aria-hidden="true">
            <Sparkles className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {p.label}: {p.resume_credits} Resume AI credits · {priceOf(p)}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Only need Resume AI? Imports, tailoring and cover letters use 1 credit; a single AI fix uses a fifth. Never expire.
            </p>
          </div>
          <div className="sm:w-48 [&>*]:mt-0">
            <CtaButton cta={onBuy ? { label: `Buy · ${priceOf(p)}`, onClick: () => onBuy(p), disabled: busy || !p.buyable } : { label: "Get started", to: "/register", from: `/billing?pack=${p.id}` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
