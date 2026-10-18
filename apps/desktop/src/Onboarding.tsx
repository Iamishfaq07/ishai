import { type ReactNode, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowUpRight,
  AudioLines,
  Button,
  CelebrationScene,
  CopilotScene,
  Headphones,
  Kbd,
  ListChecks,
  Mic,
  MonitorSmartphone,
  SecurityScene,
  ShieldCheck,
  Sheet,
  Sparkles,
  WelcomeScene,
  cx,
  focusRing,
  type LucideIcon,
} from "@orbit/ui";
import { WEB_URL } from "./api";
import { formatAccelerator, loadShortcuts } from "./globalShortcuts";
import { finishOnboarding, tourStep } from "./welcomeTour";
import { WEB_TOOLS, toolLink } from "./web";

/** The honest line, as the website says it (apps/web lib/contact.ts USE_WHERE_ALLOWED). */
const USE_WHERE_ALLOWED =
  "Built for practice, and for interviews and calls where notes or AI help are allowed. Check the rules first.";

interface Slide {
  title: string;
  art: ReactNode;
  body: ReactNode;
}

function Point({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden="true" className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * The welcome tour (DECISIONS D77): four slides the first time someone signs in on this device. What the copilot
 * does; what it hears and when (the microphone and the meeting's sound, only while a session runs); Orbit's other
 * tools on the web; and how to start. Skippable at any point (Skip, ×, Escape), never shown again by itself, and
 * replayable from Settings → About. Nothing in it is ticked or bought: the web links just open the browser.
 */
export function Onboarding({ onDone }: { onDone: (next: "home" | "start") => void }) {
  const [step, setStep] = useState(0);
  const keys = loadShortcuts();
  const finish = (how: "finished" | "skipped", next: "home" | "start" = "home") => {
    finishOnboarding(how);
    onDone(next);
  };

  const slides: Slide[] = [
    {
      title: "Welcome to Orbit",
      art: <CopilotScene className="w-full" />,
      body: (
        <>
          <p className="text-[15px] text-zinc-700 dark:text-zinc-200">
            Orbit is your interview copilot. In a call it listens with you, spots the interviewer’s question, and
            streams a short answer from your resume that you can glance at while you speak.
          </p>
          <ul className="mt-4 space-y-2.5 text-sm text-zinc-600 dark:text-zinc-300">
            <Point icon={AudioLines}>Answers grounded in your resume and the job description, as the question is asked.</Point>
            <Point icon={ListChecks}>A review after every session: what went well, and what to practise next.</Point>
            <Point icon={Sparkles}>Practice rounds too, with an AI interviewer who asks out loud.</Point>
          </ul>
          <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">{USE_WHERE_ALLOWED}</p>
        </>
      ),
    },
    {
      title: "You choose what Orbit hears",
      art: <SecurityScene className="w-full" />,
      body: (
        <>
          <p className="text-[15px] text-zinc-700 dark:text-zinc-200">
            Orbit hears two things, kept apart so it knows who’s speaking, and only while a session runs.
          </p>
          <ul className="mt-4 space-y-2.5 text-sm text-zinc-600 dark:text-zinc-300">
            <Point icon={Mic}>
              <b className="font-medium text-zinc-900 dark:text-white">Your microphone</b>: you. Windows shows its
              microphone sign while Orbit listens.
            </Point>
            <Point icon={Headphones}>
              <b className="font-medium text-zinc-900 dark:text-white">The interviewer</b>: just the meeting app you
              pick (Zoom, Teams, your browser), or everything one speaker plays.
            </Point>
            <Point icon={ShieldCheck}>
              Nothing is captured until you press Start, and it stops when the session ends. Raw audio is never
              stored; transcripts are kept only if you want them (Settings).
            </Point>
          </ul>
          <p className="mt-4 rounded-xl bg-zinc-500/[0.06] px-3 py-2 text-xs text-zinc-600 dark:bg-white/[0.04] dark:text-zinc-300">
            If Windows blocks the microphone, turn on Settings → Privacy &amp; security → Microphone → “Let desktop apps
            access your microphone”. Setup checks it for you before every session.
          </p>
        </>
      ),
    },
    {
      title: "Orbit on the web",
      art: <WelcomeScene className="w-full" />,
      body: (
        <>
          <p className="text-[15px] text-zinc-700 dark:text-zinc-200">
            Your account works at orbitanswer.com too. Prepare there; the copilot is here when the interview starts.
          </p>
          <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {WEB_TOOLS.map((tool) => (
              <li key={tool.id}>
                <button
                  type="button"
                  onClick={() => void openUrl(toolLink(WEB_URL, tool, "onboarding"))}
                  title={tool.line}
                  className={cx(
                    "group flex w-full items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-2 text-left text-sm transition-colors duration-quick hover:border-zinc-300 hover:bg-zinc-50 active:bg-zinc-100 dark:border-white/10 dark:hover:border-white/20 dark:hover:bg-white/[0.04] dark:active:bg-white/[0.07]",
                    focusRing,
                  )}
                >
                  <span className={cx("min-w-0 flex-1 font-medium leading-snug", tool.id === "kashsec" && "text-teal-700 dark:text-teal-300")}>{tool.name}</span>
                  <ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-zinc-400 motion-ok:transition-transform motion-ok:group-hover:-translate-y-px motion-ok:group-hover:translate-x-px" />
                  <span className="sr-only">(opens in your browser)</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            KashSec Academy is the Orbit team’s free cybersecurity school, on its own site.
          </p>
        </>
      ),
    },
    {
      title: "Ready when you are",
      art: <CelebrationScene still className="w-full" />,
      body: (
        <>
          <p className="text-[15px] text-zinc-700 dark:text-zinc-200">
            Set up a session in a minute: what it is, who Orbit should hear, your documents, and how it answers.
          </p>
          <ul className="mt-4 space-y-2.5 text-sm text-zinc-600 dark:text-zinc-300">
            <Point icon={MonitorSmartphone}>The live window floats over your call; make it compact or expanded, and drag it anywhere.</Point>
            <Point icon={Sparkles}>
              <span>
                Show or hide Orbit from anywhere with <Kbd>{formatAccelerator(keys.toggleWindow)}</Kbd>; ask for an answer with{" "}
                <Kbd>{formatAccelerator(keys.answer)}</Kbd>. Change them in Settings.
              </span>
            </Point>
            <Point icon={Headphones}>Closing the window can keep Orbit in the tray, ready for the next call.</Point>
          </ul>
        </>
      ),
    },
  ];
  const slide = slides[step]!;
  const last = step === slides.length - 1;
  const go = (move: -1 | 1) => {
    const next = tourStep(step, slides.length, move);
    if (next.done) finish("finished");
    else setStep(next.step);
  };

  return (
    <Sheet
      open
      size="2xl"
      onClose={() => finish("skipped")}
      title={slide.title}
      detail={<p className="text-xs text-zinc-500 dark:text-zinc-400">Step {step + 1} of {slides.length}</p>}
      footer={
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5" aria-hidden="true">
            {slides.map((s, i) => (
              <span
                key={s.title}
                className={cx(
                  "h-1.5 rounded-full transition-[width,background-color] duration-panel ease-standard",
                  i === step ? "w-5 bg-indigo-600 dark:bg-indigo-400" : "w-1.5 bg-zinc-300 dark:bg-white/20",
                )}
              />
            ))}
          </span>
          <span className="flex-1" />
          {!last && (
            <Button variant="ghost" onClick={() => finish("skipped")}>
              Skip tour
            </Button>
          )}
          {step > 0 && (
            <Button variant="secondary" onClick={() => go(-1)}>
              Back
            </Button>
          )}
          {last ? (
            <>
              <Button variant="secondary" onClick={() => finish("finished")}>
                Go to Home
              </Button>
              <Button onClick={() => finish("finished", "start")}>Set up a session</Button>
            </>
          ) : (
            <Button onClick={() => go(1)}>Next</Button>
          )}
        </div>
      }
    >
      <div key={step} className="grid animate-fade-in gap-6 px-6 py-5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-center">
        <div className="mx-auto w-44 sm:w-full">{slide.art}</div>
        <div>{slide.body}</div>
      </div>
    </Sheet>
  );
}
