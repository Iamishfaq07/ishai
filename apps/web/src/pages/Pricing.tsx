import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CreditPack, JobStats, MonthlyPlan } from "@orbit/types";
import { ArrowRight, ChevronDown, Skeleton, buttonClass, cx, focusRing, isIndia } from "@orbit/ui";
import { api } from "../lib/api";
import { CONTACT_PAGE, REFUND_PAGE } from "../lib/contact";
import { useCountry } from "../lib/country";
import { useWelcomeGrant, type WelcomeGrant } from "../lib/welcome";
import { CtaBand, inkButton } from "../marketing/ProductPage";
import { PricingSection } from "../marketing/PricingSection";
import { PublicLayout } from "../marketing/PublicLayout";
import { Container, Eyebrow, Section, SectionIntro } from "../marketing/primitives";

type Currency = "INR" | "USD";

const CURRENCIES: Array<{ id: Currency; label: string; note: string }> = [
  { id: "INR", label: "India (₹)", note: "in Indian rupees" },
  { id: "USD", label: "Everywhere else ($)", note: "in US dollars" },
];

/** How the shown prices are paid, from what the server says about its own packs (never assumed). */
function payWords(currency: Currency, packs: CreditPack[] | null): string {
  const how = packs?.[0]?.checkout;
  if (currency === "INR") {
    if (how === "razorpay") return "In India you pay in rupees through Razorpay: UPI, a debit or credit card, netbanking or a wallet.";
    if (how === "upi") return "In India you pay in rupees with any UPI app (Google Pay, PhonePe, Paytm or your bank's app).";
    return "In India prices are in rupees, paid by UPI or card.";
  }
  if (how === "paypal") return "Outside India you pay in US dollars through PayPal: your PayPal account, or a card where PayPal offers it.";
  return "Outside India prices are in US dollars. Card payments from outside India are opening soon; until then, write to us and we'll help.";
}

/** The two price lists: the visitor's own first. Changing it only changes what this page shows. */
function CurrencySwitch({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) {
  return (
    <fieldset className="mt-8">
      <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Show prices for</legend>
      <div className="mt-2 inline-flex rounded-xl border mk-line mk-surface p-1">
        {CURRENCIES.map((c) => (
          <label key={c.id} className="relative cursor-pointer">
            <input
              type="radio"
              name="pricing-currency"
              value={c.id}
              checked={value === c.id}
              onChange={() => onChange(c.id)}
              className="peer sr-only"
            />
            <span
              className={cx(
                "flex min-h-10 items-center rounded-lg px-4 text-sm font-medium transition-colors duration-quick",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-500 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-zinc-950",
                value === c.id ? "bg-zinc-950 text-white dark:bg-white dark:text-zinc-950" : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white",
              )}
            >
              {c.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function freeLine(welcome: WelcomeGrant | null): string {
  if (!welcome || (!welcome.interview_minutes && !welcome.resume_credits)) return "A free account needs no card, and nothing renews.";
  const parts = [
    welcome.interview_minutes ? `${welcome.interview_minutes} interview minutes` : "",
    welcome.resume_credits ? `${welcome.resume_credits} AI credit${welcome.resume_credits === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `A new account starts with ${parts.join(" and ")}, free. No card, and nothing renews.`;
}

function Questions({ currency, packs, welcome, stats }: { currency: Currency; packs: CreditPack[] | null; welcome: WelcomeGrant | null; stats: JobStats | null }) {
  const items: Array<[string, ReactNode]> = [
    [
      "Is there a subscription?",
      <p>
        No. A plan runs for a week, a month or a year and ends on its own on its last day; you're never charged again
        unless you buy again. Credit packs are paid once.
      </p>,
    ],
    [
      "Do credits expire?",
      <p>
        No. Interview credits and AI credits never expire. While a plan runs they aren't used, and they're still there
        when it ends.
      </p>,
    ],
    ["How do I pay?", <p>{payWords(currency, packs)} What you bought is added as soon as the payment is confirmed.</p>],
    [
      "Which prices are mine?",
      <p>
        The ones for where you are: rupees in India, US dollars everywhere else. The switch at the top of this page only
        changes what it shows; checkout always uses the prices for your country.
      </p>,
    ],
    [
      "What's free?",
      <>
        <p>{freeLine(welcome)}</p>
        <p>
          Always free: building and editing your resume, its ATS score, Word and PDF downloads, job matches, the tracker,{" "}
          {stats ? `${stats.fit_daily} AI fit checks a day` : "a few AI fit checks a day"}, and practice questions without
          an account.
        </p>
      </>,
    ],
    ...(REFUND_PAGE
      ? ([
          [
            "Can I get a refund?",
            <p>
              Yes, for a pack you haven't used, and if a payment went wrong.{" "}
              <a href={REFUND_PAGE} className={cx("rounded underline underline-offset-2", focusRing)}>
                The refund policy
              </a>{" "}
              has the details.
            </p>,
          ],
        ] as Array<[string, ReactNode]>)
      : []),
  ];
  return (
    <Section labelledBy="pricing-faq-title" band>
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <SectionIntro id="pricing-faq-title" eyebrow="Questions" title="Questions about paying." />
          <p className="mt-5 text-[0.9375rem] text-zinc-600 dark:text-zinc-400">
            Buying for a college, a bootcamp or a team?{" "}
            <Link to={CONTACT_PAGE} className={cx("rounded font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
              Contact us
            </Link>
            .
          </p>
        </div>
        <div className="mk-divide border-y mk-line lg:col-span-8">
          {items.map(([q, a]) => (
            <details key={q} className="group">
              <summary
                className={cx(
                  "flex min-h-14 cursor-pointer list-none items-center gap-4 rounded-lg py-4 text-[0.9375rem] font-medium text-zinc-950 dark:text-white [&::-webkit-details-marker]:hidden",
                  focusRing,
                )}
              >
                <span className="flex-1">{q}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-quick group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="space-y-3 pb-5 pr-8 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-300">{a}</div>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

/**
 * /pricing: the plans and the credit packs, in rupees and in US dollars, from the server's own price lists (GET
 * /v1/billing/packs and /monthly with `?currency=`, which are for reading: checkout always prices by the country the
 * website's edge sees). The visitor's own currency comes first; the switch shows the other. Signed out or in, every
 * button leads to sign-up or to Plan & billing; nothing is bought from here.
 */
export function PricingPage() {
  const country = useCountry();
  const [picked, setPicked] = useState<Currency | null>(null);
  const currency: Currency = picked ?? (isIndia(country) ? "INR" : "USD");
  const welcome = useWelcomeGrant();
  const [lists, setLists] = useState<{ currency: Currency; packs: CreditPack[]; monthly: MonthlyPlan[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [stats, setStats] = useState<JobStats | null>(null);

  useEffect(() => {
    api.jobStats().then(setStats).catch(() => undefined);
  }, []);
  useEffect(() => {
    let live = true;
    setFailed(false);
    Promise.all([api.listPacks(currency), api.listMonthly(currency)])
      .then(([packs, monthly]) => live && setLists({ currency, packs, monthly }))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [currency, attempt]);

  // The last list shown stays until the other currency's arrives, so the page doesn't jump while it loads.
  const shown = lists;
  const switching = Boolean(shown && shown.currency !== currency);
  const note = CURRENCIES.find((c) => c.id === (shown?.currency ?? currency))!.note;

  return (
    <PublicLayout>
      <section aria-labelledby="pricing-page-title" className="relative isolate">
        <div className="mk-hero-detail" aria-hidden="true" />
        <Container className="pb-4 pt-12 sm:pt-16 lg:pt-20">
          <Eyebrow>Pricing</Eyebrow>
          <h1 id="pricing-page-title" className="mk-display mt-4 max-w-3xl text-zinc-950 dark:text-white">
            Start free. Pay once, only when you need more.
          </h1>
          <p className="mk-lead mt-6 max-w-2xl text-zinc-600 dark:text-zinc-300">
            Plans for interview season (a week, a month or a year, paid once) or credit packs that never expire, and
            nothing is ever charged automatically. {freeLine(welcome)}
          </p>
          <CurrencySwitch value={currency} onChange={setPicked} />
          <p className="mt-3 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{payWords(currency, shown?.currency === currency ? shown.packs : null)}</p>
        </Container>
      </section>

      <p role="status" className="sr-only">
        {shown && !switching ? `Showing prices ${note}.` : "Loading the prices."}
      </p>
      <div aria-busy={!shown || switching}>
        {failed && !shown ? (
          <Container className="py-16">
            <div role="alert" className="rounded-2xl border mk-line mk-surface p-6 text-[0.9375rem] text-zinc-700 dark:text-zinc-300">
              <p>The prices couldn't be loaded just now.</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className={buttonClass("secondary", "md", "mt-4")}>
                Try again
              </button>
            </div>
          </Container>
        ) : shown ? (
          <PricingSection
            id="plans"
            flush
            packs={shown.packs}
            monthly={shown.monthly}
            welcome={welcome}
            stats={stats}
            india={shown.currency === "INR"}
            eyebrow={`Prices ${note}`}
            title="Plans and credits"
            lead="The longer a plan, the cheaper a month. Credits are bought when you need them and never expire."
          />
        ) : (
          <Container className="space-y-6 py-16">
            <Skeleton variant="line" count={2} label="Loading the prices" className="mx-auto max-w-md" />
            <Skeleton variant="card" count={2} ghost />
          </Container>
        )}
      </div>

      <Questions currency={currency} packs={shown?.currency === currency ? shown.packs : null} welcome={welcome} stats={stats} />

      <CtaBand
        id="pricing-cta-title"
        title="Start with the free account."
        text={
          welcome?.interview_minutes
            ? "The free interview minutes and AI credit are enough to see how Orbit works for you. Buy more only when you need it."
            : "Your resume, its ATS score, job matches and the tracker are free. Buy interview time only when you need it."
        }
        actions={
          <>
            <Link to="/register" className={inkButton.primary}>
              Start free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/warmup" className={inkButton.secondary}>
              Try a practice question
            </Link>
          </>
        }
        footnote="No card needed, and nothing renews."
      />
    </PublicLayout>
  );
}
