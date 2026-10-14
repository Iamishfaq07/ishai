import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import type { CreditPack, JobStats } from "@orbit/types";
import {
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  OrbitWordmark,
  RefreshCw,
  Reveal,
  ShieldCheck,
  buttonClass,
  cx,
  focusRing,
  formatNumber,
  isIndia,
  useMotion,
} from "@orbit/ui";
import { Footer } from "../components/Footer";
import { SiteMenu } from "../components/SiteMenu";
import { JobMock, PracticeMock, ResumeMock } from "../components/productArt";
import { PRODUCTS, ProductMark, type ProductId } from "../components/products";
import { api } from "../lib/api";
import { useCountry, useIndia } from "../lib/country";
import { CONTACT_PAGE, REFUND_PAGE, USE_WHERE_ALLOWED } from "../lib/contact";
import { useWelcomeGrant, type WelcomeGrant } from "../lib/welcome";

/**
 * Orbit's front door at "/" for anyone signed out: what each of the three products does, what's free and what it
 * costs (the server's own packs), the questions people ask first, and the honest line about where it may be used.
 * Real product mocks instead of stock pictures; real numbers only (the public job counts). Nothing here needs an
 * account; the warm-up question is the free try.
 */

/** Below this the live count isn't worth saying (a new server still fetching its first jobs). Same as Jobs AI's page. */
const SHOW_COUNTS_FROM = 50;

function usePublic<T>(load: () => Promise<T>): T | null {
  const [value, setValue] = useState<T | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current().then(setValue).catch(() => undefined);
  }, []);
  return value;
}

// Packs are priced in rupees wherever the visitor is (billing/packs.py); a card from abroad is converted by its bank.
const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// ─── The copilot mock (the hero's picture) ─────────────────────────────────────────────────────────────────────────

const QUESTION = "Can you walk me through a project you're proud of?";
const ANSWER =
  "Sure. In my final year I built a library app for our college with two friends. I wrote the search and the sign-in, " +
  "in React with Firebase. About 400 students used it in the first month, and the librarian stopped keeping a paper register.";
const POINTS = ["Library app: React, Firebase", "400 students in a month"];
const Q_WORDS = QUESTION.split(" ");
const A_WORDS = ANSWER.split(" ");
const PAUSE = 7;
const END = Q_WORDS.length + PAUSE + A_WORDS.length + 2;

/**
 * An example of a live answer, drawn with HTML: the interviewer's words arrive, Orbit marks the question, and an
 * answer from the resume streams in. Plays once when it scrolls into view (motion allowed); otherwise, and to screen
 * readers, it's the finished card with a plain description.
 */
function CopilotMock() {
  const box = useRef<HTMLDivElement>(null);
  const saveData = typeof navigator !== "undefined" && Boolean((navigator as { connection?: { saveData?: boolean } }).connection?.saveData);
  const play = useMotion() === "full" && !saveData;
  const [tick, setTick] = useState(() => (play ? 0 : END));
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (tick >= END) return;
    const el = box.current;
    let timer = 0;
    let n = tick;
    const start = () => {
      timer = window.setInterval(() => {
        n += 1;
        setTick(n);
        if (n >= END) window.clearInterval(timer);
      }, 75);
    };
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        io.disconnect();
        start();
      }
    });
    if (el) io.observe(el);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
    };
    // Starts again only from "Play again" (run).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const qShown = Math.min(Q_WORDS.length, tick);
  const heard = tick >= Q_WORDS.length + 2;
  const aShown = Math.max(0, Math.min(A_WORDS.length, tick - Q_WORDS.length - PAUSE));
  const done = tick >= END;
  const listening = !heard;

  return (
    <figure className="relative mx-auto w-full max-w-[32rem] lg:mr-0">
      <span aria-hidden="true" className="pointer-events-none absolute -inset-10 rounded-[3rem] bg-gradient-to-br from-indigo-500/25 via-aurora-400/10 to-transparent blur-3xl" />
      <div
        ref={box}
        aria-hidden="true"
        className="relative overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10 dark:bg-zinc-900"
      >
        <div className="flex items-center gap-3 border-b border-zinc-200/80 px-4 py-3 dark:border-white/10">
          <span className="relative flex h-2.5 w-2.5">
            <span className={cx("absolute inline-flex h-full w-full rounded-full bg-rose-500/60", listening && !done && "motion-safe:animate-ping")} />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
          </span>
          <span className="text-sm font-medium">Live interview</span>
          <span className="ml-auto font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">12:40</span>
          <span className="flex h-4 items-end gap-0.5" aria-hidden="true">
            {[0.5, 0.9, 0.6, 1, 0.4].map((h, i) => (
              <span
                key={i}
                className={cx("w-0.5 origin-bottom rounded-full bg-indigo-500 dark:bg-indigo-300", listening && !done && "motion-safe:animate-wave")}
                style={{ height: `${h * 100}%`, animationDelay: `${i * 0.12}s` }}
              />
            ))}
          </span>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div>
            <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Interviewer</p>
            <p className="mt-1 min-h-[3rem] font-display text-lg leading-snug sm:text-xl">
              {Q_WORDS.slice(0, qShown).join(" ")}
              {!heard && <span className="ml-0.5 inline-block h-5 w-px translate-y-1 bg-zinc-400 motion-safe:animate-pulse" />}
            </p>
            <p
              className={cx(
                "mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-600/20 transition-opacity duration-300 dark:text-emerald-200",
                heard ? "opacity-100" : "opacity-0",
              )}
            >
              <Check className="h-3.5 w-3.5" /> Question heard
            </p>
          </div>

          <div className="rounded-2xl bg-indigo-500/[0.06] p-4 ring-1 ring-indigo-500/20 dark:bg-indigo-400/[0.07] dark:ring-indigo-300/15">
            <p className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
              <AudioLines className="h-3.5 w-3.5" /> Suggested answer, from your resume
            </p>
            <p className="mt-2 min-h-[7.5rem] text-[0.9375rem] leading-relaxed text-zinc-800 dark:text-zinc-100">
              {A_WORDS.slice(0, aShown).join(" ")}
              {heard && !done && aShown < A_WORDS.length && <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-indigo-500/70" />}
            </p>
            <ul className={cx("mt-3 flex flex-wrap gap-1.5 transition-opacity duration-300", done ? "opacity-100" : "opacity-0")}>
              {POINTS.map((p) => (
                <li key={p} className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200 dark:bg-white/5 dark:text-zinc-200 dark:ring-white/10">
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">You glance at it, then answer in your own words.</p>
        </div>
      </div>
      {/* Resume AI's score, floating over the window's corner: the copilot answers from the same resume. Wide screens only. */}
      <div aria-hidden="true" className="pointer-events-none absolute -right-6 -top-7 hidden items-center gap-2 rounded-2xl bg-white/95 px-3 py-2 shadow-xl ring-1 ring-zinc-200 motion-ok:animate-float xl:flex dark:bg-zinc-900/95 dark:ring-white/10">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 font-display text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">82</span>
        <span className="text-xs leading-tight">
          <span className="block font-semibold">ATS score</span>
          <span className="text-emerald-700 dark:text-emerald-300">+28 after 3 fixes</span>
        </span>
      </div>
      <figcaption className="relative mt-3 flex items-center justify-between gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        <span>
          <span className="sr-only">
            Example: the interviewer asks “{QUESTION}” and Orbit suggests an answer drawn from the candidate's resume: “{ANSWER}”
          </span>
          <span aria-hidden="true">An example of a live answer.</span>
        </span>
        {done && play && (
          <button
            type="button"
            onClick={() => {
              setTick(0);
              setRun((r) => r + 1);
            }}
            className={cx("inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 font-medium text-indigo-700 hover:bg-indigo-500/10 dark:text-indigo-300", focusRing)}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Play again
          </button>
        )}
      </figcaption>
    </figure>
  );
}

// ─── The three products, each with a picture of what it gives you ───────────────────────────────────────────────

function ProductBand({
  product,
  id,
  title,
  line,
  points,
  free,
  link,
  picture,
}: {
  product: ProductId;
  id: string;
  title: string;
  line: string;
  points: string[];
  free: ReactNode;
  link: ReactNode;
  picture: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 grid grid-cols-[minmax(0,1fr)] items-center gap-6 py-10 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:gap-12">
      <Reveal>
        <p className={cx("flex items-center gap-2 text-sm font-semibold", PRODUCTS[product].text)}>
          <ProductMark product={product} size="sm" />
          {PRODUCTS[product].name}
        </p>
        <h3 id={`${id}-title`} className="mt-3 text-balance font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
          {title}
        </h3>
        <p className="mt-2 max-w-xl text-base text-zinc-600 dark:text-zinc-300">{line}</p>
        <ul className="mt-4 space-y-2 text-sm">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <Check className={cx("mt-0.5 h-4 w-4 shrink-0", PRODUCTS[product].text)} aria-hidden /> {p}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{free}</p>
        <div className="mt-4">{link}</div>
      </Reveal>
      <Reveal delay={120} className="w-full md:max-w-md md:justify-self-end">
        {picture}
      </Reveal>
    </section>
  );
}

// ─── Pricing ───────────────────────────────────────────────────────────────────────────────────────────────────────

function Pricing({ packs, welcome, stats }: { packs: CreditPack[] | null; welcome: WelcomeGrant | null; stats: JobStats | null }) {
  const india = useIndia();
  const cards = packs?.[0]?.checkout === "razorpay";
  const abroad = !!packs?.[0]?.international;
  const sorted = packs ? [...packs].sort((a, b) => a.price_inr - b.price_inr) : null;
  const card = "flex flex-col rounded-2xl p-5 ring-1";
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-20 border-t border-zinc-200/70 py-14 dark:border-white/5">
      <h2 id="pricing-title" className="font-display text-3xl font-semibold tracking-tight">
        Start free. Pay only when you need more.
      </h2>
      <p className="mt-3 max-w-2xl text-base text-zinc-600 dark:text-zinc-300">
        {cards
          ? `No subscription and nothing that renews by itself. Buy a pack when you need one, by ${india ? "UPI, card or netbanking" : abroad ? "card from any country (charged in rupees; your bank converts it)" : "an Indian card, UPI or netbanking for now (cards from other countries are coming soon)"}; what's in it never expires.`
          : india
            ? "No subscription and nothing that renews by itself. Buy a pack with any UPI app when you need one; what's in it never expires."
            : "No subscription and nothing that renews by itself, and what you buy never expires. Packs are priced in Indian rupees and paid with UPI for now; card payments for other countries are coming soon."}
      </p>

      <Reveal as="ul" stagger className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <li className={cx(card, "bg-emerald-500/[0.06] ring-emerald-600/25 dark:ring-emerald-400/20")}>
          <p className="font-display text-base font-semibold">Free</p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums">₹0</p>
          <ul className="mt-3 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
            {welcome?.interview_minutes ? <li>{welcome.interview_minutes} interview minutes to start</li> : null}
            {welcome?.resume_credits ? <li>{welcome.resume_credits} AI credit{welcome.resume_credits === 1 ? "" : "s"} to start</li> : null}
            <li>Resume editing, ATS score, downloads</li>
            <li>Job matches and the tracker</li>
          </ul>
        </li>
        {sorted?.map((p) => (
          <li key={p.id} className={cx(card, "glass-panel ring-0")}>
            <p className="font-display text-base font-semibold">{p.label}</p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{rupees(p.price_inr)}</p>
            <ul className="mt-3 space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
              {p.interview_minutes > 0 && <li className="tabular-nums">{p.interview_minutes} interview minutes</li>}
              {p.resume_credits > 0 && <li className="tabular-nums">{p.resume_credits} AI credits</li>}
              <li>Never expires</li>
            </ul>
          </li>
        ))}
      </Reveal>
      {sorted === null && (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Pack prices are on the Plan &amp; credits page once you're signed in.</p>
      )}
      {welcome && (
        <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          The free minutes and credit come once per network, so they can't be claimed again with a new email.
        </p>
      )}

      <h3 className="mt-12 font-display text-xl font-semibold">What uses what</h3>
      <div className="mt-4 overflow-x-auto rounded-2xl ring-1 ring-zinc-200 dark:ring-white/10">
        <table className="w-full min-w-[20rem] text-left text-sm">
          <caption className="sr-only">What each part of Orbit costs</caption>
          <thead className="bg-zinc-500/5 text-xs text-zinc-600 dark:text-zinc-400">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">
                What you do
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium">
                What it uses
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200/70 dark:divide-white/5">
            {([
              ["Type and edit your resume, see its ATS score, download it as Word or PDF", "Free"],
              ["Job matches, search links to other job sites, the application tracker", "Free"],
              ["An AI fit check for a job", stats ? `Free, ${stats.fit_daily} a day` : "Free, a few a day"],
              ["A practice question with instant feedback", "Free, no account needed"],
              ["An AI action in Resume AI or Outreach: import, rewrite, tailor, cover letter, a message", "1 AI credit each"],
              ["A mock interview or a live session", "Interview minutes, by the minute"],
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
    </section>
  );
}

// ─── Questions ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Faq({ welcome, stats, cards = false, abroad = false }: {
  welcome: WelcomeGrant | null; stats: JobStats | null; cards?: boolean; abroad?: boolean;
}) {
  const country = useCountry();
  const india = isIndia(country);
  const items: Array<[string, ReactNode]> = [
    [
      "Is it allowed to use Orbit in an interview?",
      <>
        <p>{USE_WHERE_ALLOWED}</p>
        <p>
          Practising is always fine. In a real interview, call or test, some employers, colleges and exams don't allow
          notes or AI help, and breaking their rules can cost you the job. Orbit stays visible on your screen and
          doesn't hide from other apps.
        </p>
      </>,
    ],
    [
      "What's free?",
      <>
        {welcome && (welcome.interview_minutes || welcome.resume_credits) ? (
          <p>
            A new account starts with
            {welcome.interview_minutes ? ` ${welcome.interview_minutes} interview minutes` : ""}
            {welcome.interview_minutes && welcome.resume_credits ? " and" : ""}
            {welcome.resume_credits ? ` ${welcome.resume_credits} AI credit${welcome.resume_credits === 1 ? "" : "s"}` : ""}.
          </p>
        ) : null}
        <p>
          Always free: building and editing your resume, its ATS score, Word and PDF downloads, job matches, the
          tracker, {stats ? `${stats.fit_daily} AI fit checks a day` : "a few AI fit checks a day"}, and practice
          questions without an account.
        </p>
      </>,
    ],
    [
      "How do I pay? Is there a subscription?",
      cards ? (
        <p>
          There's no subscription. When you want more interview minutes or AI credits, you buy a pack through Razorpay:
          {india
            ? " UPI, a debit or credit card, netbanking or a wallet."
            : abroad
              ? " a debit or credit card from any country (charged in Indian rupees; your bank converts it)."
              : " for now an Indian card, UPI or netbanking; cards from other countries are coming soon."}{" "}
          The credits are added as soon as Razorpay confirms the payment, usually within seconds. Nothing renews, and
          what you buy never expires.
        </p>
      ) : india ? (
        <p>
          There's no subscription. When you want more interview minutes or AI credits, you buy a pack with any UPI app
          (Google Pay, PhonePe, Paytm or your bank's app). Each payment is checked against its UTR, the 12-digit number
          your UPI app shows, and then the credits are added. Nothing renews, and what you buy never expires.
        </p>
      ) : (
        <p>
          There's no subscription, nothing renews, and what you buy never expires. Today packs are priced in Indian
          rupees and paid with UPI; card payments for other countries are coming soon. Everything free works the same
          wherever you are.
        </p>
      ),
    ],
    // The refund answer waits for the owner's refund rules, with the refund page (lib/contact.ts).
    ...(REFUND_PAGE
      ? ([
          [
            "Can I get a refund?",
            <p>
              Yes, for a pack you haven't used, and if a payment went wrong.{" "}
              <a href={REFUND_PAGE} className="underline underline-offset-2">
                The refund policy
              </a>{" "}
              has the details.
            </p>,
          ],
        ] as Array<[string, ReactNode]>)
      : []),
    [
      "Does it work on my phone?",
      <p>
        Yes. Resume AI, Jobs AI and practice work in your phone's browser. For help during a call, open Orbit on a
        laptop: Chrome and Edge can listen to a meeting tab, and the Orbit app for Windows can listen to any call app.
      </p>,
    ],
    [
      "Where do the jobs come from?",
      <p>
        Companies' own careers pages and job boards that allow it{stats && stats.jobs >= SHOW_COUNTS_FROM ? `: ${formatNumber(stats.jobs, country)} new posts in the last ${stats.days} days` : ""}. Apply always
        opens the original post. {india ? "LinkedIn and Naukri" : "LinkedIn and Indeed"} get search links filled in for
        you; Orbit doesn't copy their listings.
      </p>,
    ],
    [
      "What happens to my resume and my calls?",
      <p>
        Audio is turned into text as you speak and is never stored. Your documents and session notes stay in your
        account, and you can delete any of them, or the whole account, at any time.{" "}
        <a href="/privacy.html" className="underline underline-offset-2">
          Privacy policy
        </a>
      </p>,
    ],
  ];
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 border-t border-zinc-200/70 py-14 dark:border-white/5">
      <h2 id="faq-title" className="font-display text-3xl font-semibold tracking-tight">
        Questions people ask first
      </h2>
      <div className="mt-8 max-w-3xl space-y-2">
        {items.map(([q, a]) => (
          <details key={q} className="group rounded-2xl ring-1 ring-zinc-200 open:bg-zinc-500/[0.04] dark:ring-white/10">
            <summary
              className={cx(
                "flex min-h-12 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-3 font-medium [&::-webkit-details-marker]:hidden",
                focusRing,
              )}
            >
              <span className="flex-1">{q}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="space-y-2 px-4 pb-4 text-sm text-zinc-600 dark:text-zinc-300">{a}</div>
          </details>
        ))}
      </div>
      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        Something else?{" "}
        <Link to={CONTACT_PAGE} className={cx("rounded font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
          Contact us
        </Link>
        .
      </p>
    </section>
  );
}

// ─── The page ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function LandingPage() {
  const country = useCountry();
  const welcome = useWelcomeGrant();
  const packs = usePublic(() => api.listPacks());
  const stats = usePublic(() => api.jobStats());
  const { hash } = useLocation();
  // "/#pricing" from another page (the footer): scroll there once the page is drawn.
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  const freeLine = welcome
    ? `Free to start: ${[
        welcome.interview_minutes ? `${welcome.interview_minutes} interview minutes` : "",
        welcome.resume_credits ? `${welcome.resume_credits} AI credit${welcome.resume_credits === 1 ? "" : "s"}` : "",
      ]
        .filter(Boolean)
        .join(" and ")}. No card, no subscription.`
    : "Free to start. No card, no subscription.";
  const counts = stats && stats.jobs >= SHOW_COUNTS_FROM ? stats : null;

  return (
    <div className="min-h-full overflow-x-clip">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm dark:focus:bg-zinc-900"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-white dark:border-white/5 dark:bg-zinc-950">
        <div className="relative mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link to="/" className={cx("shrink-0 rounded-lg", focusRing)} aria-label="Orbit home">
            <OrbitWordmark size={26} />
          </Link>
          <nav aria-label="On this page" className="ml-4 hidden items-center gap-1 text-sm md:flex">
            {[
              ["#products", "Products"],
              ["#pricing", "Pricing"],
              ["#faq", "Questions"],
            ].map(([href, label]) => (
              <a key={href} href={href} className={cx("rounded-lg px-3 py-2 text-zinc-600 hover:bg-zinc-900/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white", focusRing)}>
                {label}
              </a>
            ))}
          </nav>
          <nav aria-label="Account" className="ml-auto flex items-center gap-2">
            <SiteMenu />
            <Link to="/login" className={buttonClass("secondary", "md", "hidden min-h-11 sm:inline-flex")}>
              Sign in
            </Link>
            <Link to="/register" className={buttonClass("primary", "md", "min-h-11")}>
              Start free
            </Link>
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 sm:px-6">
        <section aria-labelledby="hero-title" className="grid grid-cols-[minmax(0,1fr)] items-center gap-12 pb-14 pt-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:pb-20 lg:pt-16">
          <div className="animate-fade-up">
            <h1 id="hero-title" className="text-balance font-display text-[2rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.4rem]">
              Practise interviews, fix your resume, find jobs.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-zinc-600 dark:text-zinc-300">
              One free account with three tools: practice and live help for interviews, a resume checker that shows
              what screening software sees, and new jobs that fit you.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link to="/register" className={buttonClass("primary", "lg", "min-h-11")}>
                Create a free account <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link to="/warmup" className={buttonClass("secondary", "lg", "min-h-11")}>
                Try a practice question first
              </Link>
            </div>
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{freeLine}</p>
            <p className="mt-6 flex max-w-xl items-start gap-2 rounded-xl bg-zinc-500/[0.06] px-3.5 py-3 text-sm text-zinc-700 ring-1 ring-zinc-500/15 dark:text-zinc-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              {USE_WHERE_ALLOWED}
            </p>
          </div>
          <CopilotMock />
        </section>

        <section id="products" aria-labelledby="products-title" className="scroll-mt-20 border-t border-zinc-200/70 pt-14 dark:border-white/5">
          <h2 id="products-title" className="font-display text-3xl font-semibold tracking-tight">
            One account, three tools
          </h2>
          <p className="mt-3 max-w-2xl text-base text-zinc-600 dark:text-zinc-300">
            Add your resume once. Your practice answers, your ATS score and your job matches all start from it.
          </p>
          <div className="divide-y divide-zinc-200/70 dark:divide-white/5">
            <ProductBand
              product="interview"
              id="interview"
              title="Practise out loud, then get help when it counts"
              line="An AI interviewer asks the questions, you answer out loud, and you get a score with the answers worth redoing. In a live call, Orbit hears the question and suggests an answer from your own resume."
              points={["5-minute HR rounds, technical rounds and salary talks", "A story bank for “Tell me about a time…” questions", "Coding help from a screenshot"]}
              free={welcome?.interview_minutes ? `Mock interviews and live sessions use interview minutes; a new account gets ${welcome.interview_minutes} to start.` : "Mock interviews and live sessions use interview minutes."}
              link={
                <Link to="/warmup" className={cx("inline-flex min-h-10 items-center gap-1.5 rounded-lg font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
                  Try a practice question, no account needed <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              }
              picture={<PracticeMock />}
            />
            <ProductBand
              product="resume"
              id="resume"
              title="See your resume the way screening software does"
              line="Most companies' software reads a resume before a person does. Resume AI scores yours out of 100, shows what's missing for the job you want, and fixes it with you. It keeps your numbers and never makes one up."
              points={["Import your resume, or start from a template", "A copy tailored for each job, every change shown", "Word and PDF downloads, cover letters"]}
              free="Editing, the ATS score and downloads are free. AI rewrites use AI credits."
              link={
                <Link to="/resume-ai" className={cx("inline-flex min-h-10 items-center gap-1.5 rounded-lg font-medium text-emerald-700 hover:underline dark:text-emerald-300", focusRing)}>
                  See what Resume AI does <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              }
              picture={<ResumeMock />}
            />
            <ProductBand
              product="jobs"
              id="jobs"
              title="New jobs that fit you, straight from the company"
              line={
                counts
                  ? `${formatNumber(counts.jobs, country)} new jobs from ${formatNumber(counts.companies, country)} companies in the last ${counts.days} days, from their own careers pages and job boards that allow it. Each one shows how well it matches your resume.`
                  : "The latest openings from companies' own careers pages and job boards that allow it. Each one shows how well it matches your resume."
              }
              points={[isIndia(country) ? "Freshers' and internship filters, your city or remote" : "Entry-level and internship filters, your city or remote", "A tracker from saved to offer, with follow-ups", "Messages to ask for a referral"]}
              free="Matches and the tracker are free, and so are a few AI fit checks a day."
              link={
                <Link to="/jobs" className={cx("inline-flex min-h-10 items-center gap-1.5 rounded-lg font-medium text-sky-700 hover:underline dark:text-sky-300", focusRing)}>
                  See what Jobs AI does <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              }
              picture={
                <figure>
                  <JobMock />
                  <figcaption className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">An example of a job card.</figcaption>
                </figure>
              }
            />
          </div>
        </section>

        <section aria-labelledby="how-title" className="border-t border-zinc-200/70 py-14 dark:border-white/5">
          <h2 id="how-title" className="font-display text-3xl font-semibold tracking-tight">
            How it works
          </h2>
          <ol className="mt-8 grid gap-6 md:grid-cols-3">
            {[
              ["Create a free account", "Takes about a minute. Tell Orbit what you're preparing for, and it shows you where to start."],
              ["Add your resume", "Import the one you have, or build one from a template. Every tool starts from it."],
              ["Practise, apply, walk in ready", "Do a practice round, fix what the score shows, and apply to jobs that fit."],
            ].map(([title, text], i) => (
              <Reveal as="li" key={title} delay={i * 110} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 font-display text-base font-semibold tabular-nums text-indigo-700 ring-1 ring-indigo-500/25 dark:text-indigo-200">
                  {i + 1}
                </span>
                <span>
                  <span className="block font-display text-lg font-semibold">{title}</span>
                  <span className="mt-1 block text-sm text-zinc-600 dark:text-zinc-300">{text}</span>
                </span>
              </Reveal>
            ))}
          </ol>
        </section>

        <Pricing packs={packs} welcome={welcome} stats={stats} />
        <Faq welcome={welcome} stats={stats} cards={packs?.[0]?.checkout === "razorpay"} abroad={!!packs?.[0]?.international} />

        <Reveal as="section" aria-labelledby="start-title" className="mb-16 rounded-3xl bg-zinc-500/[0.06] p-6 text-center ring-1 ring-zinc-500/15 sm:p-10">
          <h2 id="start-title" className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Start with one question
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-zinc-600 dark:text-zinc-300">
            Answer a common interview question and see what to improve, before you sign up for anything.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/warmup" className={buttonClass("primary", "lg", "min-h-11")}>
              Try a practice question <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link to="/register" className={buttonClass("secondary", "lg", "min-h-11")}>
              Create a free account
            </Link>
          </div>
        </Reveal>
      </main>
      <Footer />
    </div>
  );
}
