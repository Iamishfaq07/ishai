import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { useMicActivity } from "../hooks/useAudioLevel";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useMotion } from "../hooks/useMotion";
import {
  Captions,
  CaptionsOff,
  Check,
  Mic,
  MicOff,
  PanelRightOpen,
  PhoneOff,
  RotateCcw,
  ScanFace,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from "../icons";
import { formatHotkey, type HotkeyMap } from "../live/hotkeys";
import type { LiveViewState, TurnView } from "../live/reducer";
import type { InterviewerVoice } from "../live/useInterviewerVoice";
import type { LiveActions } from "../live/useLiveSession";
import type { VoiceActivity } from "../live/voiceActivity";
import { safeLocal } from "../storage";
import { cx, focusRing } from "./cx";
import { Tooltip } from "./Menu";
import type { CameraCoach } from "./MockPanel";
import type { TranscriptLine } from "./TranscriptLog";
import { Button, Kbd } from "./ui";
import { JoiningArt, WrapUpArt } from "./VideoRoomArt";
import { VideoRoomTranscript } from "./VideoRoomTranscript";
import { VoiceVisualizer, type VoiceMood } from "./VoiceVisualizer";

/** The AI interviewer's name in the video room (the server's greeting says the same: live/mock_interviewer.py). */
export const INTERVIEWER_NAME = "Saba";

type Mood = VoiceMood;

const MOOD_LABEL: Record<Mood, string> = {
  joining: "joining the call…",
  preparing: "about to speak…",
  speaking: "speaking",
  listening: "listening",
  hearing: "listening to you",
  thinking: "thinking…",
  paused: "your mic is paused",
};

/** What a screen reader hears when the mood changes. Your own talking isn't announced: it would talk over you. */
const MOOD_ANNOUNCED: Record<Mood, string> = {
  joining: `${INTERVIEWER_NAME} is joining the call`,
  preparing: `${INTERVIEWER_NAME} is about to speak`,
  speaking: `${INTERVIEWER_NAME} is speaking`,
  listening: `${INTERVIEWER_NAME} is listening`,
  hearing: `${INTERVIEWER_NAME} is listening`,
  thinking: `${INTERVIEWER_NAME} is thinking`,
  paused: "Your mic is paused",
};
/**
 * She acknowledges what they just said ("Mm-hmm.") when her reply is this slow to start (still being written, or her
 * voice on its way), at most every other time, and only right after they spoke (never before a check-in).
 */
const ACK_AFTER_MS = 450;
const ACK_HEARD_WITHIN_MS = 3000;

/** The transcript beside the call on wide screens: open or not, kept on this device. */
const TRANSCRIPT_KEY = "orbit.videoTranscript";
/** The join moment lasts at least this long, so it reads as a moment and not a flicker. */
const INTRO_MS = 900;

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Keeps something on screen for a moment after it goes, so it can fade out instead of vanishing. */
function useLeaving<T>(value: T | null, ms = 160): { shown: T | null; leaving: boolean } {
  const [kept, setKept] = useState<T | null>(value);
  useEffect(() => {
    if (value !== null) {
      setKept(value);
      return;
    }
    const t = window.setTimeout(() => setKept(null), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return { shown: value ?? kept, leaving: value === null && kept !== null };
}

type CoachState = "starting" | "on" | "failed";
const COACH_LABEL: Record<CoachState, string> = { starting: "Coach starting…", on: "Coach on", failed: "Coach couldn't start" };

/** Your own camera, mirrored, on this device only: never recorded or sent. The camera coach (when on) measures it. */
function SelfTile({
  on,
  coach,
  coaching,
  onCoachFailed,
  micOn,
  levelRef,
  className,
}: {
  on: boolean;
  coach?: CameraCoach;
  coaching: boolean;
  onCoachFailed: () => void;
  micOn: boolean;
  /** Where the room's mic follower writes your voice's --level (the speaking ring, the chip's meter). */
  levelRef: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [coachState, setCoachState] = useState<CoachState | null>(null);
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
    if (!on || !coaching || !coach || !video.current) {
      setCoachState((s) => (s === "failed" ? s : null));
      return;
    }
    let stop: (() => void) | null = null;
    let cancelled = false;
    const el = video.current;
    setCoachState("starting");
    void coach.start(el).then(
      (s) => {
        if (cancelled) return s();
        stop = s;
        setCoachState("on");
      },
      () => {
        if (cancelled) return;
        setCoachState("failed");
        onCoachFailed();
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [on, coaching, coach, onCoachFailed]);
  // "Couldn't start" says so for a few seconds, then goes.
  useEffect(() => {
    if (coachState !== "failed") return;
    const t = window.setTimeout(() => setCoachState(null), 6000);
    return () => window.clearTimeout(t);
  }, [coachState]);
  const chip = useLeaving(coachState);
  return (
    <div
      ref={levelRef}
      style={{ "--level": "0" } as React.CSSProperties}
      className={cx("relative overflow-hidden rounded-3xl bg-zinc-900 ring-1 ring-white/10", className)}
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
            className={cx("h-full w-full -scale-x-100 object-cover transition-opacity duration-page", ready ? "opacity-100" : "opacity-0")}
          />
          {!ready && <div className="absolute inset-0 animate-shimmer bg-[linear-gradient(110deg,rgb(var(--ink-900))_30%,rgb(var(--ink-800))_50%,rgb(var(--ink-900))_70%)] bg-[length:200%_100%]" />}
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-inset ring-white/15 sm:h-14 sm:w-14">
            <VideoOff className="h-5 w-5 text-zinc-300" aria-hidden />
          </span>
          <span className="text-xs text-zinc-300">{error ?? "Camera off"}</span>
        </div>
      )}
      <span className="speak-ring pointer-events-none absolute inset-0 rounded-3xl" aria-hidden="true" />
      {chip.shown && (
        <span
          key={chip.shown}
          role="status"
          className={cx(
            "absolute left-2 top-2 flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium",
            chip.shown === "failed" ? "text-amber-200" : "text-white",
            chip.leaving ? "animate-fade-out" : "animate-scale-in",
          )}
        >
          <ScanFace className={cx("h-3.5 w-3.5 shrink-0", chip.shown === "starting" && "coach-scan")} aria-hidden />
          <span className="truncate">{COACH_LABEL[chip.shown]}</span>
        </span>
      )}
      <span className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white">
        {micOn ? (
          <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
            {[0.6, 1, 0.75].map((k, i) => (
              <span key={i} className="level-bar w-[3px] rounded-full bg-zinc-100" style={{ height: `calc(3px + var(--level) * ${k * 9}px)` }} />
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

const CALL_TONE = {
  // A device that's on, or a plain action.
  default: "bg-white/[0.08] text-zinc-100 ring-1 ring-inset ring-white/10 hover:bg-white/[0.15]",
  // Something you turned off (mic, camera, Saba's voice): crossed out and toned, so it reads at a glance.
  off: "bg-rose-500/[0.18] text-rose-100 ring-1 ring-inset ring-rose-400/40 hover:bg-rose-500/[0.26]",
  // Something you turned on (the camera coach).
  active: "bg-indigo-500/25 text-indigo-50 ring-1 ring-inset ring-indigo-300/40 hover:bg-indigo-500/35",
  danger: "bg-rose-600 text-white ring-1 ring-inset ring-rose-400/40 hover:bg-rose-500",
} as const;

/**
 * A call control: a round icon button (40 px on a phone, then 48 and 52), named by its label, with a tooltip that
 * adds its keyboard shortcut where there is one. `wide` turns it into a pill with that text from 440 px up (End).
 */
function CallButton({
  label,
  shortcut,
  onClick,
  tone = "default",
  pressed,
  disabled,
  wide,
  children,
}: {
  label: string;
  shortcut?: string | undefined;
  onClick: () => void;
  tone?: keyof typeof CALL_TONE;
  pressed?: boolean;
  disabled?: boolean;
  wide?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip
      content={
        shortcut ? (
          <span className="flex items-center gap-2">
            {label}
            <Kbd>{shortcut}</Kbd>
          </span>
        ) : (
          label
        )
      }
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        {...(pressed !== undefined ? { "aria-pressed": pressed } : {})}
        className={cx(
          "flex h-10 min-w-10 items-center justify-center gap-2 rounded-full transition-[background-color,color,box-shadow,transform] duration-quick ease-standard motion-ok:active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40 min-[440px]:h-12 min-[440px]:min-w-12 sm:h-[52px] sm:min-w-[52px]",
          wide && "min-[440px]:px-5",
          CALL_TONE[tone],
          focusRing,
        )}
      >
        {children}
        {wide && <span className="hidden text-sm font-semibold min-[440px]:inline">{wide}</span>}
      </button>
    </Tooltip>
  );
}

/** "Live" with a calm pulse while the call runs (a fade at Gentle, still at Off); "Ended" after. */
function LiveBadge({ done }: { done: boolean }) {
  return (
    <span className={cx("flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", done ? "bg-white/[0.06] text-zinc-300" : "bg-rose-500/15 text-rose-200")}>
      <span className={cx("relative h-1.5 w-1.5 rounded-full", done ? "bg-zinc-400" : "live-dot bg-rose-400")} aria-hidden="true" />
      {done ? "Ended" : "Live"}
    </span>
  );
}

/**
 * Where the round is: one segment per question, each filling as its question arrives (it grows in at Full, fades in at
 * Gentle), and the number rolling over. Follow-ups don't add a segment: they're part of their question.
 */
function QuestionProgress({ index, total, followUp, className }: { index: number; total: number; followUp: boolean; className?: string }) {
  const segments = total > 0 && total <= 12;
  return (
    <span className={cx("flex items-center gap-2 text-xs text-zinc-300", className)}>
      <span className="tabular-nums">
        Question{" "}
        <span key={index} className="inline-block animate-fade-up">
          {index}
        </span>{" "}
        of {total}
        {followUp ? " · follow-up" : ""}
      </span>
      <span className="flex items-center gap-1" aria-hidden="true">
        {segments ? (
          Array.from({ length: total }, (_, i) => (
            <span key={i} className="h-1 w-5 overflow-hidden rounded-full bg-white/10">
              <span className={cx("progress-fill block h-full rounded-full bg-indigo-400", i < index ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0")} />
            </span>
          ))
        ) : (
          <span className="h-1 w-24 overflow-hidden rounded-full bg-white/10">
            <span className="progress-fill block h-full rounded-full bg-indigo-400" style={{ transform: `scaleX(${Math.min(1, index / Math.max(1, total))})` }} />
          </span>
        )}
      </span>
    </span>
  );
}

type Token = { text: string; start: number; end: number; word: number } | { space: string };

/** The question split into words with their offsets (and the spaces between, kept as they are). */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re = /(\s+)|(\S+)/g;
  let m: RegExpExecArray | null;
  let word = 0;
  while ((m = re.exec(text))) {
    if (m[1]) out.push({ space: m[1] });
    else out.push({ text: m[2]!, start: m.index, end: m.index + m[2]!.length, word: word++ });
  }
  return out;
}

/**
 * How much of her current line to show (D76): all of it ("all": her voice is off, motion is Off, she can't be heard,
 * or she's finished), what she's said so far, or nothing yet (she's about to speak). Never the whole line before she
 * says it. Read from the voice without re-rendering anything else.
 */
function useLineShown(activity: VoiceActivity, lineId: string | null, everything: boolean): number | "all" {
  const subscribe = useCallback((listener: () => void) => activity.subscribe(listener), [activity]);
  // A string snapshot: stable while nothing changes (useSyncExternalStore compares them).
  const snap = useSyncExternalStore(
    subscribe,
    () => {
      const r = activity.reveal();
      return r ? `${r.id}\u0000${r.upTo}\u0000${r.done ? 1 : 0}` : "";
    },
    () => "",
  );
  if (everything || !lineId) return "all";
  const [id, upTo, done] = snap.split("\u0000");
  if (id !== lineId) return 0;
  return done === "1" ? "all" : Number(upTo) || 0;
}

/**
 * What Saba says, as captions, appearing as she says it (D76): each word as she reaches it (it fades in), the one
 * she's on marked, nothing before she starts but a "…". When there's no voice to follow (hers is off, motion is Off,
 * she can't be heard) the whole line comes in at once, word after word at Full. Screen readers get the whole line
 * once, as it starts, never word by word.
 */
function LineCaption({ text, shown, activity, dimmed, header }: { text: string; shown: number | "all"; activity: VoiceActivity; dimmed: boolean; header: ReactNode }) {
  const tokens = useMemo(() => tokenize(text), [text]);
  const subscribe = useCallback((listener: () => void) => activity.subscribe(listener), [activity]);
  const current = useSyncExternalStore(subscribe, () => activity.word(), () => null);
  const following = shown !== "all";
  return (
    <div className="animate-rise">
      <div className={cx("rounded-2xl bg-black/50 px-4 py-3 transition-opacity duration-page sm:px-5 sm:py-4", dimmed && "opacity-60")}>
        <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold text-indigo-200">{header}</p>
        <p className="sr-only">{text}</p>
        <p aria-hidden="true" data-caption="" className={cx("max-h-48 min-h-[1.75em] overflow-y-auto font-medium leading-relaxed text-white", text.length > 220 ? "text-sm sm:text-base" : "text-base sm:text-lg")}>
          {following && shown === 0 ? <span className="caption-soon mood-dot-busy">…</span> : null}
          {tokens.map((t, i) =>
            "space" in t ? (
              following && i > 0 && "start" in (tokens[i - 1] ?? {}) && (tokens[i - 1] as { start: number }).start >= shown ? null : t.space
            ) : following && t.start >= shown ? null : (
              <span
                key={i}
                style={{ "--i": following ? 0 : Math.min(t.word, 40) } as React.CSSProperties}
                className={cx(
                  "caption-word",
                  following && current && t.start === current.start && "caption-now",
                )}
              >
                {t.text}
              </span>
            ),
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * The conversation so far, for the transcript: the server's turns, Saba's questions among them (it records each one
 * as the interviewer's line), without the interviewer's voice picked up by the mic. Times are when each line first
 * appeared here, on the interview's own clock.
 */
function useRoomTranscript(live: LiveViewState): TranscriptLine[] {
  const firstSeen = useRef(new Map<string, number>());
  const started = live.startedAt;
  return useMemo(() => {
    const out: TranscriptLine[] = [];
    for (const id of live.turnOrder) {
      const t: TurnView | undefined = live.turns[id];
      if (!t || t.echo || !t.text.trim()) continue;
      if (!firstSeen.current.has(id)) firstSeen.current.set(id, started ? Math.max(0, (Date.now() - started) / 1000) : 0);
      out.push({ id, speaker: t.speaker, text: t.text, final: t.final, at: firstSeen.current.get(id) ?? null });
    }
    return out;
  }, [live.turnOrder, live.turns, started]);
}

/**
 * Her current line in the transcript appears as she says it too (D76): not there before she starts, what she's said
 * so far while she speaks (drawn as a line still being heard, so screen readers get it once, when it's whole), all of
 * it once she's done.
 */
function useRevealedTranscript(lines: TranscriptLine[], text: string | null, shown: number | "all"): TranscriptLine[] {
  return useMemo(() => {
    if (shown === "all" || !text) return lines;
    let at = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.speaker === "interviewer" && lines[i]!.text === text) {
        at = i;
        break;
      }
    }
    if (at < 0) return lines;
    if (shown === 0) return [...lines.slice(0, at), ...lines.slice(at + 1)];
    const part = text.slice(0, shown).trimEnd();
    return lines.map((l, i) => (i === at ? { ...l, text: part, final: false } : l));
  }, [lines, text, shown]);
}

/**
 * The AI video interview: a full-screen video call with Saba, the AI interviewer. Her tile (her voice, drawn as it
 * rises and falls, and captions of what she asks), your camera, the transcript, and call controls in a dock. Under it,
 * the same live mock interview: an opening introduction, questions from the job description, the resume or the chosen
 * topic, follow-ups on what you said, then a graded report. Nothing is recorded: the camera stays on this device, and
 * only the transcript (if you keep transcripts) and the review are saved.
 */
export function VideoInterviewRoom({
  title,
  subtitle,
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
  hotkeys,
  banners,
  onEnd,
  onViewReport,
}: {
  title?: string;
  /** Under the title: the role and company it's for. */
  subtitle?: string;
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
  /** The mic's analyser: your voice meter, and Saba's bars while she hears you. */
  analyser?: AnalyserNode;
  /** The live panel's shortcuts (shown in the controls' tooltips). */
  hotkeys?: HotkeyMap;
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
  const [introDone, setIntroDone] = useState(false);
  const wide = useMediaQuery("(min-width: 1024px)");
  const [sideOpen, setSideOpen] = useState(() => safeLocal.getItem(TRANSCRIPT_KEY) !== "closed");
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    if (ended) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [ended]);
  useEffect(() => setWaitingAfter(null), [q?.questionId]);
  useEffect(() => {
    const t = window.setTimeout(() => setIntroDone(true), INTRO_MS);
    return () => window.clearTimeout(t);
  }, []);
  // The decoder for her clips, ready before her first line.
  useEffect(() => voice.activity.prepare?.(), [voice.activity]);

  const motion = useMotion();
  const osReduce = useMediaQuery("(prefers-reduced-motion: reduce)");
  const short = useMediaQuery("(max-height: 560px)");
  const still = motion === "off" || osReduce;
  const elapsed = live.startedAt ? (now - live.startedAt) / 1000 : 0;
  const done = ended || live.mockCompleted;
  const selfTile = useRef<HTMLDivElement | null>(null);
  // Your voice on the mic: the camera tile's ring, and "listening to you" the moment you speak (the transcript lags).
  // Not while Saba speaks: the mic hears her through the speakers then.
  const talking = useMicActivity(analyser, { enabled: !paused && !voice.speaking && !done, levelRef: selfTile, every: still ? 160 : undefined });
  // Her current line (a question, or small talk, a repeat, a check-in…): D76.
  const line = live.mockLine;
  const mood: Mood = !line
    ? "joining"
    : voice.phase === "speaking"
      ? "speaking"
      : voice.phase === "preparing"
        ? "preparing"
        : live.mockThinking || (q && waitingAfter === q.questionId)
          ? "thinking"
          : paused
            ? "paused"
            : candidateText || talking
              ? "hearing"
              : "listening";
  const onCoachFailed = useCallback(() => setCoaching(false), []);
  // Her line appears as she says it: in full only when there's no voice to follow (D76).
  const everything = muted || still || voice.phase === "blocked" || voice.phase === "unavailable";
  const shown = useLineShown(voice.activity, line?.id ?? null, everything);
  const lines = useRevealedTranscript(useRoomTranscript(live), line?.text ?? null, shown);
  const transcriptShown = wide ? sideOpen : drawerOpen;
  const setSide = (open: boolean) => {
    setSideOpen(open);
    safeLocal.setItem(TRANSCRIPT_KEY, open ? "open" : "closed");
  };
  const shortcut = (combo: string | undefined) => (combo ? formatHotkey(combo) : undefined);
  const intro = !introDone || !line;
  const { unlock } = voice;
  // The browser won't play her voice until a tap: any tap or key press anywhere plays it (and the button says so).
  useEffect(() => {
    if (voice.phase !== "blocked") return;
    const go = () => unlock();
    document.addEventListener("pointerdown", go, { capture: true, once: true });
    document.addEventListener("keydown", go, { capture: true, once: true });
    return () => {
      document.removeEventListener("pointerdown", go, { capture: true });
      document.removeEventListener("keydown", go, { capture: true });
    };
  }, [voice.phase, unlock]);
  // A short "Mm-hmm." when her reply is slow to start, right after they spoke, never twice in a row.
  const heardAt = useRef(0);
  useEffect(() => {
    if (talking || candidateText) heardAt.current = performance.now();
  }, [talking, candidateText]);
  const ackedLast = useRef(false);
  const { ack } = voice;
  const waiting = live.mockThinking || voice.phase === "preparing";
  const waitFor = voice.phase === "preparing" ? (line?.id ?? "") : "thinking";
  useEffect(() => {
    if (!waiting || muted || done) return;
    const t = window.setTimeout(() => {
      if (performance.now() - heardAt.current > ACK_HEARD_WITHIN_MS + ACK_AFTER_MS) return; // not an answer just given
      if (ackedLast.current) {
        ackedLast.current = false; // this time she just answers
        return;
      }
      ackedLast.current = true;
      ack();
    }, ACK_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [waiting, waitFor, muted, done, ack]);

  const finishAnswer = () => {
    if (!q) return;
    voice.stop();
    setWaitingAfter(q.questionId);
    actions.mockNext();
  };

  return (
    <div className="video-room dark relative flex h-full min-h-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <header className="relative flex shrink-0 items-center gap-3 px-4 py-3 sm:px-6">
        <LiveBadge done={done} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-medium text-zinc-100">{title || "AI video interview"}</h1>
          {subtitle && <p className="truncate text-xs text-zinc-400">{subtitle}</p>}
        </div>
        {q && !done && <QuestionProgress index={q.index} total={q.total} followUp={q.isFollowUp} className="hidden sm:flex" />}
        <span className="rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-medium tabular-nums text-zinc-300" aria-label="Time in the interview">
          {clock(elapsed)}
        </span>
        {wide && !done && !sideOpen && (
          <Tooltip content="Show the transcript">
            <button
              type="button"
              onClick={() => setSide(true)}
              aria-label="Show the transcript"
              aria-expanded={false}
              className={cx(
                "flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium text-zinc-200 transition-[background-color,transform] duration-quick hover:bg-white/[0.12] motion-ok:active:scale-[0.96]",
                focusRing,
              )}
            >
              <PanelRightOpen className="h-4 w-4" aria-hidden />
              Transcript
            </button>
          </Tooltip>
        )}
        {/* Phones: the round's progress as a hairline under the header (the caption card says which question). */}
        {q && !done && (
          <span className="absolute inset-x-4 bottom-0 h-0.5 overflow-hidden rounded-full bg-white/[0.06] sm:hidden" aria-hidden="true">
            <span className="progress-fill block h-full rounded-full bg-indigo-400" style={{ transform: `scaleX(${Math.min(1, q.index / Math.max(1, q.total))})` }} />
          </span>
        )}
      </header>
      <div className="relative">{banners}</div>

      {done ? (
        <div className="end-moment relative flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <WrapUpArt className="w-44 sm:w-52" />
          <h2 className="mt-1 font-display text-2xl font-semibold sm:text-3xl">Thanks, that's the end of the interview</h2>
          {live.mockSummary && live.mockSummary.answered !== undefined ? (
            <p className="flex flex-wrap items-center justify-center gap-2 text-sm text-zinc-200">
              <span className="rounded-full bg-white/[0.06] px-3 py-1 tabular-nums">
                {live.mockSummary.answered} of {live.mockSummary.questions} answered
              </span>
              {live.mockSummary.follow_ups ? (
                <span className="rounded-full bg-white/[0.06] px-3 py-1 tabular-nums">
                  {live.mockSummary.follow_ups} follow-up{live.mockSummary.follow_ups === 1 ? "" : "s"}
                </span>
              ) : null}
              {elapsed > 0 ? <span className="rounded-full bg-white/[0.06] px-3 py-1 tabular-nums">{clock(elapsed)}</span> : null}
            </p>
          ) : null}
          <p className="max-w-md text-sm text-zinc-300">
            {INTERVIEWER_NAME} is writing your review: each answer graded against the job, with a stronger way to say it.
          </p>
          {onViewReport ? (
            <button
              type="button"
              onClick={onViewReport}
              className={cx(
                "mt-3 rounded-full bg-white px-6 py-3 text-sm font-semibold text-zinc-900 transition-[background-color,transform] duration-quick hover:bg-zinc-200 motion-ok:active:scale-[0.96]",
                focusRing,
              )}
            >
              View my report
            </button>
          ) : null}
        </div>
      ) : (
        <main className="relative flex min-h-0 flex-1 gap-3 px-3 pb-2 sm:px-6">
          <div className="relative grid min-h-0 min-w-0 flex-1 gap-3 md:grid-cols-2">
            <section
              aria-label={`${INTERVIEWER_NAME}, AI interviewer`}
              className={cx(
                "relative flex min-h-0 flex-col overflow-hidden rounded-3xl bg-zinc-900 ring-1 transition-shadow duration-panel",
                mood === "speaking" ? "ring-indigo-400/50" : "ring-white/10",
              )}
            >
              <span aria-hidden="true" data-mood-label="" className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-full bg-black/40 px-2.5 py-1 text-xs text-zinc-200">
                <span
                  className={cx(
                    "h-1.5 w-1.5 rounded-full transition-colors duration-quick",
                    mood === "speaking" || mood === "preparing" ? "bg-indigo-300" : mood === "hearing" ? "bg-zinc-100" : mood === "paused" ? "bg-amber-400" : "bg-zinc-400",
                    (mood === "thinking" || mood === "joining" || mood === "preparing") && "mood-dot-busy",
                  )}
                />
                <span key={mood} className="animate-fade-in">
                  {INTERVIEWER_NAME} · {MOOD_LABEL[mood]}
                </span>
              </span>
              <span className="sr-only" role="status" aria-live="polite">
                {MOOD_ANNOUNCED[mood]}
              </span>
              <div className="flex flex-1 items-center justify-center pt-8">
                {intro ? (
                  <div className="flex flex-col items-center gap-2 px-6 text-center animate-scale-in">
                    <JoiningArt className="w-40 sm:w-52" />
                    <p className="text-sm font-medium text-zinc-100">Connecting you with {INTERVIEWER_NAME}…</p>
                    <p className="text-xs text-zinc-400">Your camera stays on this device.</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <VoiceVisualizer
                      mood={mood}
                      voice={voice.activity}
                      mic={analyser}
                      size={short || (!wide && drawerOpen) ? "sm" : "lg"}
                      className="animate-scale-in"
                    />
                    {voice.phase === "blocked" && (
                      // The browser won't play sound until a tap (autoplay): say so and offer one, never stay silent.
                      <div className="flex flex-col items-center gap-1.5 px-4 text-center animate-rise">
                        <button
                          type="button"
                          onClick={unlock}
                          className={cx(
                            "flex items-center gap-2 rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-[background-color,transform] duration-quick hover:bg-indigo-700 motion-ok:active:scale-[0.96]",
                            focusRing,
                          )}
                        >
                          <Volume2 className="h-4 w-4" aria-hidden />
                          Tap to hear {INTERVIEWER_NAME}
                        </button>
                        <p className="text-xs text-zinc-300" role="status">
                          Your browser paused her voice until you tap. Her words are below.
                        </p>
                      </div>
                    )}
                    {voice.phase === "unavailable" && !muted && (
                      <p className="max-w-xs px-4 text-center text-xs text-zinc-300 animate-rise" role="status">
                        {INTERVIEWER_NAME}'s voice is unavailable on this device right now. Read her questions below and
                        answer out loud as usual.
                      </p>
                    )}
                  </div>
                )}
              </div>
              {captions && line && !(!wide && drawerOpen) && (
                // The line is announced once: by the transcript when it's showing, by the caption when it isn't.
                <div className="px-3 pb-3 sm:px-5 sm:pb-5" aria-live={transcriptShown ? "off" : "polite"}>
                  <LineCaption
                    key={line.id}
                    text={line.text}
                    shown={shown}
                    activity={voice.activity}
                    dimmed={mood === "thinking"}
                    header={
                      <>
                        {INTERVIEWER_NAME}
                        {q && line.kind === "question" ? (
                          <span className="font-normal text-zinc-300 sm:hidden">
                            · Question {q.index} of {q.total}
                            {q.isFollowUp ? " · follow-up" : ""}
                          </span>
                        ) : null}
                      </>
                    }
                  />
                </div>
              )}
            </section>

            <div className="pointer-events-none absolute right-2 top-2 z-20 w-28 sm:w-36 md:pointer-events-auto md:static md:w-auto">
              <div className="pointer-events-auto relative flex h-full flex-col">
                <SelfTile
                  on={cameraOn}
                  coaching={coaching}
                  onCoachFailed={onCoachFailed}
                  micOn={!paused}
                  levelRef={selfTile}
                  className="aspect-[3/4] shadow-dialog md:aspect-auto md:h-full md:shadow-none"
                  {...(cameraCoach ? { coach: cameraCoach } : {})}
                />
                {captions && candidateText && !transcriptShown && (
                  <p className="absolute inset-x-3 bottom-12 hidden rounded-xl bg-black/60 px-3 py-2 text-sm text-zinc-100 animate-fade-in md:line-clamp-2">
                    {candidateText}
                  </p>
                )}
              </div>
            </div>
          </div>
          {wide && sideOpen && (
            <VideoRoomTranscript
              lines={lines}
              interviewer={INTERVIEWER_NAME}
              variant="side"
              open
              onOpenChange={setSide}
              className="w-[22rem] shrink-0 xl:w-[24rem]"
            />
          )}
        </main>
      )}

      {!done && !wide && (
        <div className="relative shrink-0 px-3 pb-1 sm:px-6">
          <VideoRoomTranscript lines={lines} interviewer={INTERVIEWER_NAME} variant="drawer" open={drawerOpen} onOpenChange={setDrawerOpen} />
        </div>
      )}

      {!done && (
        <footer className="relative flex shrink-0 flex-col items-center gap-2 px-3 pb-3 pt-2 sm:pb-4">
          {q && (
            <Tooltip content={hotkeys?.answer ? <span className="flex items-center gap-2">I'm done answering<Kbd>{formatHotkey(hotkeys.answer)}</Kbd></span> : "I'm done answering"}>
              <Button onClick={finishAnswer} disabled={mood === "thinking"} className="!rounded-full px-5">
                <Check className="h-4 w-4" aria-hidden />
                {mood === "thinking" ? `${INTERVIEWER_NAME} is thinking…` : "I'm done answering"}
              </Button>
            </Tooltip>
          )}
          {/* Six round buttons (seven with the camera coach): 40 px below 440 px, so End stays on screen on a 360 px phone;
              End is a pill with its name from 440 px up. */}
          <div className="flex items-center gap-1 rounded-full bg-white/[0.04] p-1.5 ring-1 ring-white/10 min-[440px]:gap-2 min-[440px]:p-2 sm:gap-2.5">
            <CallButton label={paused ? "Unmute mic" : "Mute mic"} shortcut={shortcut(hotkeys?.toggleListening)} onClick={actions.togglePause} tone={paused ? "off" : "default"} pressed={paused}>
              {paused ? <MicOff className="h-5 w-5" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
            </CallButton>
            <CallButton label={cameraOn ? "Turn camera off" : "Turn camera on"} onClick={() => setCameraOn(!cameraOn)} tone={cameraOn ? "default" : "off"} pressed={!cameraOn}>
              {cameraOn ? <Video className="h-5 w-5" aria-hidden /> : <VideoOff className="h-5 w-5" aria-hidden />}
            </CallButton>
            <CallButton label={captions ? "Hide captions" : "Show captions"} onClick={() => setCaptions(!captions)} pressed={captions}>
              {captions ? <Captions className="h-5 w-5" aria-hidden /> : <CaptionsOff className="h-5 w-5" aria-hidden />}
            </CallButton>
            <CallButton
              label={muted ? `Unmute ${INTERVIEWER_NAME}` : `Mute ${INTERVIEWER_NAME}`}
              onClick={() => {
                if (!muted) voice.stop();
                onMutedChange(!muted);
              }}
              tone={muted ? "off" : "default"}
              pressed={muted}
            >
              {muted ? <VolumeX className="h-5 w-5" aria-hidden /> : <Volume2 className="h-5 w-5" aria-hidden />}
            </CallButton>
            {q && (
              <CallButton label={voice.speaking ? "Skip" : "Repeat the question"} onClick={voice.speaking ? voice.stop : voice.repeat} disabled={!voice.supported || muted}>
                <RotateCcw className="h-5 w-5" aria-hidden />
              </CallButton>
            )}
            {cameraCoach && (
              <CallButton label={coaching ? "Camera coach on (this device)" : "Camera coach (this device)"} onClick={() => setCoaching(!coaching)} tone={coaching ? "active" : "default"} pressed={coaching}>
                <ScanFace className="h-5 w-5" aria-hidden />
              </CallButton>
            )}
            <span className="mx-0.5 h-8 w-px bg-white/10" aria-hidden="true" />
            <CallButton label="End interview" onClick={onEnd} tone="danger" wide="End">
              <PhoneOff className="h-5 w-5" aria-hidden />
            </CallButton>
          </div>
          <p className="text-center text-[11px] text-zinc-400">Your camera is never recorded or sent. Practice only: use it where AI practice is allowed.</p>
        </footer>
      )}
    </div>
  );
}
