import { Link } from "react-router-dom";
import {
  ArrowRight,
  Building2,
  ChartColumn,
  Clock,
  Languages,
  MessagesSquare,
  NotebookPen,
  RefreshCw,
  Scale,
  Target,
  Users,
  Video,
  buttonClass,
  cx,
  focusRing,
  isIndia,
  regionWords,
} from "@orbit/ui";
import { useCountry } from "../lib/country";
import { useWelcomeGrant } from "../lib/welcome";
import { CtaBand, FeatureGrid, ProductHero, inkButton, type Feature } from "../marketing/ProductPage";
import { ProductShot } from "../marketing/ProductShot";
import { PublicLayout } from "../marketing/PublicLayout";
import { ArrowLink, IconTile, Section, SectionIntro } from "../marketing/primitives";

/** Sign-up and sign-in from here come back to Practice. */
const BACK_TO_PRACTICE = { from: "/mock" };

/**
 * /mock-interview: Practice for signed-out visitors (D73): one-tap rounds, the AI video interview, the scorecard and
 * the drills, then "Start free". The real screen of a finished round (marketing/shots) on the product page template
 * (marketing/ProductPage.tsx). The rounds' names follow where the visitor applies (regionWords: India's campus HR
 * round, a recruiter screen elsewhere).
 */
export function PracticePublicPage() {
  const country = useCountry();
  const india = isIndia(country);
  const words = regionWords(country);
  const welcome = useWelcomeGrant();
  const minutes = welcome?.interview_minutes ?? 0;
  const screen = `${words.screen[0]!.toUpperCase()}${words.screen.slice(1)}`;

  const rounds: Array<{ icon: typeof Clock; title: string; text: string }> = [
    { icon: Clock, title: `5-minute ${india ? "HR round" : words.screen}`, text: india ? "Tell me about yourself, why this company, strengths and relocation: the campus HR round." : "Tell me about yourself, why this company and your strengths: the first recruiter call." },
    { icon: MessagesSquare, title: "Tell me about yourself", text: "The full answer, a project from your resume, then the 30-second version." },
    { icon: Target, title: "15-minute technical", text: "Questions from your resume and the job post, with follow-ups on what you actually said." },
    { icon: Users, title: "Panel round", text: "A hiring manager, an engineer and HR; whoever is best placed asks about a gap in your answer." },
    { icon: Video, title: "One-way video", text: "HireVue-style: time to think, then a fixed time to answer each prompt on camera." },
    { icon: Scale, title: "Salary talk", text: india ? "A recruiter offers a package in LPA; practise asking for more." : "A recruiter makes an offer; practise asking for more." },
  ];

  const features: Feature[] = [
    { icon: Video, title: "A video interview with Saba", text: "An AI interviewer you see and hear asks, listens and follows up, with captions and a transcript of the call." },
    { icon: ChartColumn, title: "A scorecard for every answer", text: "What landed, what was missing, and a stronger way to say it, for each question you were asked." },
    { icon: RefreshCw, title: "Your weakest answers, again", text: "The answers that scored lowest are asked again, with follow-ups, until they hold up." },
    { icon: NotebookPen, title: "Stories for “Tell me about a time”", text: "Keep your stories in a story bank and practise telling each one, tested the way interviewers test them." },
    { icon: Building2, title: "In a company's style", text: "Rounds shaped like the employer's own, from 100 company interview guides, or a role's usual questions." },
    { icon: Languages, title: "In English, or in Hindi or Hinglish", text: india ? "Practise in English, or, where it's offered, in Hindi or Hinglish: the interviewer asks in it, and the review is written in it." : "Practise in English; in India, rounds in Hindi or Hinglish are offered too." },
  ];

  return (
    <PublicLayout authState={BACK_TO_PRACTICE} context="Mock interviews">
      <ProductHero
        product={{ id: "practice", name: "Practice", icon: Target }}
        title="Mock interviews that ask, listen and follow up."
        lead="Practise out loud with an AI interviewer. Pick a round, a role or a company's style; it follows up on what you actually said, then scores each answer and shows a stronger way to say it."
        detail={`${screen}s, technical, behavioural and salary rounds, a one-tap 5-minute round, and an AI video interview on camera.`}
        actions={
          <>
            <Link to="/register" state={BACK_TO_PRACTICE} className={buttonClass("primary", "lg", "min-h-12 px-6")}>
              Start free <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link to="/warmup" className={buttonClass("secondary", "lg", "min-h-12 px-6")}>
              Try a question, no account
            </Link>
          </>
        }
        note={
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <strong className="font-medium text-zinc-900 dark:text-white">Mock interviews use interview minutes.</strong>{" "}
            {minutes ? `A new account gets ${minutes} free; ` : ""}a single practice question with instant feedback is free
            without an account.{" "}
            <Link to="/pricing" className={cx("rounded font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
              See pricing
            </Link>
          </p>
        }
        visual={<ProductShot name="practice" priority alt="A finished mock interview's scorecard: a score for each answer and what to say better." />}
      />

      <Section labelledBy="practice-rounds-title" band>
        <SectionIntro
          id="practice-rounds-title"
          eyebrow="One tap to start"
          title="The rounds you'll actually face."
          lead="Each one is a full session with the AI interviewer, built from your resume and, when you add it, the job post."
        />
        <ul className="mt-12 grid gap-px overflow-hidden rounded-2xl border mk-line bg-[rgb(var(--site-line))] sm:grid-cols-2 lg:grid-cols-3">
          {rounds.map(({ icon, title, text }) => (
            <li key={title} className="flex flex-col mk-surface p-6">
              <IconTile icon={icon} />
              <h3 className="mt-5 text-base font-semibold text-zinc-950 dark:text-white">{title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">{text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <FeatureGrid
        id="practice-features-title"
        eyebrow="After every round"
        title="Know what to say better next time."
        lead="The review is grounded in what you said in the session, never in a script."
        features={features}
      />

      <Section labelledBy="practice-more-title" band>
        <SectionIntro
          id="practice-more-title"
          eyebrow="Before the interview"
          title="Practise for the company you're meeting."
          lead="How 100 employers interview, and what interviews for each kind of job test: every guide links to a mock interview in its style."
        />
        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
          <ArrowLink to="/companies">Company interview guides</ArrowLink>
          <ArrowLink to="/roles">Interview guides by role</ArrowLink>
          <ArrowLink to="/interview-copilot">The live interview copilot</ArrowLink>
        </div>
      </Section>

      <CtaBand
        id="practice-cta-title"
        title="Answer one question out loud."
        text="The free warm-up asks a common interview question and shows what to improve, before you sign up for anything."
        actions={
          <>
            <Link to="/warmup" className={inkButton.primary}>
              Try a practice question <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/register" state={BACK_TO_PRACTICE} className={inkButton.secondary}>
              Create a free account
            </Link>
          </>
        }
        footnote="No card needed, and nothing renews."
      />
    </PublicLayout>
  );
}
