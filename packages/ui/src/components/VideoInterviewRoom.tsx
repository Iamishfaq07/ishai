import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LiveViewState } from "../live/reducer";
import type { InterviewerVoice } from "../live/useInterviewerVoice";
import type { LiveActions } from "../live/useLiveSession";
import { cx, focusRing } from "./cx";
import type { CameraCoach } from "./MockPanel";

/** The AI interviewer's name in the video room. */
export const INTERVIEWER_NAME = "Nova";

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The interviewer's face in the call: a calm avatar that pulses while speaking and listens with a soft wave. */
function InterviewerAvatar({ state }: { state: "speaking" | "listening" | "thinking" }) {
  return (
    <div className="relative flex h-40 w-40 items-center justify-center sm:h-52 sm:w-52" aria-hidden="true">
      {state === "speaking" && (
        <>
          <span className="absolute inset-0 rounded-full bg-indigo-400/20 motion-safe:animate-ping" />
          <span className="absolute inset-3 rounded-full bg-indigo-400/25 motion-safe:animate-pulse" />
        </>
      )}
      <span
        className={cx(
          "absolute inset-6 rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-sky-400 shadow-[0_0_60px_-10px_rgba(129,140,248,0.8)] transition-transform duration-500",
          state === "speaking" ? "scale-105" : "scale-100",
        )}
      />
      <span className="relative font-display text-5xl font-semibold text-white sm:text-6xl">{INTERVIEWER_NAME.slice(0, 1)}</span>
      {state === "listening" && (
        <span className="absolute -bottom-3 flex items-end gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"
              style={{ height: `${8 + ((i * 7) % 14)}px`, animationDelay: `${i * 120}ms` }}
            />
          ))}
        </span>
      )}
    </div>
  );
}

/** Your own camera, mirrored, on this device only: never recorded or sent. The camera coach (when on) measures it. */
function SelfTile({ on, coach, coaching }: { on: boolean; coach?: CameraCoach; coaching: boolean }) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false })
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
    <div className="relative aspect-[4/3] w-36 overflow-hidden rounded-2xl bg-zinc-800 ring-1 ring-white/15 shadow-xl sm:w-60">
      {on && !error ? (
        <video ref={video} autoPlay muted playsInline aria-label="Your camera (only on this device, not recorded)" className="h-full w-full -scale-x-100 object-cover" />
      ) : (
        <div className="flex h-full items-center justify-center px-3 text-center text-xs text-zinc-300">{error ?? "Camera off"}</div>
      )}
      <span className="absolute bottom-1.5 left-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[11px] font-medium text-white">You</span>
    </div>
  );
}

const ctrl = cx(
  "flex h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium text-white ring-1 ring-white/15 transition-colors hover:bg-white/15 disabled:opacity-40",
  focusRing,
);

/**
 * The AI video interview: a video-call room with the interviewer's tile (their question as captions), your camera,
 * and call controls. Under it, the same live mock interview: questions from the job description, the resume or the
 * chosen topic, follow-ups on what you said, then a graded report. Nothing is recorded: the camera stays on this
 * device, and only the transcript (if you keep transcripts) and the review are saved.
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
  banners?: ReactNode;
  onEnd: () => void;
  onViewReport?: () => void;
}) {
  const q = live.mock;
  const [cameraOn, setCameraOn] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [coaching, setCoaching] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (ended) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [ended]);
  const elapsed = live.startedAt ? (now - live.startedAt) / 1000 : 0;
  const state: "speaking" | "listening" | "thinking" = voice.speaking ? "speaking" : q && !paused ? "listening" : "thinking";
  const done = ended || live.mockCompleted;

  return (
    <div className="dark relative flex h-full min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 items-center gap-3 px-4 py-3 sm:px-6">
        <span className="flex h-2.5 w-2.5 rounded-full bg-rose-500 motion-safe:animate-pulse" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title || "AI video interview"}</span>
        {q && !done && (
          <span className="hidden text-xs text-zinc-400 sm:inline">
            Question {q.index} of {q.total}
            {q.isFollowUp ? " · follow-up" : ""}
          </span>
        )}
        <span className="font-mono text-sm tabular-nums text-zinc-300" aria-label="Time in the interview">
          {clock(elapsed)}
        </span>
      </header>
      {banners}

      {done ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <InterviewerAvatar state="thinking" />
          <h2 className="mt-4 font-display text-2xl font-semibold">That's the end of the interview</h2>
          {live.mockSummary && live.mockSummary.answered !== undefined && (
            <p className="text-sm text-zinc-300">
              {live.mockSummary.answered} of {live.mockSummary.questions} answered
              {live.mockSummary.follow_ups ? ` · ${live.mockSummary.follow_ups} follow-up${live.mockSummary.follow_ups === 1 ? "" : "s"}` : ""}
            </p>
          )}
          <p className="max-w-md text-sm text-zinc-400">
            {INTERVIEWER_NAME} is writing your review: each answer graded against the job, with a stronger way to say it.
          </p>
          {onViewReport && (
            <button type="button" onClick={onViewReport} className={cx("mt-2 rounded-full bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400", focusRing)}>
              View my report
            </button>
          )}
        </div>
      ) : (
        <div className="relative mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl bg-gradient-to-b from-zinc-900 to-zinc-950 ring-1 ring-white/10 sm:mx-6">
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 pt-6">
            <InterviewerAvatar state={state} />
            <div className="text-center">
              <p className="font-display text-lg font-semibold">{INTERVIEWER_NAME}</p>
              <p className="text-xs text-zinc-400">
                AI interviewer ·{" "}
                <span role="status">{!q ? "joining the call…" : state === "speaking" ? "speaking" : paused ? "paused" : "listening to you"}</span>
              </p>
            </div>
          </div>
          {captions && q && (
            <div className="mx-auto mb-4 w-full max-w-3xl px-4" aria-live="polite">
              <p key={q.questionId} className="rounded-2xl bg-black/50 px-5 py-3 text-center text-lg font-medium leading-snug text-white backdrop-blur motion-safe:animate-fade-up sm:text-xl">
                {q.text}
              </p>
              {candidateText && (
                <p className="mt-2 truncate text-center text-sm text-emerald-300">
                  <span className="text-zinc-400">You: </span>
                  {candidateText}
                </p>
              )}
            </div>
          )}
          <div className="absolute right-3 top-3 sm:right-5 sm:top-5">
            <SelfTile on={cameraOn} coaching={coaching} {...(cameraCoach ? { coach: cameraCoach } : {})} />
          </div>
        </div>
      )}

      {!done && (
        <footer className="flex shrink-0 flex-wrap items-center justify-center gap-2 px-4 pb-4 pt-1">
          <button type="button" className={cx(ctrl, paused && "bg-amber-500/25")} onClick={actions.togglePause} aria-pressed={paused}>
            {paused ? "Resume mic" : "Pause mic"}
          </button>
          <button type="button" className={cx(ctrl, !cameraOn && "bg-white/10")} onClick={() => setCameraOn(!cameraOn)} aria-pressed={!cameraOn}>
            {cameraOn ? "Camera off" : "Camera on"}
          </button>
          <button type="button" className={ctrl} onClick={() => setCaptions(!captions)} aria-pressed={captions}>
            {captions ? "Hide captions" : "Captions"}
          </button>
          <button
            type="button"
            className={ctrl}
            onClick={() => {
              if (!muted) voice.stop();
              onMutedChange(!muted);
            }}
            aria-pressed={muted}
          >
            {muted ? "Unmute Nova" : "Mute Nova"}
          </button>
          {q && (
            <button type="button" className={ctrl} disabled={!voice.supported || muted} onClick={voice.speaking ? voice.stop : voice.repeat}>
              {voice.speaking ? "Skip voice" : "Repeat"}
            </button>
          )}
          {q && (
            <button type="button" className={cx(ctrl, "bg-indigo-500/80 ring-indigo-400 hover:bg-indigo-500")} onClick={actions.mockNext}>
              I'm done answering
            </button>
          )}
          {cameraCoach && (
            <label className="flex items-center gap-2 rounded-full px-3 py-2 text-xs text-zinc-300 ring-1 ring-white/15">
              <input type="checkbox" checked={coaching} onChange={(e) => setCoaching(e.target.checked)} />
              Camera coach (on this device)
            </label>
          )}
          <button type="button" className={cx(ctrl, "bg-rose-600 ring-rose-500 hover:bg-rose-500")} onClick={onEnd}>
            End interview
          </button>
        </footer>
      )}
      <p className="pb-2 text-center text-[11px] text-zinc-500">Your camera is never recorded or sent. Practice only: use it where AI practice is allowed.</p>
    </div>
  );
}
