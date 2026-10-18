import { Link } from "react-router-dom";
import {
  ArrowRight,
  AudioLines,
  Code2,
  Download,
  EyeOff,
  FileText,
  Languages,
  Laptop,
  LockKeyhole,
  Mic,
  ShieldCheck,
  SlidersHorizontal,
  buttonClass,
  cx,
  focusRing,
} from "@orbit/ui";
import { USE_WHERE_ALLOWED } from "../lib/contact";
import { DESKTOP_BETA, DESKTOP_DOWNLOAD_URL } from "../lib/desktop";
import { useWelcomeGrant } from "../lib/welcome";
import { CtaBand, FeatureGrid, ProductHero, inkButton, type Feature } from "../marketing/ProductPage";
import { ProductShot } from "../marketing/ProductShot";
import { PublicLayout } from "../marketing/PublicLayout";
import { ArrowLink, CheckList, IconTile, Section, SectionIntro } from "../marketing/primitives";

/** Sign-up and sign-in from here come back to the copilot's setup. */
const BACK_TO_SETUP = { from: "/start" };

const FEATURES: Feature[] = [
  { icon: Mic, title: "Hears the question", text: "The interviewer's words become text as they speak; Orbit works out when a question has been asked, and what kind it is." },
  { icon: FileText, title: "Answers from your resume", text: "Each answer is built from your resume, your stories and the job description, and shows the lines it used." },
  { icon: ShieldCheck, title: "Says what it made up", text: "A detail that isn't in your documents is marked as an example for you to swap, never passed off as yours." },
  { icon: Code2, title: "Coding and screenshots", text: "For a coding or system-design question: what to say, the code and its complexity. A screenshot of a problem works too." },
  { icon: SlidersHorizontal, title: "Shorter, longer, simpler", text: "One tap rewrites the answer the way you need it, and you choose how long answers are and how they sound." },
  { icon: Languages, title: "In your language", text: "Interviews in English and nine more languages, with Hinglish too: questions heard and answers written in the language of the call." },
];

const STEPS = [
  { icon: FileText, title: "Add your resume and the job", text: "Upload your resume and paste the job description. Add a few stories if you like; Orbit uses only what you give it." },
  { icon: Laptop, title: "Start a session on your laptop", text: "In Chrome or Edge, Orbit listens to the meeting tab you choose. The Orbit app for Windows can listen to any call app." },
  { icon: AudioLines, title: "Glance, then answer in your words", text: "When a question is asked, a suggested answer appears in plain spoken words. After the call, the session's notes and review stay in your account." },
];

/**
 * /interview-copilot: the live interview copilot for signed-out visitors (D73): what it does, how a session runs,
 * where it may be used, and "Start free". The real screen of a live session (marketing/shots), the product page
 * template (marketing/ProductPage.tsx) and the honest line (lib/contact.ts USE_WHERE_ALLOWED). Nothing here calls
 * the API but the free allowance.
 */
export function CopilotPublicPage() {
  const welcome = useWelcomeGrant();
  const minutes = welcome?.interview_minutes ?? 0;
  return (
    <PublicLayout authState={BACK_TO_SETUP} context="Interview copilot">
      <ProductHero
        product={{ id: "copilot", name: "Interview copilot", icon: AudioLines }}
        title="Live interview answers, from your own resume."
        lead="In an interview or call where AI help is allowed, Orbit hears the interviewer's question and suggests an answer in plain spoken words, built from your resume and the job description."
        detail={USE_WHERE_ALLOWED}
        actions={
          <>
            <Link to="/register" state={BACK_TO_SETUP} className={buttonClass("primary", "lg", "min-h-12 px-6")}>
              Start free <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link to="/technical" className={buttonClass("secondary", "lg", "min-h-12 px-6")}>
              How the live answer works
            </Link>
          </>
        }
        note={
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <strong className="font-medium text-zinc-900 dark:text-white">Live sessions use interview minutes.</strong>{" "}
            {minutes ? `A new account gets ${minutes} free; ` : ""}more come with a plan or a credit pack, paid once.{" "}
            <Link to="/pricing" className={cx("rounded font-medium text-indigo-700 underline underline-offset-2 dark:text-indigo-300", focusRing)}>
              See pricing
            </Link>
          </p>
        }
        visual={<ProductShot name="copilot" priority alt="Orbit's live session: the transcript, the interviewer's question and a suggested answer with the resume lines it used." />}
      />

      <FeatureGrid
        id="copilot-features-title"
        eyebrow="What the copilot does"
        title="An answer you can say, as the question is asked."
        lead="Grounded in your own documents, in the words you'd use out loud. You stay the one answering."
        features={FEATURES}
        band
      />

      <Section labelledBy="copilot-how-title">
        <div className="grid gap-14 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-6">
            <SectionIntro id="copilot-how-title" eyebrow="How it works" title="Set up once, then talk." />
            <ol className="mt-10 space-y-8">
              {STEPS.map(({ icon, title, text }, i) => (
                <li key={title} className="flex gap-4">
                  <IconTile icon={icon} />
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-zinc-950 dark:text-white">
                      <span className="sr-only">Step {i + 1}: </span>
                      {title}
                    </span>
                    <span className="mt-1 block text-[0.9375rem] leading-relaxed text-zinc-600 dark:text-zinc-400">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2">
              <ArrowLink to="/technical">Measured answer speed</ArrowLink>
              <a
                href={DESKTOP_DOWNLOAD_URL}
                className={cx("group inline-flex min-h-10 items-center gap-1.5 rounded-lg text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white", focusRing)}
              >
                <Download className="h-4 w-4" aria-hidden="true" /> Orbit for Windows{DESKTOP_BETA ? " (beta)" : ""}
              </a>
            </div>
          </div>
          <div className="rounded-2xl border mk-line mk-surface p-6 sm:p-8 lg:col-span-6">
            <h2 className="flex items-center gap-3 text-lg font-semibold text-zinc-950 dark:text-white">
              <IconTile icon={EyeOff} size="sm" /> Where it's for, honestly
            </h2>
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

      <Section labelledBy="copilot-more-title" band>
        <SectionIntro
          id="copilot-more-title"
          eyebrow="Before the real one"
          title="Practise with the same answers first."
          lead="Run a mock interview with an AI interviewer, then use the copilot for the calls where it's allowed. One account has both, with Resume AI and Jobs AI."
        />
        <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
          <ArrowLink to="/mock-interview">Mock interviews</ArrowLink>
          <ArrowLink to="/warmup">Try a practice question, no account</ArrowLink>
          <ArrowLink to="/pricing">Pricing</ArrowLink>
        </div>
      </Section>

      <CtaBand
        id="copilot-cta-title"
        title="Get your next answer ready."
        text="Create a free Orbit account, add your resume and the job, and start a session when your call begins."
        actions={
          <>
            <Link to="/register" state={BACK_TO_SETUP} className={inkButton.primary}>
              Start free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link to="/mock-interview" className={inkButton.secondary}>
              Practise first
            </Link>
          </>
        }
        footnote="No card needed, and nothing renews."
      />
    </PublicLayout>
  );
}
