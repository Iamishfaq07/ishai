import type { ReactNode } from "react";
import type { CreditPack, JobStats, MonthlyPlan } from "@orbit/types";
import { ChevronDown, cx, focusRing } from "@orbit/ui";
import { CreditPackGrid, PlanComparison, PricingTiers } from "../components/PricingTiers";
import { useIndia } from "../lib/country";
import { REFUND_PAGE } from "../lib/contact";
import type { WelcomeGrant } from "../lib/welcome";
import { Section, SectionIntro } from "./primitives";

/** A section's fold-out: "Compare every plan", "What uses credits, and what's free". */
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group mt-6 rounded-2xl border mk-line mk-surface">
      <summary className={cx("flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-3 text-sm font-medium text-zinc-900 dark:text-zinc-100 [&::-webkit-details-marker]:hidden", focusRing)}>
        {summary}
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-quick group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  );
}

/**
 * The plans, the credit packs and what uses credits, from the server's own prices: the front page's "Pricing" section
 * and the body of /pricing. Signed out, every button leads to sign-up. `india`: the payment wording for India (UPI,
 * Indian cards) or elsewhere (PayPal, US dollars); the visitor's country unless the page shows a currency they picked.
 */
export function PricingSection({
  packs,
  monthly,
  welcome,
  stats,
  india: indiaFor,
  id = "pricing",
  eyebrow = "Pricing",
  title = "Start free. Pay once when you need more.",
  lead = "Pick a plan for interview season (the longer, the cheaper a month), or top up with credits that never expire. Nothing renews or is charged automatically.",
  flush = false,
}: {
  packs: CreditPack[] | null;
  monthly: MonthlyPlan[] | null;
  welcome: WelcomeGrant | null;
  stats: JobStats | null;
  india?: boolean;
  id?: string;
  eyebrow?: string;
  title?: string;
  lead?: string;
  flush?: boolean;
}) {
  const visitorInIndia = useIndia();
  const india = indiaFor ?? visitorInIndia;
  const cards = packs?.[0]?.checkout === "razorpay";
  const paypal = packs?.[0]?.checkout === "paypal";
  const abroad = !!packs?.[0]?.international;
  const sorted = packs ? [...packs].sort((a, b) => a.price_inr - b.price_inr) : null;
  return (
    <Section id={id} labelledBy={`${id}-title`} flush={flush}>
      <SectionIntro id={`${id}-title`} eyebrow={eyebrow} center title={title} lead={lead} />
      <div className="mt-14">
        <PricingTiers monthly={monthly} welcome={welcome} />
      </div>
      {monthly && monthly.length > 0 && (
        <Disclosure summary="Compare every plan">
          <PlanComparison monthly={monthly} />
        </Disclosure>
      )}

      <div className="mt-20">
        <h3 className="mk-h3 text-zinc-950 dark:text-white">Pay as you go: credits</h3>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {packs === null && !india
            ? "1 interview credit is 1 hour of live or mock interviews, with Resume credits included. Bought once when you need them; what's in them never expires."
            : paypal
              ? "1 interview credit is 1 hour of live or mock interviews, with Resume credits included. Bought once when you need them, in US dollars through PayPal (your PayPal account, or a card where PayPal offers it). What's in them never expires."
              : cards
                ? `1 interview credit is 1 hour of live or mock interviews, with Resume credits included. Bought once when you need them, by ${india ? "UPI, card or netbanking" : packs?.[0]?.currency === "USD" ? "card, in US dollars" : abroad ? "card from any country (in US dollars outside India)" : "an Indian card, UPI or netbanking for now (cards from other countries are coming soon)"}. What's in them never expires.`
                : india
                  ? "Credit packs, bought once with any UPI app when you need them. What's in them never expires."
                  : packs?.[0]?.currency === "USD"
                    ? "Credit packs that never expire, priced in US dollars. Card payments from outside India are coming soon."
                    : "Credit packs that never expire, priced in Indian rupees and paid with UPI for now; card payments for other countries are coming soon."}
        </p>
        <div className="mt-8">
          <CreditPackGrid packs={sorted} />
        </div>
        {sorted === null && (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Pack prices are on the Plan &amp; credits page once you're signed in.</p>
        )}
        {welcome && (
          <p className="mt-4 text-xs text-zinc-600 dark:text-zinc-400">
            The free minutes and credit come once per network, so they can't be claimed again with a new email.
          </p>
        )}
      </div>

      <Disclosure summary="What uses credits, and what's free">
        <div className="overflow-x-auto rounded-xl border mk-line">
          <table className="w-full min-w-[20rem] text-left text-sm">
            <caption className="sr-only">What each part of Orbit costs</caption>
            <thead className="mk-band text-xs text-zinc-600 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">What you do</th>
                <th scope="col" className="px-4 py-2.5 font-medium">What it uses</th>
              </tr>
            </thead>
            <tbody className="mk-divide">
              {([
                ["Type and edit your resume, see its ATS score, download it as Word or PDF", "Free"],
                ["Job matches, search links to other job sites, the application tracker", "Free"],
                ["An AI fit check for a job", stats ? `Free, ${stats.fit_daily} a day` : "Free, a few a day"],
                ["A practice question with instant feedback", "Free, no account needed"],
                ["An AI action in Resume or Outreach: import, tailor, whole-resume rewrite, cover letter, a message", "1 AI credit each"],
                ["A single AI fix in Resume: one ATS check, one section or line", "1/5 of an AI credit"],
                ["A mock interview or a live session", "Interview credits (1 credit = 1 hour), used by the minute"],
              ] as Array<[string, string]>).map(([what, cost]) => (
                <tr key={what}>
                  <th scope="row" className="px-4 py-3 font-normal text-zinc-800 dark:text-zinc-200">
                    {what}
                  </th>
                  <td className={cx("px-4 py-3 font-medium", cost.startsWith("Free") ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-800 dark:text-zinc-100")}>
                    {cost}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          If an AI action fails, its credit comes back.
          {REFUND_PAGE && (
            <>
              {" "}Refunds:{" "}
              <a href={REFUND_PAGE} className={cx("rounded underline underline-offset-2", focusRing)}>
                see the refund policy
              </a>
              .
            </>
          )}
        </p>
      </Disclosure>
    </Section>
  );
}
