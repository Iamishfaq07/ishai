import { useRef } from "react";
import { Link } from "react-router-dom";
import { companyNames, roleNames } from "virtual:question-bank/names";
import { ArrowRight, AudioLines, Building2, ChartColumn, Clock, FileText, MessagesSquare, NotebookPen, RefreshCw, Reveal, Scale, Sparkles, Target, Users, Video, buttonClass, cx, focusRing, type LucideIcon } from "@orbit/ui";
import { PRACTICE_FAQ } from "../../worker/faqs/mock-interview.js";
import { useCountry } from "../lib/country";
import { WELCOME_LIKE, useWelcomeGrant } from "../lib/welcome";
import { COPILOT_PAGE } from "../marketing/catalog";
import { CrossSell, FactsBand, FaqBlock, FinalCta, HeroShowcase, StepsWithUI, ToolkitGrid } from "../marketing/kit";
import { PublicLayout } from "../marketing/PublicLayout";
import { ArrowLink, IconTile, Section, SectionIntro } from "../marketing/primitives";
import { SameBox } from "../marketing/SameBox";
import { StickyCta } from "../marketing/StickyCta";
import { PRESETS, presetTitle, type PresetId } from "./mockPresets";
import { CompaniesArt, DrillArt, ReviewStepArt, RoomArt, RoundsStepArt, ScorecardArt, StoryArt, StrongerArt, TalkStepArt } from "./PracticePublicArt";
import { RESUME_AI_HOME } from "./resume/paths";

/** Sign-up and sign-in from here come back to Practice. */
const BACK_TO_PRACTICE = { from: "/mock" };

/** Each one-tap round's mark (the front door's icon tiles). */
const ROUND_ICON: Record<PresetId, LucideIcon> = { hr5: Clock, tmay10: MessagesSquare, tech15: Target, panel15: Users, oneway10: Video, salary: Scale };

/** The hero's line on what's free: the free minutes once the server says how many. */
function freeNote(minutes: number) {
  return (
    <p>
      <strong className="font-medium text-zinc-900 dark:text-white">Mock interviews use interview minutes.</strong>{" "}
      {minutes ? `A new account gets ${minutes} free; ` : ""}a single practice question with instant feedback is free without an account.{" "}
      <Link to="/pricing" className={cx("rounded font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
        See pricing
      </Link>
    </p>
  );
}

/**
 * /mock-interview: Practice for signed-out visitors (D73), built with the product pages' section kit (DECISIONS
 * D79): the video room with Saba asking, the facts (the one-tap rounds and the interview guides, counted from their
 * own lists), three steps, the rounds, the review as working pieces, the questions, what comes next and one last
 * action. The rounds' names follow where the visitor applies (presetTitle).
 */
export function PracticePublicPage() {
  const country = useCountry();
  const welcome = useWelcomeGrant();
  const minutes = welcome?.interview_minutes ?? 0;
  const heroCtas = useRef<HTMLDivElement>(null);
  const finalCta = useRef<HTMLElement>(null);
  return (
    <PublicLayout authState={BACK_TO_PRACTICE} context="Mock interviews">
      <HeroShowcase
        product={{ id: "practice", name: "Practice", icon: Target }}
        title={["Mock interviews", "that listen back."]}
        lead="Practise out loud with Saba, Orbit's AI interviewer. Pick a round, a role or a company's style; she follows up on what you actually said, then every answer is scored with a stronger way to say it."
        ctas={heroCtas}
        actions={
          <>
            <Link to="/register" state={BACK_TO_PRACTICE} className={buttonClass("primary", "lg", "min-h-12 px-6")}>
              Start free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/warmup" className={buttonClass("secondary", "lg", "min-h-12 px-6")}>
              Try a question, no account
            </Link>
          </>
        }
        note={<SameBox like={freeNote(minutes || WELCOME_LIKE.interview_minutes)} answered={minutes}>{freeNote(minutes)}</SameBox>}
        visual={<RoomArt />}
      />

      <FactsBand
        label="Practice in numbers"
        facts={[
          { value: PRESETS.length, label: "rounds that start in one tap" },
          { value: Object.keys(companyNames).length, label: "company interview guides to practise in their style" },
          { value: Object.keys(roleNames).length, label: "role guides with the questions they usually ask" },
          { value: "1-5", label: "the score every answer gets, with a stronger way to say it" },
        ]}
      />

      <StepsWithUI
        id="steps-title"
        eyebrow="How it works"
        title="Pick a round, talk, then read the review."
        steps={[
          { title: "Pick a round", text: "One tap for the usual first rounds, or set the role, the company's style, how hard and how long.", ui: <RoundsStepArt /> },
          { title: "Talk it through", text: "The interviewer asks out loud, listens, and follows up on a gap in what you actually said.", ui: <TalkStepArt /> },
          { title: "Read the review", text: "A score for the round and for every answer: what landed, what was missing and a stronger way to say it.", ui: <ReviewStepArt /> },
        ]}
      />

      <Section labelledBy="practice-rounds-title">
        <SectionIntro
          id="practice-rounds-title"
          eyebrow="One tap to start"
          title="The rounds you'll actually face."
          lead="Each one is a full session with the AI interviewer, built from your resume and, when you add it, the job post."
        />
        <Reveal as="ul" stagger className="mt-12 grid gap-px overflow-hidden rounded-2xl border mk-line bg-[rgb(var(--site-line))] sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((p) => (
            <li key={p.id} className="flex flex-col mk-surface p-6">
              <div className="flex items-center gap-3">
                <IconTile icon={ROUND_ICON[p.id]} />
                <h3 className="text-base font-semibold text-zinc-950 dark:text-white">{presetTitle(p, country)}</h3>
              </div>
              <p className="mt-3 text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">{p.blurb("", country)}</p>
              <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{p.minutes} minutes</p>
            </li>
          ))}
        </Reveal>
      </Section>

      <ToolkitGrid
        id="toolkit-title"
        eyebrow="After every round"
        title="Know what to say better next time."
        lead="The review is grounded in what you said in the session, never in a script."
        band
        tools={[
          { title: "A score for every answer", icon: ChartColumn, text: "The round's score and each answer's, out of 5, with what went well and what to improve.", widget: <ScorecardArt />, wide: true },
          { title: "A stronger way to say it", icon: Sparkles, text: "For each answer, a better version built from what you said and your resume, never a script to learn.", widget: <StrongerArt /> },
          { title: "Your weakest answers, again", icon: RefreshCw, text: "Answers scored 3 or lower come back on a schedule, with follow-ups, until they hold up.", widget: <DrillArt /> },
          { title: "Stories for “Tell me about a time”", icon: NotebookPen, text: "Keep your stories in a story bank and practise telling each one, tested the way interviewers test them.", widget: <StoryArt /> },
          { title: "In a company's style", icon: Building2, text: "Rounds shaped like an employer's own, from Orbit's interview guides, or a role's usual questions.", widget: <CompaniesArt /> },
        ]}
      >
        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
          <ArrowLink to="/companies">Company interview guides</ArrowLink>
          <ArrowLink to="/roles">Interview guides by role</ArrowLink>
        </div>
      </ToolkitGrid>

      <FaqBlock id="faq-title" items={PRACTICE_FAQ} />

      <CrossSell
        id="next-title"
        eyebrow="The same account"
        title="Then the real one."
        lead="Practice, the copilot and Resume work from the same resume, so what you rehearse is what you'll say."
        items={[
          { product: { id: "copilot", name: "Interview copilot", icon: AudioLines }, title: "Live answers, where allowed", text: "In calls where AI help is allowed, a suggested answer from your resume as the question is asked.", to: COPILOT_PAGE, cta: "See the copilot" },
          { product: { id: "resume", name: "Resume", icon: FileText }, title: "The resume they'll ask about", text: "An ATS score out of 100, and the questions your resume will get you asked.", to: RESUME_AI_HOME, cta: "See Resume" },
          { product: { id: "practice", name: "Free warm-up", icon: Target }, title: "One question, no account", text: "Answer a common interview question out loud or by typing and see what to improve straight away.", to: "/warmup", cta: "Try the warm-up" },
        ]}
      />

      <FinalCta
        id="cta-title"
        innerRef={finalCta}
        title={["Answer one question out loud.", "Then a whole round."]}
        text="The free warm-up asks a common interview question and shows what to improve, before you sign up for anything."
        primary={{ to: "/warmup", label: "Try a practice question" }}
        secondary={{ to: "/register", label: "Create a free account", state: BACK_TO_PRACTICE }}
        footnote="No card needed, and nothing renews."
      />
      <StickyCta after={heroCtas} before={finalCta} line="Mock interviews with a scorecard." />
    </PublicLayout>
  );
}
