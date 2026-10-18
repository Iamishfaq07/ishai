import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { EngineeringTelemetry } from "@orbit/types";
import { ArrowRight, AudioLines, Briefcase, Code2, Download, EyeOff, FileText, LIVE_LANGUAGES, Languages, LockKeyhole, MonitorSmartphone, SlidersHorizontal, Target, buttonClass, cx, focusRing } from "@orbit/ui";
import { COPILOT_FAQ } from "../../worker/faqs/interview-copilot.js";
import { StoreBadge } from "../components/StoreBadge";
import { api } from "../lib/api";
import { USE_WHERE_ALLOWED } from "../lib/contact";
import { DESKTOP_BETA, DESKTOP_DOWNLOAD_URL, MS_STORE_LIVE } from "../lib/desktop";
import { WELCOME_LIKE, useWelcomeGrant } from "../lib/welcome";
import { PRACTICE_PAGE } from "../marketing/catalog";
import { CrossSell, FactsBand, FaqBlock, FinalCta, HeroShowcase, StepsWithUI, ToolkitGrid, type Fact } from "../marketing/kit";
import { LiveAnswerDemo } from "../marketing/LiveAnswerDemo";
import { PublicLayout } from "../marketing/PublicLayout";
import { ArrowLink, CheckList, IconTile, Section, SectionIntro } from "../marketing/primitives";
import { SameBox } from "../marketing/SameBox";
import { StickyCta } from "../marketing/StickyCta";
import { JOBS_AI_HOME } from "./jobs/paths";
import { RESUME_AI_HOME } from "./resume/paths";
import { AnswerStepArt, CodeArt, CompactWindowArt, DocsStepArt, LanguagesArt, ListenStepArt, RewriteArt, SourcesArt } from "./CopilotPublicArt";

/** Sign-up and sign-in from here come back to the copilot's setup. */
const BACK_TO_SETUP = { from: "/start" };

/** The languages a live session can be in besides auto-detect: English and nine more, plus Hinglish (D62). */
const LANGUAGES = LIVE_LANGUAGES.filter((l) => l.value !== "auto" && l.value !== "hinglish").length;

/** The hero's line on what's free: the free minutes once the server says how many. */
function freeNote(minutes: number) {
  return (
    <p>
      <strong className="font-medium text-zinc-900 dark:text-white">Live sessions use interview minutes.</strong>{" "}
      {minutes ? `A new account gets ${minutes} free; more` : "More"} come with a plan or a credit pack, paid once.{" "}
      <Link to="/pricing" className={cx("rounded font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
        See pricing
      </Link>
    </p>
  );
}

/** The measured speed from real sessions (the same numbers as /technical), once the server has them. */
function useFirstWord(): number | null {
  const [t, setT] = useState<EngineeringTelemetry | null>(null);
  useEffect(() => {
    api.engineeringTelemetry().then(setT, () => undefined);
  }, []);
  return t?.first_word?.p50_ms ?? null;
}

/**
 * /interview-copilot: the live interview copilot for signed-out visitors (D73), built with the product pages' section
 * kit (DECISIONS D79): the live answer streaming in (the front page's LiveAnswerDemo), the facts (the languages from
 * the app's own list, the measured speed from the server), three steps, the toolkit as working pieces, where it's for
 * honestly, the questions, what comes next and one last action. Nothing here calls the AI.
 */
export function CopilotPublicPage() {
  const welcome = useWelcomeGrant();
  const minutes = welcome?.interview_minutes ?? 0;
  const firstWord = useFirstWord();
  const heroCtas = useRef<HTMLDivElement>(null);
  const finalCta = useRef<HTMLElement>(null);
  const facts: Fact[] = [
    { value: LANGUAGES, label: "interview languages, plus Hinglish" },
    firstWord
      ? { value: `${(firstWord / 1000).toFixed(1)} s`, label: "to an answer's first word, the median of real sessions" }
      : { value: 2, label: "ways to listen: a Chrome or Edge meeting tab, or any call app on Windows" },
    { value: 1, label: "tap to make an answer shorter, longer or simpler" },
    { value: 0, label: "seconds of your audio kept: it's turned into text as it streams" },
  ];
  return (
    <PublicLayout authState={BACK_TO_SETUP} context="Interview copilot">
      <HeroShowcase
        product={{ id: "copilot", name: "Interview copilot", icon: AudioLines }}
        title={["Live answers,", "from your own resume."]}
        lead="In an interview or call where AI help is allowed, Orbit hears the interviewer's question and suggests an answer in plain spoken words, built from your resume and the job description. You glance at it, then answer in your own words."
        honest={USE_WHERE_ALLOWED}
        ctas={heroCtas}
        actions={
          <>
            <Link to="/register" state={BACK_TO_SETUP} className={buttonClass("primary", "lg", "min-h-12 px-6")}>
              Start free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/technical" className={buttonClass("secondary", "lg", "min-h-12 px-6")}>
              How the live answer works
            </Link>
          </>
        }
        note={<SameBox like={freeNote(minutes || WELCOME_LIKE.interview_minutes)} answered={minutes}>{freeNote(minutes)}</SameBox>}
        visual={<LiveAnswerDemo className="mx-auto max-w-[34rem] lg:mr-0" />}
      />

      <FactsBand label="The copilot in numbers" facts={facts} />

      <StepsWithUI
        id="steps-title"
        eyebrow="How it works"
        title="Set up once, then talk."
        steps={[
          { title: "Add your resume and the job", text: "Upload your resume and paste the job description. Add a few stories if you like; Orbit uses only what you give it.", ui: <DocsStepArt /> },
          { title: "Start a session as the call begins", text: "In Chrome or Edge, Orbit listens to the meeting tab you choose. The Orbit app for Windows can listen to any call app.", ui: <ListenStepArt /> },
          { title: "Glance, then answer in your words", text: "When a question is asked, a suggested answer appears in plain spoken words. After the call, the notes and a review stay in your account.", ui: <AnswerStepArt /> },
        ]}
      />

      <ToolkitGrid
        id="toolkit-title"
        eyebrow="The toolkit"
        title="An answer you can say, as the question is asked."
        lead="Grounded in your own documents, in the words you'd use out loud. You stay the one answering."
        band
        tools={[
          { title: "Sources from your resume", icon: FileText, text: "Each answer lists the lines of your documents it used. A detail that isn't in them is marked as an example for you to swap, never passed off as yours.", widget: <SourcesArt />, wide: true },
          { title: "In your language", icon: Languages, text: "Questions heard and answers written in the language of the call, or answers in another language you pick.", widget: <LanguagesArt /> },
          { title: "Shorter, longer, simpler", icon: SlidersHorizontal, text: "One tap rewrites the answer the way you need it, and you choose how long answers are.", widget: <RewriteArt /> },
          { title: "Coding questions", icon: Code2, text: "For a coding or system-design question: what to say first, the code and its complexity. A screenshot of a problem works too.", widget: <CodeArt /> },
          { title: "The Windows app's compact window", icon: MonitorSmartphone, text: "Orbit for Windows listens to any call app and keeps a small window on top of it, as see-through as you like.", widget: <CompactWindowArt /> },
        ]}
      />

      <Section labelledBy="copilot-honest-title">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <SectionIntro id="copilot-honest-title" eyebrow="Where AI help is allowed" title="Built for practice, and for calls that allow it." />
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
              <ArrowLink to="/technical">Measured answer speed</ArrowLink>
              {MS_STORE_LIVE ? (
                <StoreBadge className="text-zinc-700 dark:text-zinc-300" />
              ) : (
                <a
                  href={DESKTOP_DOWNLOAD_URL}
                  className={cx("group inline-flex min-h-10 items-center gap-1.5 rounded-lg text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white", focusRing)}
                >
                  <Download className="h-4 w-4" aria-hidden="true" /> Orbit for Windows{DESKTOP_BETA ? " (beta)" : ""}
                </a>
              )}
            </div>
          </div>
          <div className="rounded-2xl border mk-line mk-surface p-6 sm:p-8 lg:col-span-7">
            <h3 className="flex items-center gap-3 text-lg font-semibold text-zinc-950 dark:text-white">
              <IconTile icon={EyeOff} size="sm" /> Where it's for, honestly
            </h3>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-300">
              Practising is always fine. In a real interview, call or test, some employers, colleges and exams don't allow
              notes or AI help, and breaking their rules can cost you the job. Check first.
            </p>
            <CheckList
              className="mt-5"
              items={[
                "It doesn't hide from Task Manager, other apps or anyone who can see your screen",
                "It never claims to be undetectable, and it never answers for you",
                "Built for practice, and for calls where notes or AI help are allowed",
              ]}
            />
            <h3 className="mt-8 flex items-center gap-3 text-base font-semibold text-zinc-950 dark:text-white">
              <IconTile icon={LockKeyhole} size="sm" /> Your audio and documents
            </h3>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-300">
              Audio is turned into text as it streams and is never stored. Your documents and session notes stay in your
              account, and you can delete any of them, or the whole account, at any time.
            </p>
          </div>
        </div>
      </Section>

      <FaqBlock id="faq-title" items={COPILOT_FAQ} />

      <CrossSell
        id="next-title"
        eyebrow="Before the real one"
        title="Practise with the same answers first."
        lead="One account has the copilot, mock interviews, Resume AI and Jobs AI, all working from the same resume."
        items={[
          { product: { id: "practice", name: "Practice", icon: Target }, title: "A mock interview first", text: "An AI interviewer that asks out loud and follows up, then a score for every answer.", to: PRACTICE_PAGE, cta: "See mock interviews" },
          { product: { id: "resume", name: "Resume AI", icon: FileText }, title: "The resume it answers from", text: "An ATS score out of 100 and the fixes, so the lines it quotes are your best ones.", to: RESUME_AI_HOME, cta: "See Resume AI" },
          { product: { id: "jobs", name: "Jobs AI", icon: Briefcase }, title: "The interviews to get", text: "New jobs that fit your resume, from companies' own careers pages, with a tracker.", to: JOBS_AI_HOME, cta: "See Jobs AI" },
        ]}
      />

      <FinalCta
        id="cta-title"
        innerRef={finalCta}
        title={["Get your next answer ready.", "In your own words."]}
        text="Create a free Orbit account, add your resume and the job, and start a session when your call begins."
        primary={{ to: "/register", label: "Start free", state: BACK_TO_SETUP }}
        secondary={{ to: PRACTICE_PAGE, label: "Practise first" }}
        footnote="No card needed, and nothing renews."
      />
      <StickyCta after={heroCtas} before={finalCta} line="Live answers from your resume." />
    </PublicLayout>
  );
}
