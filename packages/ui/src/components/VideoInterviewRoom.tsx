import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Captions,
  CaptionsOff,
  Check,
  Mic,
  MicOff,
  PhoneOff,
  RotateCcw,
  ScanFace,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "../icons";
import type { LiveViewState } from "../live/reducer";
import type { InterviewerVoice } from "../live/useInterviewerVoice";
import type { LiveActions } from "../live/useLiveSession";
import { cx, focusRing } from "./cx";
import type { CameraCoach } from "./MockPanel";

/** The AI interviewer's name in the video room (the server's greeting says the same: live/mock_interviewer.py). */
export const INTERVIEWER_NAME = "Saba";

type Mood = "joining" | "speaking" | "listening" | "hearing" | "thinking" | "paused";

const MOOD_LABEL: Record<Mood, string> = {
  joining: "joining the call…",
  speaking: "speaking",
  listening: "listening",
  hearing: "listening to you",
  thinking: "thinking…",
  paused: "your mic is paused",
};

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Saba's presence on the call: a soft living orb (no fake human face). It breathes while she listens, swells with
 * rings and a voice wave while she speaks, and turns slowly while she thinks.
 */
function SabaOrb({ mood, size = "lg" }: { mood: Mood; size?: "lg" | "sm" }) {
  const speaking = mood === "speaking";
  const thinking = mood === "thinking" || mood === "joining";
  return (
    <div
      className={cx("relative flex items-center justify-center", size === "lg" ? "h-44 w-44 sm:h-56 sm:w-56" : "h-24 w-24")}
      aria-hidden="true"
    >
      {speaking && (
        <>
          <span className="absolute inset-4 rounded-full border border-fuchsia-300/40 motion-safe:animate-pulse-ring" />
          <span className="absolute inset-4 rounded-full border border-indigo-300/40 motion-safe:animate-pulse-ring [animation-delay:600ms]" />
        </>
      )}
      <span
        className={cx(
          "absolute inset-6 rounded-full bg-[conic-gradient(from_0deg,#818cf8,#c084fc,#f472b6,#38bdf8,#818cf8)] opacity-70 blur-2xl",
          thinking ? "motion-safe:animate-orbit-fast" : "motion-safe:animate-orbit",
        )}
      />
      <span
        className={cx(
          "absolute inset-8 overflow-hidden rounded-full bg-[radial-gradient(circle_at_30%_25%,#e0e7ff_0%,#a78bfa_28%,#6366f1_55%,#1e1b4b_100%)] shadow-[0_0_80px_-12px_rgba(167,139,250,0.9),inset_0_-12px_30px_rgba(15,10,60,0.6)] transition-transform duration-500 ease-out",
          speaking ? "scale-110" : mood === "listening" || mood === "hearing" ? "motion-safe:animate-[float_4s_ease-in-out_infinite]" : "scale-100",
        )}
      >
        <span className="absolute -left-1/4 top-1/4 h-1/2 w-[150%] rotate-12 bg-white/10 blur-md" />
      </span>
      {speaking && (
        <span className="absolute -bottom-1 flex h-6 items-end gap-1">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span
              key={i}
              className="w-1 origin-bottom rounded-full bg-white/90 motion-safe:animate-wave"
              style={{ height: `${10 + ((i * 5) % 14)}px`, animationDelay: `${(i % 4) * 110}ms` }}
            />
          ))}
        </span>
      )}
    </div>
  );
}

/** A small live meter of your own voice (the mic's analyser), drawn without re-rendering React. */
function useMicLevel(analyser: AnalyserNode | undefined, el: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!analyser || !el.current) return;
    const node = el.current;
    const data = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 66) return; // ~15 a second is plenty for a meter
      last = t;
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i += 4) peak = Math.max(peak, Math.abs(data[i]! - 128));
      node.style.setProperty("--level", String(Math.min(1, peak / 48)));
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser, el]);
}

/** Your own camera, mirrored, on this device only: never recorded or sent. The camera coach (when on) measures it. */
function SelfTile({
  on,
  coach,
  coaching,
  analyser,
  micOn,
  speaking,
  className,
}: {
  on: boolean;
  coach?: CameraCoach;
  coaching: boolean;
  analyser?: AnalyserNode;
  micOn: boolean;
  speaking: boolean;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const tile = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useMicLevel(micOn ? analyser : undefined, tile);
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    setReady(false);
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
        setError(null);
      })
      .catch(() => setError("Camera unavailable. Check the browser's permission."));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on]);
  useEffect(() => {
    if (!on || !coaching || !coach || !video.current) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    const el = video.current;
    void coach.start(el).then(
      (s) => (cancelled ? s() : (stop = s)),
      () => undefined,
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [on, coaching, coach]);
  return (
    <div
      ref={tile}
      style={{ "--level": "0" } as React.CSSProperties}
      className={cx(
        "relative overflow-hidden rounded-3xl bg-zinc-900 ring-1 ring-white/10 transition-shadow duration-200",
        speaking && micOn && "shadow-[0_0_0_calc(2px+var(--level)*4px)_rgba(52,211,153,0.75)]",
        className,
      )}
    >
      {on && !error ? (
        <>
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            onLoadedData={() => setReady(true)}
            aria-label="Your camera (only on this device, not recorded)"
            className={cx("h-full w-full -scale-x-100 object-cover transition-opacity duration-500", ready ? "opacity-100" : "opacity-0")}
          />
          {!ready && <div className="absolute inset-0 animate-shimmer bg-[linear-gradient(110deg,#18181b_30%,#27272a_50%,#18181b_70%)] bg-[length:200%_100%]" />}
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-700 text-lg font-semibold text-white">You</span>
          <span className="text-xs text-zinc-400">{error ?? "Camera off"}</span>
        </div>
      )}
      <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
        {micOn ? (
          <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
            {[0.6, 1, 0.75].map((k, i) => (
              <span key={i} className="w-[3px] rounded-full bg-emerald-400 transition-[height] duration-75" style={{ height: `calc(3px + var(--level) * ${k * 9}px)` }} />
            ))}
          </span>
        ) : (
          <MicOff className="h-3 w-3 text-rose-300" aria-hidden />
        )}
        You
      </span>
    </div>
  );
}

function RoundButton({
  label,
  onClick,
  active,
  danger,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <span className="group relative flex flex-col items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
        className={cx(
          "flex h-10 w-10 items-center justify-center rounded-full transition-all duration-150 active:scale-95 disabled:opacity-35 min-[440px]:h-12 min-[440px]:w-12 sm:h-14 sm:w-14",
          danger
            ? "bg-rose-600 text-white hover:bg-rose-500"
            : active
              ? "bg-white text-zinc-900 hover:bg-zinc-200"
              : "bg-white/10 text-white hover:bg-white/20",
          focusRing,
        )}
      >
        {children}
      </button>
      <span className="pointer-events-none absolute -top-9 whitespace-nowrap rounded-md bg-zinc-800 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {label}
      </span>
    </span>
  );
}

/**
 * The AI video interview: a full-screen video call with Saba, the AI interviewer. Her tile (with captions of what
 * she asks) and your camera side by side, call controls in a dock. Under it, the same live mock interview: an
 * opening introduction, questions from the job description, the resume or the chosen topic, follow-ups on what you
 * said, then a graded report. Nothing is recorded: the camera stays on this device, and only the transcript (if you
 * keep transcripts) and the review are saved.
 */
export function VideoInterviewRoom({
  title,
  live,
  actions,
  voice,
  ended,
  paused,
  muted,
  onMutedChange,
  candidateText,
  cameraCoach,
  analyser,
  banners,
  onEnd,
  onViewReport,
}: {
  title?: string;
  live: LiveViewState;
  actions: LiveActions;
  voice: InterviewerVoice;
  ended: boolean;
  paused: boolean;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  /** What you're saying, while it's being transcribed. */
  candidateText: string;
  cameraCoach?: CameraCoach;
  /** The mic's analyser: your voice meter. */
  analyser?: AnalyserNode;
  banners?: ReactNode;
  onEnd: () => void;
  onViewReport?: () => void;
}) {
  const q = live.mock;
  const [cameraOn, setCameraOn] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [coaching, setCoaching] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // "I'm done answering" was pressed: Saba is writing the next question until it arrives.
  const [waitingAfter, setWaitingAfter] = useState<string | null>(null);
  useEffect(() => {
    if (ended) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [ended]);
  useEffect(() => setWaitingAfter(null), [q?.questionId]);

  const elapsed = live.startedAt ? (now - live.startedAt) / 1000 : 0;
  const done = ended || live.mockCompleted;
  const mood: Mood = !q
    ? "joining"
    : voice.speaking
      ? "speaking"
      : waitingAfter === q.questionId
        ? "thinking"
        : paused
          ? "paused"
          : candidateText
            ? "hearing"
            : "listening";
  const progress = q && q.total ? Math.min(1, q.index / q.total) : 0;

  const finishAnswer = () => {
    if (!q) return;
    voice.stop();
    setWaitingAfter(q.questionId);
    actions.mockNext();
  };

  return (
    <div className="dark relative flex h-full min-h-0 flex-col overflow-hidden bg-[#07070c] text-zinc-100">
      <header className="relative flex shrink-0 items-center gap-3 px-4 py-3 sm:px-6">
        <span className="flex items-center gap-1.5 rounded-full bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-300">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400 motion-safe:animate-pulse" aria-hidden="true" />
          {done ? "Ended" : "Live"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">{title || "AI video interview"}</span>
        {q && !done && (
          <span className="hidden items-center gap-2 text-xs text-zinc-400 sm:flex">
            Question {q.index} of {q.total}
            {q.isFollowUp ? " · follow-up" : ""}
            <span className="h-1 w-24 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <span className="block h-full rounded-full bg-indigo-400 transition-[width] duration-700" style={{ width: `${progress * 100}%` }} />
            </span>
          </span>
        )}
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-medium tabular-nums text-zinc-300" aria-label="Time in the interview">
          {clock(elapsed)}
        </span>
      </header>
      <div className="relative">{banners}</div>

      {done ? (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center motion-safe:animate-fade-up">
          <SabaOrb mood="listening" />
          <h2 className="mt-2 font-display text-2xl font-semibold sm:text-3xl">Thanks, that's the end of the interview</h2>
          {live.mockSummary && live.mockSummary.answered !== undefined && (
            <p className="text-sm text-zinc-300">
              {live.mockSummary.answered} of {live.mockSummary.questions} answered
              {live.mockSummary.follow_ups ? ` · ${live.mockSummary.follow_ups} follow-up${live.mockSummary.follow_ups === 1 ? "" : "s"}` : ""}
              {elapsed > 0 ? ` · ${clock(elapsed)}` : ""}
            </p>
          )}
          <p className="max-w-md text-sm text-zinc-400">
            {INTERVIEWER_NAME} is writing your review: each answer graded against the job, with a stronger way to say it.
          </p>
          {onViewReport && (
            <button
              type="button"
              onClick={onViewReport}
              className={cx("mt-3 rounded-full bg-white px-6 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200", focusRing)}
            >
              View my report
            </button>
          )}
        </div>
      ) : (
        <main className="relative grid min-h-0 flex-1 gap-3 px-3 pb-2 md:grid-cols-2 sm:px-6">
          <section
            aria-label={`${INTERVIEWER_NAME}, AI interviewer`}
            className={cx(
              "relative flex min-h-0 flex-col overflow-hidden rounded-3xl bg-[#100f22] ring-1 transition-shadow duration-300",
              mood === "speaking" ? "ring-2 ring-indigo-400/70" : "ring-white/10",
            )}
          >
            <span className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-xs text-zinc-200 backdrop-blur" role="status">
              <span
                className={cx(
                  "h-1.5 w-1.5 rounded-full",
                  mood === "speaking" ? "bg-indigo-300" : mood === "hearing" ? "bg-emerald-400" : mood === "paused" ? "bg-amber-400" : "bg-zinc-400",
                  (mood === "thinking" || mood === "joining") && "motion-safe:animate-pulse",
                )}
                aria-hidden="true"
              />
              {INTERVIEWER_NAME} · {MOOD_LABEL[mood]}
            </span>
            <div className="flex flex-1 items-center justify-center pt-8">
              <SabaOrb mood={mood} />
            </div>
            {captions && q && (
              <div className="px-3 pb-3 sm:px-5 sm:pb-5" aria-live="polite">
                <div key={q.questionId} className="rounded-2xl bg-black/45 px-4 py-3 backdrop-blur-md motion-safe:animate-fade-up sm:px-5 sm:py-4">
                  <p className="mb-1 text-[11px] font-semibold text-indigo-300">{INTERVIEWER_NAME}</p>
                  <p className={cx("max-h-48 overflow-y-auto font-medium leading-relaxed text-white", q.text.length > 220 ? "text-sm sm:text-base" : "text-base sm:text-lg")}>{q.text}</p>
                </div>
              </div>
            )}
          </section>

          <div className="pointer-events-none absolute right-5 top-3 z-20 w-28 sm:w-36 md:pointer-events-auto md:static md:w-auto">
            <div className="pointer-events-auto relative flex h-full flex-col">
              <SelfTile
                on={cameraOn}
                coaching={coaching}
                micOn={!paused}
                speaking={Boolean(candidateText)}
                className="aspect-[3/4] shadow-2xl md:aspect-auto md:h-full md:shadow-none"
                {...(cameraCoach ? { coach: cameraCoach } : {})}
                {...(analyser ? { analyser } : {})}
              />
              {captions && candidateText && (
                <p className="absolute inset-x-3 bottom-12 hidden rounded-xl bg-black/50 px-3 py-2 text-sm text-emerald-100 backdrop-blur md:line-clamp-2">
                  {candidateText}
                </p>
              )}
            </div>
          </div>
        </main>
      )}

      {!done && (
        <footer className="relative flex shrink-0 flex-col items-center gap-2 px-3 pb-3 pt-2 sm:pb-4">
          {q && (
            <button
              type="button"
              onClick={finishAnswer}
              disabled={mood === "thinking"}
              className={cx(
                "flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 motion-ok:active:scale-[0.98] disabled:opacity-60",
                focusRing,
              )}
            >
              <Check className="h-4 w-4" aria-hidden />
              {mood === "thinking" ? `${INTERVIEWER_NAME} is thinking…` : "I'm done answering"}
            </button>
          )}
          {/* Six round buttons (seven with the camera coach): a size smaller below 440 px, so End stays on screen on a 360 px
              phone. */}
          <div className="flex items-center gap-1 rounded-full bg-white/[0.04] p-1.5 ring-1 ring-white/10 backdrop-blur min-[440px]:gap-2 min-[440px]:p-2 sm:gap-3">
            <RoundButton label={paused ? "Unmute mic" : "Mute mic"} onClick={actions.togglePause} active={paused} pressed={paused}>
              {paused ? <MicOff className="h-5 w-5" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
            </RoundButton>
            <RoundButton label={cameraOn ? "Turn camera off" : "Turn camera on"} onClick={() => setCameraOn(!cameraOn)} active={!cameraOn} pressed={!cameraOn}>
              {cameraOn ? <Video className="h-5 w-5" aria-hidden /> : <VideoOff className="h-5 w-5" aria-hidden />}
            </RoundButton>
            <RoundButton label={captions ? "Hide captions" : "Show captions"} onClick={() => setCaptions(!captions)} pressed={captions}>
              {captions ? <Captions className="h-5 w-5" aria-hidden /> : <CaptionsOff className="h-5 w-5" aria-hidden />}
            </RoundButton>
            <RoundButton
              label={muted ? `Unmute ${INTERVIEWER_NAME}` : `Mute ${INTERVIEWER_NAME}`}
              onClick={() => {
                if (!muted) voice.stop();
                onMutedChange(!muted);
              }}
              active={muted}
              pressed={muted}
            >
              {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
            </RoundButton>
            {q && (
              <RoundButton label={voice.speaking ? "Skip" : "Repeat the question"} onClick={voice.speaking ? voice.stop : voice.repeat} disabled={!voice.supported || muted}>
                <RotateCcw className="h-5 w-5" aria-hidden />
              </RoundButton>
            )}
            {cameraCoach && (
              <RoundButton label={coaching ? "Camera coach on (this device)" : "Camera coach (this device)"} onClick={() => setCoaching(!coaching)} active={coaching} pressed={coaching}>
                <ScanFace className="h-5 w-5" aria-hidden />
              </RoundButton>
            )}
            <span className="mx-0.5 h-8 w-px bg-white/10" aria-hidden="true" />
            <RoundButton label="End interview" onClick={onEnd} danger>
              <PhoneOff className="h-5 w-5" aria-hidden />
            </RoundButton>
          </div>
          <p className="text-center text-[11px] text-zinc-500">Your camera is never recorded or sent. Practice only: use it where AI practice is allowed.</p>
        </footer>
      )}

    </div>
  );
}
