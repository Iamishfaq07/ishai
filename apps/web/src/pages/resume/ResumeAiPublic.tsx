import { useRef } from "react";
import { Link } from "react-router-dom";
import type { CreditPack } from "@orbit/types";
import { ArrowRight, AudioLines, Briefcase, FileText, Gauge, Mail, MessagesSquare, OrbitLogo, Target, Wand2, buttonClass, cx, focusRing } from "@orbit/ui";
import { RESUME_AI_FAQ } from "../../../worker/faqs/resume-ai.js";
import { JOBS_AI_HOME } from "../jobs/paths";
import { COPILOT_PAGE, PRACTICE_PAGE } from "../../marketing/catalog";
import { Carousel, ComparisonBlock, CrossSell, FactsBand, FaqBlock, FinalCta, HeroShowcase, StepsWithUI, ToolkitGrid, usePublicData } from "../../marketing/kit";
import { PricingSection } from "../../marketing/PricingSection";
import { PublicLayout } from "../../marketing/PublicLayout";
import { Container, SectionIntro } from "../../marketing/primitives";
import { SameBox } from "../../marketing/SameBox";
import { StickyCta } from "../../marketing/StickyCta";
import { WELCOME_LIKE, type WelcomeGrant } from "../../lib/welcome";
import { TEMPLATES } from "./model";
import { RESUME_AI_HOME } from "./paths";
import {
  ChatbotArt,
  ChecksArt,
  DownloadStepArt,
  FixArt,
  ImportStepArt,
  LetterArt,
  MatchArt,
  PrepArt,
  ResumeHeroArt,
  ResumeOutArt,
  ScoreStepArt,
  TemplateCard,
  useTemplates,
} from "./publicArt";

/** Sign-up and sign-in from here come back to Resume AI. */
const BACK_HERE = { from: RESUME_AI_HOME };

type Pack = Pick<CreditPack, "resume_credits" | "price_inr" | "currency" | "price_text">;

/** The cheapest pack of AI credits as the server sells it today (₹499 for 25 on 18 Oct 2026), in the longer of its
 *  two forms (dollars outside India), only to size the hero's line until it answers (SameBox): never shown. */
const PACK_LIKE: Pack = { resume_credits: 25, price_inr: 499, currency: "USD", price_text: "$7.99" };

/** What a new account gets, said plainly: the free AI credit (from the server), what never costs one, and packs. */
function freeNote(welcome: WelcomeGrant | null, packs: Pack[] | null) {
  const pack = packs?.filter((p) => p.resume_credits > 0).sort((a, b) => a.price_inr - b.price_inr)[0] ?? null;
  const credits = welcome?.resume_credits ?? 0;
  return (
    <p>
      {credits > 0 && (
        <strong className="font-medium text-zinc-900 dark:text-white">
          {credits === 1 ? "Your first AI action is free." : `Your first ${credits} AI actions are free.`}{" "}
        </strong>
      )}
      Typing, the ATS score and Word and PDF downloads never use credits.
      {pack &&
        (pack.currency === "USD" && pack.price_text
          ? ` More AI credits come in packs, from ${pack.price_text} for ${pack.resume_credits}, and they never expire.`
          : ` More AI credits come in packs, from ₹${pack.price_inr.toLocaleString("en-IN")} for ${pack.resume_credits}, and they never expire.`)}
    </p>
  );
}

function Templates() {
  const { templates } = useTemplates();
  return (
    <section id="templates" aria-labelledby="templates-title" className="scroll-mt-20 border-t mk-line py-16 sm:py-24 lg:py-28">
      <Container>
        <SectionIntro
          id="templates-title"
          eyebrow={`${templates.length} templates`}
          title="Switch the look. Your words stay put."
          lead="Every template is the same resume laid out another way, so you can try them all without retyping a line. The one-column ones read cleanly in screening software."
        />
        <div className="mt-12">
          <Carousel label="Resume AI's templates" count={templates.length} eager={0} render={(i, near) => <TemplateCard index={i} near={near} />} />
        </div>
      </Container>
    </section>
  );
}

/**
 * Resume AI for signed-out visitors (at /resume-ai, where a signed-in person gets their resumes), built with the
 * product pages' section kit (DECISIONS D79): the hero with the sample resume being scored and fixed, the facts, three
 * steps, the real templates, the toolkit as working pieces, a fair comparison, the prices, the questions, what comes
 * next and one last action. Nothing here calls the AI; the prices and the free allowance come from the server.
 */
export function ResumeAiPublicPage() {
  const data = usePublicData();
  const heroCtas = useRef<HTMLDivElement>(null);
  const finalCta = useRef<HTMLElement>(null);
  return (
    <PublicLayout authState={BACK_HERE} context="Resume AI">
      <HeroShowcase
        product={{ id: "resume", name: "Resume AI", icon: FileText }}
        title={["Your resume,", "scored and fixed."]}
        lead="Resume AI reads your resume the way screening software does, scores it out of 100 and fixes what it finds with you, line by line. It keeps your numbers and never makes one up."
        ctas={heroCtas}
        actions={
          <>
            <Link to="/register" state={BACK_HERE} className={buttonClass("primary", "lg", "min-h-12 px-6")}>
              Score my resume free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a href="#templates" className={buttonClass("secondary", "lg", "min-h-12 px-6")}>
              See the templates
            </a>
          </>
        }
        note={<SameBox like={freeNote(data.welcome ?? WELCOME_LIKE, data.packs ?? [PACK_LIKE])} answered={[data.welcome, data.packs?.length]}>{freeNote(data.welcome, data.packs)}</SameBox>}
        visual={<ResumeHeroArt />}
      />

      <FactsBand
        label="Resume AI in numbers"
        facts={[
          { value: 100, label: "points in the ATS score, from eight parts of the resume" },
          { value: TEMPLATES.length, label: "templates, switched without retyping" },
          { value: "Word, PDF", label: "downloads, both free" },
          { value: "1/5", label: "of an AI credit for a single AI fix" },
        ]}
      />

      <StepsWithUI
        id="steps-title"
        eyebrow="How it works"
        title="From the resume you have to one you can send."
        lead="Everything up to the download is free; AI help uses credits only when you ask for it."
        steps={[
          { title: "Import it, or start fresh", text: "Upload a PDF or Word file, or LinkedIn's PDF of your profile, and it's read into sections you can edit. Or start from a template.", ui: <ImportStepArt /> },
          { title: "Score it, then tailor it", text: "Work through the fixes the score shows, then paste a job post to see which of its keywords you cover and make a copy for that job.", ui: <ScoreStepArt /> },
          { title: "Download it", text: "Word or PDF, the pages you previewed, as real text screening software reads. Downloads are free, as often as you like.", ui: <DownloadStepArt /> },
        ]}
      />

      <Templates />

      <ToolkitGrid
        id="toolkit-title"
        eyebrow="The toolkit"
        title="Every tool works from the same resume."
        lead="Each one shows you what it changes before anything changes, and you can undo any of it."
        band
        tools={[
          { title: "Fix with AI", icon: Wand2, text: "Pick a check that failed and the AI rewrites exactly that line or section. You see the change marked, then keep it or undo it.", widget: <FixArt />, wide: true },
          { title: "The ATS check", icon: Gauge, text: "Out of 100, part by part, the same way every time, with the fix for every point it misses.", widget: <ChecksArt /> },
          { title: "Job-post match", icon: Briefcase, text: "Paste a job post to see its keywords: the ones your resume covers, and the ones it doesn't yet.", widget: <MatchArt /> },
          { title: "Cover letters", icon: Mail, text: "Written from your resume and the job post, in the tone and length you choose.", widget: <LetterArt /> },
          { title: "Interview prep", icon: MessagesSquare, text: "The questions your resume will get you asked, and the skills the job wants that it doesn't show yet.", widget: <PrepArt /> },
        ]}
      />

      <ComparisonBlock
        id="compare-title"
        eyebrow="Why not just ask a chatbot?"
        title={
          <>
            A chatbot gives you text. <span className="text-indigo-700 dark:text-indigo-300">Resume AI gives you a resume.</span>
          </>
        }
        lead="A general chatbot can rewrite a resume well. What it hands back is the words; Resume AI hands back the finished file, checked."
        left={{
          name: "A general chatbot",
          tag: "Plain text",
          visual: <ChatbotArt />,
          lines: ["Plain text: you lay it out and format it yourself", "No score, and no list of what's missing", "You check the job post's keywords by eye", "Rewritten in one go: you find what changed"],
        }}
        right={{
          name: "Orbit Resume AI",
          tag: "Ready to send",
          mark: <OrbitLogo size={20} animated={false} />,
          visual: <ResumeOutArt />,
          lines: ["Laid out in a template, as Word or PDF", "A score out of 100, with a fix for every missing point", "The job post's keywords, matched one by one", "Every change marked, to keep or undo", "Your own numbers kept, none invented"],
        }}
      />

      <PricingSection
        packs={data.packs}
        monthly={data.monthly}
        welcome={data.welcome}
        stats={data.stats}
        title="Free to build. Pay once for AI help."
        lead="Editing, the score and downloads are free for good. AI credits come with a plan or in packs that never expire, and nothing renews."
      />

      <FaqBlock id="faq-title" items={RESUME_AI_FAQ} />

      <CrossSell
        id="next-title"
        eyebrow="The same account"
        title="After the resume, the interview."
        lead="Your resume carries over: Jobs AI finds jobs that fit it, Practice asks about it, and the copilot answers from it."
        items={[
          { product: { id: "jobs", name: "Jobs AI", icon: Briefcase }, title: "Jobs that fit this resume", text: "New openings from companies' own careers pages, matched to it, with a free AI fit check and a tracker.", to: JOBS_AI_HOME, cta: "See Jobs AI" },
          { product: { id: "practice", name: "Practice", icon: Target }, title: "Practise the questions it raises", text: "A mock interview built from your resume and the job post, then a score for every answer.", to: PRACTICE_PAGE, cta: "See mock interviews" },
          { product: { id: "copilot", name: "Interview copilot", icon: AudioLines }, title: "Answers from it, live", text: "In calls where AI help is allowed, suggested answers built from your resume as the question is asked.", to: COPILOT_PAGE, cta: "See the copilot" },
        ]}
      />

      <FinalCta
        id="cta-title"
        innerRef={finalCta}
        title={["See what your resume scores.", "Then fix it, line by line."]}
        text="Create a free Orbit account, import the resume you have, and get its ATS score in a minute."
        primary={{ to: "/register", label: "Score my resume free", state: BACK_HERE }}
        secondary={{ to: "/login", label: "I have an account", state: BACK_HERE }}
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
      <StickyCta after={heroCtas} before={finalCta} line="Your resume's ATS score, free." />
    </PublicLayout>
  );
}
