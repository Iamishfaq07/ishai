import { useEffect, useRef, useState } from "react";
import { answerHint } from "../live/answerHints";
import { oneWayPhase } from "../live/oneWay";
import { answerBand, answerWords, bandLabel, clock, paceState } from "../live/answerPace";
import type { LiveViewState } from "../live/reducer";
import type { InterviewerVoice } from "../live/useInterviewerVoice";
import { MOCK_ANSWER_CHARS, type LiveActions } from "../live/useLiveSession";
import { cx, focusRing } from "./cx";
import { buttonClass } from "./ui";
import { Orb } from "./Orb";

/** A panel interview: each panelist's colour, so who's asking reads at a glance. */
const PANEL_TONE: Record<string, string> = {
  recruiter: "bg-rose-500",
  hiring_manager: "bg-indigo-500",
  engineer: "bg-emerald-600",
  staff_engineer: "bg-sky-600",
  executive: "bg-amber-600",
};

/**
 * Mock interview view: the AI interviewer's question (spoken aloud), whose turn it is, and controls. Orbit never
 * suggests answers here — it's practice; the report afterwards grades what was said.
 */
/** The camera coach (web, ORBIT_VIDEO_MOCK): measures the self-view on this device; start() returns stop(). */
export interface CameraCoach {
  start: (video: HTMLVideoElement) => Promise<() => void>;
}

export function MockPanel({ live, actions, voice, ended, onViewReport, muted = false, onMutedChange, cameraCoach }: {
  live: LiveViewState;
  actions: LiveActions;
  voice: InterviewerVoice;
  ended: boolean;
  /** The interviewer's voice is off: questions are read on screen only. */
  muted?: boolean;
  onMutedChange?: (muted: boolean) => void;
  /** Offered with the self-view, in every mock round, when the server has it on. */
  cameraCoach?: CameraCoach;
  /** Open the transcript and review, offered once the session has ended. */
  onViewReport?: () => void;
}) {
  const q = live.mock;
  const btn = cx("rounded-lg border border-zinc-200 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40 " +
    "dark:border-zinc-800 dark:hover:bg-zinc-900", focusRing);

  if (live.mockCompleted || ended) {
    const s = live.mockSummary;
    return (
      <div className="flex flex-1 animate-fade-in flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-lg font-semibold">
          {s?.negotiation
            ? "That's the end of the call."
            : s?.drill
              ? "That's the end of the drill."
              : "That's the end of the interview."}
        </p>
        {s && s.answered !== undefined && (
          <p className="text-sm text-zinc-700 dark:text-zinc-300" aria-label="Round summary">
            {s.negotiation ? `${s.questions} turns with the recruiter` : `${s.answered} of ${s.questions} answered`}
            {s.follow_ups ? ` · ${s.follow_ups} follow-up${s.follow_ups === 1 ? "" : "s"}` : ""}
            {s.average_answer_words ? ` · about ${s.average_answer_words} words per answer` : ""}
            {s.unanswered ? ` · ${s.unanswered} skipped` : ""}
          </p>
        )}
        <p className="text-sm text-zinc-500">
          {/* The server ends the session itself when the round finishes, so there's nothing left to press. */}
          {s?.negotiation
            ? "Your review is on its way to History: how you anchored, justified and handled pushback, with stronger lines to use."
            : "Your review is on its way to History: each answer graded, with a stronger way to say it."}
        </p>
        {ended && onViewReport && (
          <button type="button" onClick={onViewReport} className={cx(btn, "mt-2")}>
            See the transcript and review
          </button>
        )}
      </div>
    );
  }
  if (!q) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-sm text-zinc-500">
        <Orb state="connecting" size={64} />
        The interviewer is getting ready…
      </div>
    );
  }
  const who = q.speaker?.name ?? (q.negotiation ? "Recruiter" : "Interviewer");
  const status = q.negotiation
    ? voice.speaking
      ? "Recruiter speaking…"
      : "Your move — respond out loud. Pause when you're done."
    : voice.speaking
      ? `${who} speaking…`
      : q.oneWay
        ? "Your turn — answer to the camera. It moves on when the time is up."
        : "Your turn — answer out loud. Pause when you're done.";
  return (
    <section aria-label="Mock interview" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <div className="flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <span>
          {q.negotiation ? `Recruiter · turn ${q.index} of up to ${q.total}` : `Question ${q.index} of ${q.total}`}
        </span>
        {q.isFollowUp && <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-indigo-700 dark:text-indigo-300">Follow-up</span>}
        {q.conceptDepth !== undefined && <span className="telemetry rounded-full bg-cyan-500/10 px-2 py-0.5 text-cyan-700 dark:text-cyan-200" title="Adaptive depth: foundations → architectural trade-offs">Depth {q.conceptDepth}/5</span>}
        {q.drillKind === "retry" && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-800 dark:text-amber-300" title="A question you found hard last time">
            Drill: try again
          </span>
        )}
        {q.drillKind === "prep" && (
          <span className="rounded-full bg-aurora-400/10 px-2 py-0.5 text-aurora-700 dark:text-aurora-300" title="A question from your interview prep">
            From your prep
          </span>
        )}
        {q.drillKind === "answer" && (
          <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-indigo-800 dark:text-indigo-300" title="A question you've saved an answer to">
            Your prepared answer
          </span>
        )}
        {q.drillKind === "story" && (
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-800 dark:text-violet-300" title="A question one of your saved stories answers">
            Story practice
          </span>
        )}
        {q.drillKind === "concise" && (
          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-800 dark:text-emerald-300">Short version · ~30 s</span>
        )}
      </div>
      {q.speaker && (
        <p className="-mb-2 flex items-center gap-2 text-sm" aria-label={`Asked by ${q.speaker.name}, ${q.speaker.title}`}>
          <span aria-hidden="true" className={cx("flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white", PANEL_TONE[q.speaker.persona] ?? "bg-indigo-500")}>
            {q.speaker.name.slice(0, 1)}
          </span>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{q.speaker.name}</span>
          <span className="text-zinc-500 dark:text-zinc-400">{q.speaker.title}</span>
        </p>
      )}
      <p key={q.questionId} className="animate-fade-up text-xl font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
        {q.text}
      </p>
      <p role="status" className={cx("flex items-center gap-2 text-sm",
        voice.speaking ? "text-indigo-700 dark:text-indigo-300" : "text-emerald-700 dark:text-emerald-300")}>
        <span className={cx("h-2 w-2 rounded-full", voice.speaking ? "animate-pulse bg-indigo-500" : "animate-ping bg-emerald-500")}
              aria-hidden="true" />
        {status}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={voice.speaking ? voice.stop : voice.repeat} className={btn} disabled={!voice.supported || muted}>
          {voice.speaking ? "Stop voice" : q.negotiation ? "Repeat that" : "Repeat question"}
        </button>
        {onMutedChange && (
          <button
            type="button"
            aria-pressed={muted}
            onClick={() => {
              if (!muted) voice.stop();
              onMutedChange(!muted);
            }}
            className={btn}
          >
            {muted ? "Turn voice on" : "Mute voice"}
          </button>
        )}
        <button type="button" onClick={actions.mockNext} className={btn}>
          {q.negotiation ? "I'm done — your turn, recruiter" : "I'm done — next question"}
        </button>
      </div>
      {!muted && voice.engine === "natural" && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Natural AI voice. The question stays on screen too.</p>
      )}
      {!voice.supported && !muted && (
        <p className="text-xs text-amber-700 dark:text-amber-300">This device has no speech voice — read the question above.</p>
      )}
      {q.oneWay ? (
        <OneWayClock key={`oneway-${q.questionId}`} think={q.oneWay.think_seconds} answer={q.oneWay.answer_seconds} onTimeUp={actions.mockNext} />
      ) : (
        !q.negotiation && <AnswerTimer key={`timer-${q.questionId}`} live={live} q={q} />
      )}
      {!q.oneWay && (
        <TypedAnswer key={`typed-${q.questionId}`} micDown={live.mic.state === "error"} onSend={actions.mockAnswer} />
      )}
      {(q.oneWay || cameraCoach) && <SelfView {...(cameraCoach ? { coach: cameraCoach } : {})} />}
      {!q.negotiation && <StructureHint key={`hint-${q.questionId}`} q={q} />}
      {/* Who has the floor, at a glance from across the room: the interviewer talking, or Orbit listening to you. */}
      <div aria-hidden="true" className="flex min-h-48 flex-1 flex-col items-center justify-center gap-10">
        <span className="relative flex items-center justify-center">
          <span
            className={cx(
              "absolute inset-0 -m-6 rounded-full ring-1 transition-colors duration-panel",
              voice.speaking ? "bg-indigo-500/[0.07] ring-indigo-500/15" : "bg-emerald-500/[0.07] ring-emerald-500/20",
            )}
          />
          <Orb key={voice.speaking ? "speaking" : "listening"} state={voice.speaking ? "composing" : "listening"} size={64} className="relative" />
        </span>
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          {voice.speaking ? who : "Listening to you"}
        </span>
      </div>
    </section>
  );
}

/**
 * How long this answer has run, against how long one like it usually runs (live/answerPace.ts). It starts with the
 * first words, so thinking time before answering doesn't count; a new question (its key) starts it again.
 */
function AnswerTimer({ live, q }: { live: LiveViewState; q: NonNullable<LiveViewState["mock"]> }) {
  // The turns already there when the question came: the answer is what's said after them.
  const [from] = useState(live.turnOrder.length);
  const words = answerWords(live, from);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (words > 0 && startedAt === null) {
      const t = Date.now();
      setStartedAt(t);
      setNow(t);
    }
  }, [words, startedAt]);
  useEffect(() => {
    if (startedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const band = answerBand(q);
  if (startedAt === null) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Take a moment to think first. A good answer here runs {bandLabel(band)}.
      </p>
    );
  }
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const state = paceState(elapsed, band);
  // The track runs a quarter past the band's end, so "too long" has somewhere to go.
  const scale = band.max * 1.25;
  const pct = (n: number) => `${Math.min(n / scale, 1) * 100}%`;
  const note = state === "warming" ? `Keep going: aim for ${bandLabel(band)}` : state === "good" ? "Good length" : `Past ${clock(band.max)}: land the result and stop`;
  return (
    <div role="group" aria-label="Answer timer" className="max-w-md space-y-1.5">
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-display text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">{clock(elapsed)}</span>
        <span className="tabular-nums text-zinc-500 dark:text-zinc-400">· {words} word{words === 1 ? "" : "s"}</span>
        <span
          aria-live="polite"
          className={cx(
            "ml-auto text-xs font-medium",
            state === "good" ? "text-emerald-700 dark:text-emerald-300" : state === "long" ? "text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400",
          )}
        >
          {note}
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-zinc-500/15" aria-hidden="true">
        <span className="absolute inset-y-0 bg-emerald-500/25" style={{ left: pct(band.min), width: `calc(${pct(band.max)} - ${pct(band.min)})` }} />
        <span
          className={cx(
            // The answer clock: a full-width fill slid along (transform), a second at a time, linear like a clock.
            "absolute inset-0 rounded-full transition-transform duration-1000 ease-linear motion-reduce:transition-none",
            state === "good" ? "bg-emerald-500" : state === "long" ? "bg-amber-500" : "bg-indigo-500",
          )}
          style={{ transform: `translateX(calc(${pct(elapsed)} - 100%))` }}
        />
      </div>
    </div>
  );
}

/**
 * The text-only fallback: type the answer instead of saying it, when there's no microphone or speech-to-text is down
 * (open by itself then), or in a place you can't talk. Sending it is "I'm done": the interviewer moves on.
 */
function TypedAnswer({ micDown, onSend }: { micDown: boolean; onSend: (text: string) => void }) {
  const [open, setOpen] = useState(micDown);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (micDown) setOpen(true);
  }, [micDown]);
  const send = () => {
    if (!text.trim() || sent) return;
    onSend(text);
    setSent(true);
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
              className={cx("self-start text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
        Can't talk right now? Type your answer instead
      </button>
    );
  }
  return (
    <form
      className="max-w-xl space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {micDown && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
          Orbit can't hear your microphone, so type your answer. The interviewer reads it the same way.
        </p>
      )}
      <label htmlFor="typed-answer" className="sr-only">Your answer</label>
      <textarea
        id="typed-answer"
        value={text}
        disabled={sent}
        maxLength={MOCK_ANSWER_CHARS}
        rows={4}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Type your answer as you'd say it…"
        className={cx("w-full resize-y rounded-xl border border-zinc-200 bg-white/70 px-3 py-2 text-sm dark:border-zinc-800 " +
          "dark:bg-zinc-950/60 disabled:opacity-60", focusRing)}
      />
      <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <button type="submit" disabled={!text.trim() || sent}
                className={buttonClass("primary", "sm")}>
          {sent ? "Sent" : "Send answer"}
        </button>
        <span>{sent ? "The interviewer is reading it…" : "Ctrl+Enter to send · the interviewer moves on after it"}</span>
        <span className="ml-auto tabular-nums">{text.length > MOCK_ANSWER_CHARS - 400 ? `${MOCK_ANSWER_CHARS - text.length} left` : ""}</span>
      </div>
    </form>
  );
}

/** "Stuck? Show a structure": a shape for this kind of answer (live/answerHints.ts), closed until asked for. */
function StructureHint({ q }: { q: NonNullable<LiveViewState["mock"]> }) {
  const hint = answerHint(q.text, q.questionType);
  return (
    <details className="group max-w-md text-sm">
      <summary className={cx("cursor-pointer select-none text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}>
        Stuck? Show a structure
      </summary>
      <div className="mt-2 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.04] p-3">
        <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">{hint.name}</p>
        <ol className="mt-2 space-y-1.5">
          {hint.steps.map((step, i) => (
            <li key={step.label} className="flex gap-2">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-[0.65rem] font-semibold text-indigo-700 dark:text-indigo-300">
                {i + 1}
              </span>
              <span>
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{step.label}</span>
                <span className="text-zinc-600 dark:text-zinc-400"> · {step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

/**
 * A one-way (HireVue-style) prompt's clock (live/oneWay.ts): thinking time, then the answer time running down, and
 * the next prompt when it's up, as on those platforms. The server moves on a moment later by itself if this can't.
 */
function OneWayClock({ think, answer, onTimeUp }: { think: number; answer: number; onTimeUp: () => void }) {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const p = oneWayPhase((now - start) / 1000, think, answer);
  useEffect(() => {
    if (p.phase === "over") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [p.phase]);
  useEffect(() => {
    if (p.phase === "over" && !fired.current) {
      fired.current = true;
      onTimeUp();
    }
  }, [p.phase, onTimeUp]);
  const thinking = p.phase === "think";
  return (
    <div role="group" aria-label="Time for this prompt" className="max-w-md space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className={cx("text-xs font-semibold", thinking ? "text-sky-700 dark:text-sky-300" : "text-rose-700 dark:text-rose-300")}>
          {thinking ? "Thinking time" : p.phase === "answer" ? "Answer time" : "Time's up"}
        </span>
        <span className="font-display text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50" aria-live="off">
          {clock(p.left)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-500/15" aria-hidden="true">
        <span
          className={cx("block h-full w-full rounded-full transition-transform duration-300 ease-linear motion-reduce:transition-none", thinking ? "bg-sky-500" : "bg-rose-500")}
          style={{ transform: `translateX(${-p.progress * 100}%)` }}
        />
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {thinking
          ? `Plan your answer. Recording-style: you'll have ${clock(answer)} to answer, and it moves on when time's up.`
          : "Look at the camera, not the screen. Finish your point before the time runs out."}
      </p>
    </div>
  );
}

/**
 * Your own camera, mirrored, as a one-way interview shows it: on this device only, never recorded or sent. With the
 * camera coach, it can also measure (on this device) how much of the time you face the camera; only those numbers
 * are saved with the session.
 */
function SelfView({ coach }: { coach?: CameraCoach }) {
  const [on, setOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [coachState, setCoachState] = useState<"off" | "loading" | "on">("off");
  const video = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!on || !measuring || !coach) {
      setCoachState("off");
      return;
    }
    let stop: (() => void) | null = null;
    let cancelled = false;
    setCoachState("loading");
    const begin = () => {
      const el = video.current;
      if (!el) return;
      void coach.start(el).then(
        (s) => {
          if (cancelled) s();
          else {
            stop = s;
            setCoachState("on");
          }
        },
        () => {
          if (cancelled) return;
          setError("The camera coach couldn't start on this device. The camera still works.");
          setMeasuring(false);
        },
      );
    };
    const t = window.setTimeout(begin, 0); // after the video element mounts
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      stop?.();
    };
  }, [on, measuring, coach]);
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 320, height: 240, facingMode: "user" }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => {
        setError("The camera isn't available. Check the browser's permission for it.");
        setOn(false);
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on]);
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return null;
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOn(!on);
        }}
        aria-pressed={on}
        className={cx("text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing)}
      >
        {on ? "Hide my camera" : "Show my camera, to practise looking at it"}
      </button>
      {on && (
        <video
          ref={video}
          autoPlay
          muted
          playsInline
          aria-label="Your camera (only on this device, not recorded)"
          className="w-48 -scale-x-100 rounded-xl bg-zinc-900 ring-1 ring-zinc-200 dark:ring-white/10"
        />
      )}
      {coach && (
        <label className="flex max-w-sm items-start gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={measuring}
            onChange={(e) => {
              setError(null);
              setMeasuring(e.target.checked);
              if (e.target.checked) setOn(true);
            }}
          />
          <span>
            <span className="font-medium">Camera coach</span>
            {coachState === "loading" ? " (starting…)" : coachState === "on" ? " (measuring)" : ""}: how much of the time you face the camera,
            measured on this device. Video never leaves your device; only the numbers are saved with this session.
          </span>
        </label>
      )}
      {error && <p className="text-xs text-amber-700 dark:text-amber-300">{error}</p>}
    </div>
  );
}
