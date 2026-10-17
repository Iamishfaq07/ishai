import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { CreditPack } from "@orbit/types";
import { ArrowRight, CountUp, FileText, Palette, Send, Wand2, buttonClass, cx, focusRing, isIndia, regionWords } from "@orbit/ui";
import { api } from "../../lib/api";
import { useCountry } from "../../lib/country";
import { useWelcomeGrant } from "../../lib/welcome";
import { JOBS_AI_HOME } from "../jobs/paths";
import { TEMPLATES } from "./model";
import { RESUME_AI_HOME } from "./paths";
import { CtaBand, FeatureGrid, ProductHero, inkButton, type Feature } from "../../marketing/ProductPage";
import { PublicLayout } from "../../marketing/PublicLayout";
import { resumeAiFeatures, scoreTone } from "./product";
import { MM_TO_PX, PAGE_MM, ResumePreview } from "./ResumePreview";
import { sampleResume } from "./sample";

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
        (pack.currency === "USD" && pack.price_text
          ? ` More AI credits come in packs, from ${pack.price_text} for ${pack.resume_credits}, and they never expire.`
          : ` More AI credits come in UPI packs, from ₹${pack.price_inr.toLocaleString("en-IN")} for ${pack.resume_credits}, and they never expire.`)}
    </p>
  );
}

/** The sample resume at real size, scaled to its column and cut off with a fade, with its ATS score beside it. It's
 *  written for where the visitor applies (sample.ts). */
function SampleResume() {
  const sample = sampleResume(useCountry());
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const pageWidth = PAGE_MM[sample.design.page].w * MM_TO_PX;
  const pageHeight = PAGE_MM[sample.design.page].h * MM_TO_PX;
  useLayoutEffect(() => {
    const measure = () => setScale(Math.min(1, (box.current?.clientWidth ?? pageWidth) / pageWidth));
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [pageWidth]);
  const { score } = sample;
  // Solid, not glass: the resume's text would show through.
  const floating = "mk-menu-shadow absolute rounded-xl mk-surface";
  return (
    <figure className="relative mx-auto w-full min-w-0 max-w-[30rem] lg:mr-0">
      <div
        ref={box}
        role="img"
        aria-label="A sample resume made with Resume AI"
        className="mk-float relative overflow-hidden rounded-xl bg-white"
        style={{
          height: pageHeight * scale * 0.64,
          maskImage: "linear-gradient(to bottom, #000 58%, transparent 96%)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 58%, transparent 96%)",
        }}
      >
        <div aria-hidden="true" style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "max-content" }}>
          <ResumePreview data={sample.data} design={sample.design} />
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
 * sample, and "Start free", which signs up and comes back here. Nothing here calls the AI. The public site's product
 * page template (marketing/ProductPage.tsx) inside the shared layout.
 */
export function ResumeAiPublicPage() {
  const country = useCountry();
  const india = isIndia(country);
  const features: Feature[] = [
    ...resumeAiFeatures(country).map(({ icon, title, text }) => ({ icon, title, text })),
    {
      icon: Palette,
      title: `${TEMPLATES.length} templates, Word and PDF`,
      text: `Classic, Modern, ${regionWords(country).campusTemplate}, Harvard and more, downloaded as a Word file or a PDF ready to send.`,
    },
    {
      icon: Send,
      title: "Outreach, in Jobs AI",
      text: (
        <>
          {india
            ? "Referral requests, emails to HR and your Naukri and LinkedIn profiles are written from your resume in"
            : `Referral requests, ${regionWords(country).coldEmails} and your LinkedIn profile are written from your resume in`}{" "}
          <Link to={JOBS_AI_HOME} className={cx("font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
            Jobs AI
          </Link>
          , for the jobs you find there.
        </>
      ),
    },
  ];
  return (
    <PublicLayout authState={BACK_HERE} context="Resume AI">
      <ProductHero
        product={{ id: "resume", name: "Resume AI", icon: FileText }}
        title="Your resume, ready for every job."
        lead="An ATS score, AI rewrites for every job, and interview prep from your own resume."
        detail="Most resumes are read by screening software before a person sees them. Resume AI scores yours the way that software reads it, then helps you fix it for each job you apply to. It keeps your numbers and never makes one up."
        actions={
          <>
            <Link to="/register" state={BACK_HERE} className={buttonClass("primary", "lg", "min-h-12 px-6")}>
              Start free <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link to="/login" state={BACK_HERE} className={buttonClass("secondary", "lg", "min-h-12 px-6")}>
              I have an account
            </Link>
          </>
        }
        note={<FreeNote />}
        visual={<SampleResume />}
      />
      <FeatureGrid
        id="features-title"
        eyebrow="What Resume AI does"
        title="Every change shown, and any of them undone."
        lead="You see every change the AI makes to your resume, and you can undo any of them."
        features={features}
        band
      />
      <CtaBand
        id="cta-title"
        title="See what your resume scores."
        text="Create a free Orbit account, import the resume you have, and get its ATS score in a minute. The same account has Orbit's interview copilot for when the interviews come."
        actions={
          <Link to="/register" state={BACK_HERE} className={inkButton.primary}>
            Start free <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        }
        footnote={
          <>
            Looking for jobs too?{" "}
            <Link to={JOBS_AI_HOME} className={cx("rounded font-medium text-white underline underline-offset-2", focusRing)}>
              Jobs AI
            </Link>{" "}
            finds the latest openings that fit your resume.
          </>
        }
      />
    </PublicLayout>
  );
}
