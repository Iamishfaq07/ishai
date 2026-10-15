import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CreditPack } from "@orbit/types";
import { ArrowRight, OrbitWordmark, Palette, Send, Sparkles, Wand2, buttonClass, cx, focusRing,
  Reveal,
  CountUp,
} from "@orbit/ui";
import { api } from "../../lib/api";
import { useWelcomeGrant } from "../../lib/welcome";
import { JOBS_AI_HOME } from "../jobs/paths";
import { TEMPLATES } from "./model";
import { RESUME_AI_HOME } from "./paths";
import { AiPill } from "../../components/products";
import { Footer } from "../../components/Footer";
import { SiteMenu } from "../../components/SiteMenu";
import { RESUME_AI_FEATURES, scoreTone } from "./product";
import { MM_TO_PX, PAGE_MM, ResumePreview } from "./ResumePreview";
import { SAMPLE_RESUME } from "./sample";

/** Sign-up and sign-in from here come back to Resume AI. */
const BACK_HERE = { from: RESUME_AI_HOME };

/** The cheapest pack with resume credits, for the honest "more credits cost this" line. */
function useCheapestResumePack(): CreditPack | null {
  const [pack, setPack] = useState<CreditPack | null>(null);
  useEffect(() => {
    api
      .listPacks()
      .then((packs) => setPack(packs.filter((p) => p.resume_credits > 0).sort((a, b) => a.price_inr - b.price_inr)[0] ?? null))
      .catch(() => undefined);
  }, []);
  return pack;
}

/** What a new account gets, said plainly: the free AI credit (from the server), what never costs one, and packs. */
function FreeNote({ className }: { className?: string }) {
  const welcome = useWelcomeGrant();
  const pack = useCheapestResumePack();
  const credits = welcome?.resume_credits ?? 0;
  return (
    <p className={cx("text-sm text-zinc-600 dark:text-zinc-400", className)}>
      {credits > 0 && (
        <strong className="font-medium text-zinc-900 dark:text-white">
          {credits === 1 ? "Your first AI action is free." : `Your first ${credits} AI actions are free.`}{" "}
        </strong>
      )}
      Typing, the ATS score and Word and PDF downloads never use credits.
      {pack &&
        ` More AI credits come in UPI packs, from ₹${pack.price_inr.toLocaleString("en-IN")} for ${pack.resume_credits}, and they never expire.`}
    </p>
  );
}

/** The sample resume at real size, scaled to its column and cut off with a fade, with its ATS score beside it. */
function SampleResume() {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const pageWidth = PAGE_MM[SAMPLE_RESUME.design.page].w * MM_TO_PX;
  const pageHeight = PAGE_MM[SAMPLE_RESUME.design.page].h * MM_TO_PX;
  useLayoutEffect(() => {
    const measure = () => setScale(Math.min(1, (box.current?.clientWidth ?? pageWidth) / pageWidth));
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [pageWidth]);
  const { score } = SAMPLE_RESUME;
  // Solid, not glass: the resume's text would show through.
  const floating = "absolute rounded-2xl bg-white shadow-xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-white/10";
  return (
    <figure className="relative mx-auto w-full min-w-0 max-w-[30rem] lg:mr-0">
      <span aria-hidden="true" className="pointer-events-none absolute -inset-8 rounded-[3rem] bg-gradient-to-br from-indigo-500/25 via-aurora-400/10 to-transparent blur-3xl" />
      <div
        ref={box}
        role="img"
        aria-label="A sample resume made with Resume AI"
        className="relative overflow-hidden rounded-xl shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
        style={{
          height: pageHeight * scale * 0.64,
          maskImage: "linear-gradient(to bottom, #000 58%, transparent 96%)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 58%, transparent 96%)",
        }}
      >
        <div aria-hidden="true" style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "max-content" }}>
          <ResumePreview data={SAMPLE_RESUME.data} design={SAMPLE_RESUME.design} />
        </div>
      </div>
      {score > 0 && (
        <div className={cx(floating, "-right-2 -top-4 flex items-center gap-3 p-3 sm:-right-6")}>
          <span className={cx("flex h-12 w-12 flex-col items-center justify-center rounded-xl ring-1", scoreTone(score))}>
            <CountUp to={score} from={54} className="font-display text-xl font-semibold leading-none" />
            <span className="text-[0.625rem] leading-none">ATS</span>
          </span>
          <span className="pr-1 text-xs leading-tight">
            <span className="block font-medium">ATS score</span>
            <span className="text-zinc-500 dark:text-zinc-400">out of 100</span>
          </span>
        </div>
      )}
      <div className={cx(floating, "inset-x-3 bottom-0 p-3.5 sm:inset-x-auto sm:-left-10 sm:bottom-3 sm:w-72")}>
        <p className="flex items-center gap-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300">
          <Wand2 className="h-3.5 w-3.5" aria-hidden /> AI rewrite
        </p>
        <p className="mt-1.5 text-xs text-zinc-500 line-through decoration-zinc-400/70 dark:text-zinc-400">
          Worked on Power BI dashboards for 40+ store managers to replace 12 weekly Excel reports.
        </p>
        <p className="mt-1 text-xs font-medium text-zinc-800 dark:text-zinc-100">
          Built a Power BI sales dashboard used by 40+ store managers, replacing 12 weekly Excel reports.
        </p>
        <p className="mt-1.5 text-[0.6875rem] text-zinc-500 dark:text-zinc-400">It keeps your numbers and never makes one up.</p>
      </div>
      <figcaption className="sr-only">
        A sample resume for a data analyst, scored {score} out of 100, with one of its bullets rewritten by the AI.
      </figcaption>
    </figure>
  );
}

/**
 * Resume AI for signed-out visitors (at /resume-ai, where a signed-in person gets their resumes): what it does, a
 * sample, and "Start free", which signs up and comes back here. Nothing here calls the AI.
 */
export function ResumeAiPublicPage() {
  return (
    <div className="min-h-full overflow-x-clip">
      <header className="relative mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 sm:px-6">
        <Link to="/" className={cx("rounded-lg", focusRing)} aria-label="Orbit home">
          <OrbitWordmark size={26} />
        </Link>
        <span className="hidden h-5 w-px bg-zinc-300 sm:block dark:bg-white/15" aria-hidden="true" />
        <span className="hidden items-center gap-1 font-display text-sm font-semibold sm:inline-flex">
          Resume <AiPill />
        </span>
        <nav aria-label="Account" className="ml-auto flex items-center gap-2">
          <SiteMenu />
          <Link to="/login" state={BACK_HERE} className={buttonClass("secondary", "md", "hidden min-h-11 sm:inline-flex")}>
            Sign in
          </Link>
          <Link to="/register" state={BACK_HERE} className={buttonClass("primary", "md", "min-h-11")}>
            Start free
          </Link>
        </nav>
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <section aria-labelledby="hero-title" className="grid grid-cols-[minmax(0,1fr)] items-center gap-12 pb-12 pt-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:pb-20 lg:pt-12">
          <div className="animate-fade-up">
            <p className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-200">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Orbit Resume AI
            </p>
            <h1 id="hero-title" className="mt-5 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
              Build a resume that <span className="text-gradient">gets interviews.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-zinc-600 dark:text-zinc-300">
              ATS score, AI rewrites for every job, and interview prep from your own resume.
            </p>
            <p className="mt-3 max-w-xl text-sm text-zinc-500 dark:text-zinc-400">
              Most resumes are read by screening software before a person sees them. Resume AI scores yours the way
              that software reads it, then helps you fix it for each job you apply to.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/register" state={BACK_HERE} className={buttonClass("primary", "lg", "min-h-11")}>
                Start free <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link to="/login" state={BACK_HERE} className={buttonClass("secondary", "lg", "min-h-11")}>
                I have an account
              </Link>
            </div>
            <FreeNote className="mt-5 max-w-xl" />
          </div>
          <SampleResume />
        </section>

        <section aria-labelledby="features-title" className="border-t border-zinc-200/70 pt-12 dark:border-white/5">
          <h2 id="features-title" className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            What Resume AI does
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
            You see every change the AI makes to your resume, and any of them can be undone.
          </p>
          <Reveal as="ul" stagger className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {RESUME_AI_FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="glass-panel rounded-2xl p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/20 to-aurora-400/10 text-indigo-600 ring-1 ring-indigo-500/20 dark:text-indigo-300">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <h3 className="mt-4 font-display text-base font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{text}</p>
              </li>
            ))}
            <li className="glass-panel rounded-2xl p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-500/10 text-zinc-600 ring-1 ring-zinc-500/15 dark:text-zinc-300">
                <Palette className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold">{TEMPLATES.length} templates, Word and PDF</h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Classic, Modern, Campus, Harvard and more, downloaded as a Word file or a PDF ready to send.
              </p>
            </li>
            <li className="glass-panel rounded-2xl p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-500/10 text-zinc-600 ring-1 ring-zinc-500/15 dark:text-zinc-300">
                <Send className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold">Outreach, in Jobs AI</h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Referral requests, emails to HR and your Naukri and LinkedIn profiles are written from your resume in{" "}
                <Link to={JOBS_AI_HOME} className={cx("font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
                  Jobs AI
                </Link>
                , for the jobs you find there.
              </p>
            </li>
          </Reveal>
        </section>

        <section className="glass-panel gradient-border relative mt-14 overflow-hidden rounded-3xl p-6 text-center sm:p-10">
          <span aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
          <h2 className="relative font-display text-2xl font-semibold tracking-tight sm:text-3xl">See what your resume scores</h2>
          <p className="relative mx-auto mt-2 max-w-xl text-sm text-zinc-600 dark:text-zinc-300">
            Create a free Orbit account, import the resume you have, and get its ATS score in a minute. The same
            account has Orbit's interview copilot for when the interviews come.
          </p>
          <Link to="/register" state={BACK_HERE} className={buttonClass("primary", "lg", "relative mt-6 min-h-11")}>
            Start free <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <p className="relative mt-5 text-xs text-zinc-500 dark:text-zinc-400">
            Looking for jobs too?{" "}
            <Link to={JOBS_AI_HOME} className={cx("font-medium text-indigo-600 hover:underline dark:text-indigo-400", focusRing)}>
              Jobs AI
            </Link>{" "}
            finds the latest openings that fit your resume.
          </p>
        </section>
      </main>

      <Footer />
    </div>
  );
}
