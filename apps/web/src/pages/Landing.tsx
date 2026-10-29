import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import type { JobStats } from "@orbit/types";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  CalendarCheck,
  ChevronDown,
  Cookie,
  Database,
  Download,
  EyeOff,
  KashSecScene,
  KeyRound,
  Laptop,
  Layers,
  LockKeyhole,
  MicOff,
  MonitorSmartphone,
  Reveal,
  ShieldCheck,
  Wallet,
  buttonClass,
  cx,
  focusRing,
  formatNumber,
  isIndia,
  regionWords,
  useMotion,
} from "@orbit/ui";
import { api } from "../lib/api";
import { useCountry } from "../lib/country";
import { CONTACT_PAGE, COOKIE_PAGE, PRIVACY_PAGE, REFUND_PAGE, USE_WHERE_ALLOWED } from "../lib/contact";
import { WINDOWS_APP_BETA, WINDOWS_APP_URL } from "../lib/desktop";
import { WELCOME_LIKE, useWelcomeGrant, type WelcomeGrant } from "../lib/welcome";
import { kashsecUrl } from "./learn/links";
import { KASHSEC_TAGLINE, KashSecChips } from "../components/KashSec";
import { JOBS_AI_HOME } from "./jobs/paths";
import { RESUME_AI_HOME } from "./resume/paths";
import { LiveAnswerDemo } from "../marketing/LiveAnswerDemo";
import { PRODUCT_TILE, siteProducts, type SiteProduct } from "../marketing/catalog";
import { ArrowLink, CheckList, Container, Eyebrow, IconTile, Section, SectionIntro } from "../marketing/primitives";
import { SameBox } from "../marketing/SameBox";
import { CtaBand, inkButton } from "../marketing/ProductPage";
import { ProductShot, type ShotName } from "../marketing/ProductShot";
import { PublicLayout } from "../marketing/PublicLayout";
import { PricingSection } from "../marketing/PricingSection";
import { StickyCta } from "../marketing/StickyCta";

/**
 * Orbit's front door at "/" for anyone signed out (DECISIONS D66): what Orbit is, each product with a real screen of
 * it, how it works, why one account, how data is handled, the server's own prices, the questions people ask first and
 * one clear way to start. Real product renders, real numbers only (the public job counts and the server's prices),
 * the honest line about where AI help may be used. Nothing here needs an account; the warm-up question is the free try.
 */

/** Below this the live count isn't worth saying (a new server still fetching its first jobs). Same as Jobs's page. */
const SHOW_COUNTS_FROM = 50;

function usePublic<T>(load: () => Promise<T>): T | null {
  const [value, setValue] = useState<T | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current().then(setValue).catch(() => undefined);
  }, []);
  return value;
}

function freeLineFor(welcome: WelcomeGrant | null): string {
  if (!welcome) return "Free to start. No card, and nothing renews.";
  const parts = [
    welcome.interview_minutes ? `${welcome.interview_minutes} interview minutes` : "",
    welcome.resume_credits ? `${welcome.resume_credits} AI credit${welcome.resume_credits === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `Free to start: ${parts.join(" and ")}. No card, and nothing renews.`;
}

// ─── Hero ────────────────────────────────────────────────────────────────────────────────────────────────────────

function Hero({ freeLine, freeLineLike, ctas }: { freeLine: string; freeLineLike: string; ctas: RefObject<HTMLDivElement | null> }) {
  return (
    <section aria-labelledby="hero-title" className="relative isolate">
      <div className="mk-hero-detail" aria-hidden="true" />
      <Container className="grid grid-cols-1 items-center gap-12 pb-16 pt-12 sm:pt-16 lg:grid-cols-12 lg:gap-10 lg:pb-24 lg:pt-20">
        <div className="lg:col-span-6">
          <Link
            to="/#copilot"
            className={cx(
              "group inline-flex items-center gap-2 rounded-full border mk-line mk-surface py-1 pl-1 pr-3 text-[0.8125rem] text-zinc-700 transition-colors duration-quick hover:border-zinc-300 dark:text-zinc-300 dark:hover:border-white/20",
              focusRing,
            )}
          >
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-200">Windows app</span>
            Live help in any call app, in beta
            <ArrowRight className="h-3.5 w-3.5 text-zinc-400 transition-transform duration-quick motion-ok:group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
          <h1 id="hero-title" className="mk-display mt-6 text-zinc-950 dark:text-white">
            {/* Kept on one line (a plain hyphen: IBM Plex has no non-breaking hyphen, which would pull in a fallback font). */}
            <span className="whitespace-nowrap">Interview-ready,</span> from resume to offer.
          </h1>
          <p className="mk-lead mt-6 max-w-xl text-zinc-600 dark:text-zinc-300">
            Orbit is one account for your whole job search. Practise with an AI interviewer, get your resume past
            screening software, find jobs that fit, and get live answers from your own resume in interviews where AI
            help is allowed.
          </p>
          <div ref={ctas} className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/register" className={buttonClass("primary", "lg", "min-h-12 px-6")}>
              Start free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/warmup" className={buttonClass("secondary", "lg", "min-h-12 px-6")}>
              Try a practice question
            </Link>
          </div>
          <SameBox like={<p>{freeLineLike}</p>} answered={freeLine} className="mt-5 text-sm text-zinc-600 dark:text-zinc-400">
            <p>{freeLine}</p>
          </SameBox>
          <p className="mt-6 flex max-w-xl items-start gap-2.5 border-t mk-line pt-5 text-[0.8125rem] leading-relaxed text-zinc-600 dark:text-zinc-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            {USE_WHERE_ALLOWED}
          </p>
        </div>
        <div className="lg:col-span-6 lg:pl-4">
          <LiveAnswerDemo className="mx-auto max-w-[34rem] lg:mr-0" />
        </div>
      </Container>
    </section>
  );
}

// ─── The product index under the hero ──────────────────────────────────────────────────────────────────────────

function ProductIndex({ products }: { products: SiteProduct[] }) {
  const main = products.filter((p) => p.main);
  const anchor: Record<string, string> = { copilot: "/#copilot", practice: "/#practice", resume: "/#resume", jobs: "/#jobs" };
  return (
    <section aria-label="Orbit's products" className="border-t mk-line">
      <Container>
        <Reveal as="ul" stagger className="grid grid-cols-1 divide-y mk-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
          {main.map((p, i) => (
            <li key={p.id} className={cx("min-w-0 sm:border-l mk-line", i === 0 && "sm:border-l-0", i === 2 && "sm:border-l-0 lg:border-l")}>
              <Link to={anchor[p.id] ?? p.href} className={cx("group flex h-full flex-col gap-3 px-1 py-7 sm:px-6 sm:py-9", i % 2 === 0 && "sm:pl-0 lg:pl-6", i === 0 && "lg:pl-0", focusRing)}>
                <IconTile icon={p.icon} tone={PRODUCT_TILE[p.id]} />
                <span className="flex items-center gap-1.5 text-base font-semibold text-zinc-950 dark:text-white">
                  {p.name}
                  <ArrowRight className="h-4 w-4 text-zinc-400 transition-transform duration-quick motion-ok:group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
                <span className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{p.line}</span>
              </Link>
            </li>
          ))}
        </Reveal>
      </Container>
    </section>
  );
}

// ─── A product's section: what it does, and a real screen of it ─────────────────────────────────────────────────

function FeatureSection({
  id,
  product,
  title,
  lead,
  points,
  free,
  links,
  visual,
  flip = false,
  band = false,
}: {
  id: string;
  product: SiteProduct;
  title: string;
  lead: ReactNode;
  points: ReactNode[];
  free: ReactNode;
  links: ReactNode;
  visual: ReactNode;
  flip?: boolean;
  band?: boolean;
}) {
  return (
    <Section id={id} labelledBy={`${id}-title`} band={band}>
      <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-16">
        <Reveal className={cx("lg:col-span-5", flip && "lg:order-2")}>
          <Eyebrow plain>
            <IconTile icon={product.icon} tone={PRODUCT_TILE[product.id]} size="sm" />
            {product.name}
          </Eyebrow>
          <h2 id={`${id}-title`} className="mk-h2 mt-5 text-zinc-950 dark:text-white">
            {title}
          </h2>
          <p className="mk-lead mt-5 text-zinc-600 dark:text-zinc-300">{lead}</p>
          <CheckList className="mt-8" items={points} />
          <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">{free}</p>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-1">{links}</div>
        </Reveal>
        <Reveal delay={120} className={cx("min-w-0 lg:col-span-7", flip && "lg:order-1")}>
          {visual}
        </Reveal>
      </div>
    </Section>
  );
}

function Shot({ name, alt }: { name: ShotName; alt: string }) {
  return <ProductShot name={name} alt={alt} />;
}

/** Jobs's two screens: the matches, with the tracker's Mission room laid over a corner on wide screens. */
function JobsVisual() {
  return (
    <div className="relative">
      <Shot name="jobs" alt="Jobs's matches: new jobs from companies' careers pages, each with how well it fits the resume." />
      <div className="absolute -bottom-14 -left-10 hidden w-[46%] xl:block">
        <ProductShot name="mission" alt="The tracker's Mission room: an application's stage, its next step and the prep for it." />
      </div>
    </div>
  );
}

// ─── More in your account ──────────────────────────────────────────────────────────────────────────────────────

function MoreTools({ products }: { products: SiteProduct[] }) {
  const more = products.filter((p) => !p.main);
  const app: Record<string, string> = { linkedin: "/linkedin", code: "/code", offer: "/offers", learning: "/learn" };
  return (
    <Section id="more" labelledBy="more-title">
      <SectionIntro
        id="more-title"
        eyebrow="More in your account"
        title="The steps around the interview, covered too."
        lead="Your LinkedIn profile, the coding round, the offer and the skills interviews test: four more AI tools in the same account, working from the same resume."
      />
      <Reveal as="ul" stagger className="mt-14 grid gap-px overflow-hidden rounded-2xl border mk-line bg-[rgb(var(--site-line))] sm:grid-cols-2 lg:grid-cols-4">
        {more.map((p) => (
          <li key={p.id} id={`${p.id}-ai`} className="scroll-mt-24 flex flex-col mk-surface p-6">
            <IconTile icon={p.icon} tone={PRODUCT_TILE[p.id]} />
            <h3 className="mk-h3 mt-5 text-zinc-950 dark:text-white">{p.name}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{p.line}</p>
            <div className="mt-5 flex flex-col items-start gap-1">
              {/* A tool with a page of its own (LinkedIn, D79) links there; the others start in the account. */}
              {p.href.startsWith("/#") ? (
                <ArrowLink to="/register" state={{ from: app[p.id] }}>
                  Use {p.name}
                </ArrowLink>
              ) : (
                <ArrowLink to={p.href}>See {p.name}</ArrowLink>
              )}
            </div>
          </li>
        ))}
      </Reveal>
    </Section>
  );
}

// ─── KashSec Academy ───────────────────────────────────────────────────────────────────────────────────────────

/** The Orbit team's free cybersecurity school, its own site (DECISIONS D70): what it has, and one way in. */
function KashSecSection() {
  return (
    <Section id="kashsec" labelledBy="kashsec-title">
      <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-6">
          <SectionIntro id="kashsec-title" eyebrow="Free from the Orbit team" title="KashSec Academy: cybersecurity, from zero." lead={KASHSEC_TAGLINE} />
          <KashSecChips className="mt-6" />
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
            <a href={kashsecUrl("front-page")} target="_blank" rel="noopener" className={buttonClass("secondary", "lg", "min-h-12 px-6")}>
              Start learning free <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">(opens KashSec in a new tab)</span>
            </a>
            <span className="text-sm text-zinc-600 dark:text-zinc-400">Free forever · Learn · Practise · Get hired</span>
          </div>
        </div>
        <div className="scene-host rounded-2xl border mk-line mk-surface p-6 sm:p-10 lg:col-span-6">
          <KashSecScene className="mx-auto w-full sm:w-96" />
        </div>
      </div>
    </Section>
  );
}

// ─── How it works ──────────────────────────────────────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps: Array<[string, string]> = [
    ["Create a free account", "About a minute. Tell Orbit what you're preparing for, and it shows you where to start."],
    ["Add your resume once", "Import the one you have or build one from a template. Practice, live answers, your score and your matches all start from it."],
    ["Practise, apply, interview", "Fix what the score shows, apply to jobs that fit, rehearse with the AI interviewer, and walk in ready."],
  ];
  return (
    <Section labelledBy="how-title" band>
      <SectionIntro id="how-title" eyebrow="How it works" title="Three steps, then every tool is ready." />
      <Reveal as="ol" stagger className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
        {steps.map(([title, text], i) => (
          <li key={title} className="relative border-t-2 border-zinc-900 pt-6 dark:border-white">
            <span className="text-sm font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
              <span className="sr-only">Step </span>
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="mk-h3 mt-3 text-zinc-950 dark:text-white">{title}</h3>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">{text}</p>
          </li>
        ))}
      </Reveal>
    </Section>
  );
}

// ─── Why Orbit ─────────────────────────────────────────────────────────────────────────────────────────────────

function WhyOrbit({ india }: { india: boolean }) {
  const reasons: Array<[typeof Layers, string, string]> = [
    [Layers, "One resume, every tool", "Add it once. Your practice answers, live answers, ATS score and job matches all work from the same resume, so nothing is typed twice."],
    [BadgeCheck, "Answers that show their sources", "A live answer lists the resume lines it used, and marks details that aren't in your documents so you check them before you say them."],
    [ShieldCheck, "Honest about where it's allowed", "Built for practice, and for interviews and calls where notes or AI help are allowed. Orbit doesn't claim to be undetectable, and isn't hidden from Task Manager or anyone who can see your screen."],
    [CalendarCheck, "Nothing to cancel", "Plans are paid once and never renew on their own. Credits never expire. If an AI action fails, its credit comes back."],
    [Wallet, "Priced for where you are", india ? "Prices in rupees, paid with UPI, a card or netbanking. Outside India, prices are in US dollars through PayPal." : "Prices in US dollars, paid through PayPal or a card where PayPal offers it. In India, prices are in rupees with UPI."],
    [MonitorSmartphone, "On your laptop and your phone", "Resume, Jobs and practice work in any browser. Live help works in Chrome and Edge, or in any call app with the Windows app (beta)."],
  ];
  const stages: Array<[string, string, string]> = [
    ["Prepare", "Practice, Coding practice, Learning", "Mock and video interviews, coding rounds, the skills they test"],
    ["Get noticed", "Resume, LinkedIn", "An ATS score, a tailored resume per job, a profile recruiters find"],
    ["Apply", "Jobs", "Matches from companies' own careers pages, the tracker, referral messages"],
    ["Interview", "Interview copilot", "Live answers from your resume, where AI help is allowed"],
    ["Decide", "Offers", india ? "What the offer pays each month, the market, how to ask for more" : "What the offer is worth, the market, how to ask for more"],
  ];
  return (
    <Section id="why" labelledBy="why-title">
      <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <SectionIntro
            id="why-title"
            eyebrow="Why Orbit"
            title="One account for the whole job search."
            lead="Most people piece their search together from separate apps. Orbit puts every stage in one place, working from one resume."
          />
          <div className="mt-10 overflow-hidden rounded-2xl border mk-line">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Every stage of a job search, and the Orbit tool for it</caption>
              <thead className="mk-band text-xs text-zinc-600 dark:text-zinc-400">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Stage</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">In Orbit</th>
                </tr>
              </thead>
              <tbody className="mk-divide">
                {stages.map(([stage, tools, what]) => (
                  <tr key={stage}>
                    <th scope="row" className="whitespace-nowrap px-4 py-3 align-top font-medium text-zinc-950 dark:text-white">{stage}</th>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                      <span className="block font-medium text-zinc-800 dark:text-zinc-200">{tools}</span>
                      {what}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <Reveal as="ul" stagger className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:col-span-7 lg:pt-2">
          {reasons.map(([Icon, title, text]) => (
            <li key={title}>
              <IconTile icon={Icon} />
              <h3 className="mt-4 text-base font-semibold text-zinc-950 dark:text-white">{title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">{text}</p>
            </li>
          ))}
        </Reveal>
      </div>
    </Section>
  );
}

// ─── Security and privacy ──────────────────────────────────────────────────────────────────────────────────────

function Security() {
  // Each one is something the privacy policy (public/privacy.html) and the shipped apps say and do.
  const items: Array<[typeof Layers, string, string]> = [
    [MicOff, "Audio is never stored", "It's streamed for live transcription and never written to disk. Screenshots are answered, then discarded."],
    [EyeOff, "Your content stays out of analytics", "Transcripts, documents and answers are never sent to analytics or crash reporting. You can turn off transcript storage."],
    [KeyRound, "Sign-in you control", "Two-step sign-in with an authenticator app, passkeys, and sign out of every device at once."],
    [LockKeyhole, "Payments by Razorpay and PayPal", "Card details go to Razorpay (India) or PayPal (elsewhere). Orbit never receives your full card number."],
    [Database, "Your data, your call", "Download everything as one file, or delete a session, a document or the whole account at any time."],
    [Cookie, "No advertising", "One sign-in cookie, no advertising cookies, and your data is never sold or used for ads."],
    [Laptop, "A careful desktop app", "Your sign-in stays in the Windows Credential Manager, updates are checked against Orbit's signing key before they install, and no AI keys live on your computer."],
  ];
  return (
    <Section id="security" labelledBy="security-title" band>
      <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <SectionIntro
            id="security-title"
            eyebrow="Security and privacy"
            title="Your data, kept to what helps you."
            lead="Orbit keeps only what it needs to help with your search, and you can delete any of it."
          />
          <div className="mt-8 flex flex-col items-start gap-1">
            <ArrowLink to={PRIVACY_PAGE}>Read the privacy policy</ArrowLink>
            <ArrowLink to={COOKIE_PAGE}>Cookie policy</ArrowLink>
            <ArrowLink to="/technical">How the live answer works</ArrowLink>
          </div>
        </div>
        <Reveal as="ul" stagger className="grid gap-px overflow-hidden rounded-2xl border mk-line bg-[rgb(var(--site-line))] sm:grid-cols-2 lg:col-span-8">
          {items.map(([Icon, title, text], i) => (
            <li key={title} className={cx("mk-surface p-6", i === items.length - 1 && "sm:col-span-2")}>
              <IconTile icon={Icon} size="sm" />
              <h3 className="mt-4 text-[0.9375rem] font-semibold text-zinc-950 dark:text-white">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{text}</p>
            </li>
          ))}
        </Reveal>
      </div>
    </Section>
  );
}

// ─── Questions ─────────────────────────────────────────────────────────────────────────────────────────────────────

function Faq({ welcome, stats, cards = false, abroad = false, paypal = false, loaded = true }: {
  welcome: WelcomeGrant | null; stats: JobStats | null; cards?: boolean; abroad?: boolean; paypal?: boolean;
  /** The packs (and so how they're paid) have arrived: until then nothing is said about payment methods abroad. */
  loaded?: boolean;
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
          notes or AI help, and breaking their rules can cost you the job. Orbit doesn't hide from Task Manager, other
          apps or anyone who can see your screen, and it doesn't claim to be undetectable.
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
      paypal ? (
        <p>
          There's no subscription. Outside India, plans and packs are priced in US dollars and paid through PayPal: with
          your PayPal account, or a debit or credit card where PayPal offers it. What you bought is added as soon as
          PayPal confirms the payment, usually within seconds. Nothing renews, and credits never expire.
        </p>
      ) : cards ? (
        <p>
          There's no subscription. When you want more interview minutes or AI credits, you buy a pack through Razorpay:
          {india
            ? " UPI, a debit or credit card, netbanking or a wallet."
            : abroad
              ? " a debit or credit card from any country (in US dollars outside India)."
              : " for now an Indian card, UPI or netbanking; cards from other countries are coming soon."}{" "}
          The credits are added as soon as Razorpay confirms the payment, usually within seconds. Nothing renews, and
          what you buy never expires.
        </p>
      ) : india ? (
        <p>
          There's no subscription. When you want more interview minutes or AI credits, you buy a pack through Razorpay
          with a UPI app, a card or netbanking, and the credits are added as soon as the payment goes through. Nothing
          renews, and what you buy never expires.
        </p>
      ) : !loaded ? (
        <p>
          There's no subscription, nothing renews, and what you buy never expires. Everything free works the same
          wherever you are.
        </p>
      ) : (
        <p>
          There's no subscription, nothing renews, and what you buy never expires. Today packs are priced in Indian
          rupees and paid through Razorpay; card payments for other countries are coming soon. Everything free works the same
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
        Yes. Resume, Jobs and practice work in your phone's browser. For help during a call, open Orbit on a
        laptop: Chrome and Edge can listen to a meeting tab, and the Orbit app for Windows (beta) can listen to any call app.
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
        <a href={PRIVACY_PAGE} className="underline underline-offset-2">
          Privacy policy
        </a>
      </p>,
    ],
  ];
  return (
    <Section id="faq" labelledBy="faq-title" band>
      <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-4">
          <SectionIntro id="faq-title" eyebrow="Questions" title="Questions people ask first." />
          <p className="mt-5 text-[0.9375rem] text-zinc-600 dark:text-zinc-400">
            Something else?{" "}
            <Link to={CONTACT_PAGE} className={cx("rounded font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
              Contact us
            </Link>
            , a person reads every message.
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

// ─── The closing call to action ────────────────────────────────────────────────────────────────────────────────

function FinalCta({ freeLine, innerRef }: { freeLine: string; innerRef: RefObject<HTMLElement | null> }) {
  return (
    <CtaBand
      id="start-title"
      innerRef={innerRef}
      title="Start with one question."
      text="Answer a common interview question and see what to improve, before you sign up for anything."
      actions={
        <>
          <Link to="/warmup" className={inkButton.primary}>
            Try a practice question <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link to="/register" className={inkButton.secondary}>
            Create a free account
          </Link>
        </>
      }
      footnote={freeLine}
    />
  );
}

// ─── The page ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function LandingPage() {
  const country = useCountry();
  const india = isIndia(country);
  const words = regionWords(country);
  const welcome = useWelcomeGrant();
  const packs = usePublic(() => api.listPacks());
  const monthly = usePublic(() => api.listMonthly());
  const stats = usePublic(() => api.jobStats());
  const motion = useMotion();
  const { hash } = useLocation();
  const heroCtas = useRef<HTMLDivElement>(null);
  const finalCta = useRef<HTMLElement>(null);
  // "/#pricing" from another page or the menu: scroll there once the page is drawn.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    el?.scrollIntoView({ behavior: motion === "full" ? "smooth" : "auto", block: "start" });
  }, [hash, motion]);

  const freeLine = freeLineFor(welcome);
  const counts = stats && stats.jobs >= SHOW_COUNTS_FROM ? stats : null;
  const products = siteProducts(india);
  const byId = Object.fromEntries(products.map((p) => [p.id, p])) as Record<SiteProduct["id"], SiteProduct>;

  return (
    <PublicLayout>
      <Hero freeLine={freeLine} freeLineLike={freeLineFor(welcome ?? WELCOME_LIKE)} ctas={heroCtas} />
      <ProductIndex products={products} />

      <FeatureSection
        id="copilot"
        product={byId.copilot}
        band
        title="Answers from your own resume, as the question is asked."
        lead="In a live interview where AI help is allowed, Orbit hears the interviewer's question and suggests an answer in plain spoken words, built from your resume and the job description. You glance at it, then answer in your own words."
        points={[
          "Hears a Chrome or Edge meeting tab, or any call app with the Windows app (beta)",
          "Shows the resume lines each answer used, and marks details that aren't in your documents",
          "Coding questions and screenshots: what to say, the code and its complexity",
          "Shorter, longer or simpler, in one tap",
        ]}
        free={welcome?.interview_minutes ? `Live sessions use interview minutes; a new account gets ${welcome.interview_minutes} free.` : "Live sessions use interview minutes."}
        links={
          <>
            <ArrowLink to="/technical">How the live answer works</ArrowLink>
            <a
              href={WINDOWS_APP_URL}
              className={cx("group inline-flex min-h-10 items-center gap-1.5 rounded-lg text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white", focusRing)}
            >
              <Download className="h-4 w-4" aria-hidden="true" /> Windows app{WINDOWS_APP_BETA ? " (beta)" : ""}
            </a>
          </>
        }
        visual={<Shot name="copilot" alt="Orbit's live session: the transcript, the interviewer's question and a suggested answer with the resume lines it used." />}
      />

      <FeatureSection
        id="practice"
        product={byId.practice}
        flip
        title="Practise out loud with an AI interviewer."
        lead="Pick a role, a company's style or a round. The AI interviewer asks, follows up on what you actually said, and scores each answer, with the parts worth saying again."
        points={[
          `${words.screen[0]!.toUpperCase()}${words.screen.slice(1)}s, technical, behavioural and salary rounds`,
          "A video interview with an AI interviewer you see and hear",
          "A story bank for “Tell me about a time…” questions",
          "Your weakest answers asked again, with follow-ups",
        ]}
        free="Mock interviews use interview minutes. A practice question with instant feedback is free, no account needed."
        links={<ArrowLink to="/warmup">Try a practice question</ArrowLink>}
        visual={<Shot name="practice" alt="A finished mock interview's scorecard: a score for each answer and what to say better." />}
      />

      <FeatureSection
        id="resume"
        product={byId.resume}
        band
        title="See your resume the way screening software does."
        lead="Most companies' software reads a resume before a person does. Resume scores yours out of 100, shows what's missing for the job you want, and fixes it with you. It keeps your numbers and never makes one up."
        points={[
          "Import your resume, or start from a template",
          "A copy tailored for each job, with every change shown",
          "Word and PDF downloads, and cover letters",
        ]}
        free="Editing, the ATS score and downloads are free. AI rewrites use AI credits."
        links={<ArrowLink to={RESUME_AI_HOME}>See Resume</ArrowLink>}
        visual={<Shot name="resume" alt="The Resume editor: a resume, its ATS score out of 100 and the fixes it suggests." />}
      />

      <FeatureSection
        id="jobs"
        product={byId.jobs}
        flip
        title="New jobs that fit you, and a room for every application."
        lead={
          counts
            ? `${formatNumber(counts.jobs, country)} new jobs from ${formatNumber(counts.companies, country)} companies in the last ${counts.days} days, from their own careers pages and job boards that allow it, each with how well it matches your resume.`
            : "The latest openings from companies' own careers pages and job boards that allow it, each with how well it matches your resume."
        }
        points={[
          india ? "Freshers' and internship filters, your city or remote" : "Entry-level and internship filters, your city or remote",
          "A Mission room for each application: its stage, the next step and the prep",
          "Messages that ask for a referral, written from your resume",
        ]}
        free="Matches and the tracker are free, and so are a few AI fit checks a day."
        links={<ArrowLink to={JOBS_AI_HOME}>See Jobs</ArrowLink>}
        visual={<JobsVisual />}
      />

      <MoreTools products={products} />
      <KashSecSection />
      <HowItWorks />
      <WhyOrbit india={india} />
      <Security />
      <PricingSection packs={packs} monthly={monthly} welcome={welcome} stats={stats} />
      <Faq welcome={welcome} stats={stats} cards={packs?.[0]?.checkout === "razorpay"} abroad={!!packs?.[0]?.international}
        paypal={packs?.[0]?.checkout === "paypal"} loaded={packs !== null} />
      <FinalCta freeLine={freeLine} innerRef={finalCta} />
      <StickyCta after={heroCtas} before={finalCta} line={welcome ? "Free to start. No card." : "Free to start."} />
    </PublicLayout>
  );
}
