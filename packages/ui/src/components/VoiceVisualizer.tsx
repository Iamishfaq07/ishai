import { useEffect, useRef } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useMotion } from "../hooks/useMotion";
import { AnalyserReader, follow, rms, voiceLevel } from "../live/audioLevel";
import type { VoiceActivity } from "../live/voiceActivity";
import { cx } from "./cx";

/** What the interviewer is doing on the call (the video room's mood). */
export type VoiceMood = "joining" | "preparing" | "speaking" | "listening" | "hearing" | "thinking" | "paused";

/** How the visualizer moves: the app's motion level, or Off / the OS asking for less: a still meter ("static"). */
export type VoiceMotion = "full" | "reduced" | "static";

type Rgb = [number, number, number];
type Ink = "accent" | "accentSoft" | "voice" | "dim";

/** Each mood's look: the bars' colour and strength, and the presence disc's. One accent (hers); yours is light ink. */
const LOOK: Record<VoiceMood, { bar: Ink; barAlpha: number; disc: Ink; discAlpha: number }> = {
  speaking: { bar: "accent", barAlpha: 1, disc: "accent", discAlpha: 0.12 },
  listening: { bar: "accentSoft", barAlpha: 0.62, disc: "accent", discAlpha: 0.09 },
  hearing: { bar: "voice", barAlpha: 0.92, disc: "voice", discAlpha: 0.05 },
  thinking: { bar: "accentSoft", barAlpha: 0.5, disc: "accent", discAlpha: 0.09 },
  joining: { bar: "accentSoft", barAlpha: 0.6, disc: "accent", discAlpha: 0.07 },
  // About to speak (her line is on its way, D76): a slow breath in, in her colour.
  preparing: { bar: "accentSoft", barAlpha: 0.75, disc: "accent", discAlpha: 0.1 },
  paused: { bar: "dim", barAlpha: 0.6, disc: "dim", discAlpha: 0.07 },
};

const SIZES = {
  lg: { box: "h-44 w-44 sm:h-56 sm:w-56", bars: 40 },
  sm: { box: "h-24 w-24", bars: 24 },
} as const;

function readInks(el: Element): Record<Ink, Rgb> {
  const css = getComputedStyle(el);
  const rgb = (name: string, fallback: Rgb): Rgb => {
    const parts = css.getPropertyValue(name).trim().split(/[\s,]+/).map(Number);
    return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? (parts as Rgb) : fallback;
  };
  return {
    accent: rgb("--accent-400", [164, 139, 250]),
    accentSoft: rgb("--accent-300", [196, 181, 253]),
    voice: rgb("--ink-100", [238, 239, 247]),
    dim: rgb("--ink-400", [151, 156, 188]),
  };
}

const ease = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

/**
 * Saba's presence on the call: a voice, not a face. A soft disc with a row of rounded bars across it that rise and
 * fall with the real audio: her voice in the accent while she speaks, yours in light ink while she hears you, a calm
 * low wave while she listens, a shimmer travelling across while she thinks, bars rising in from flat as she joins,
 * and flat, dimmed bars while your mic is paused. Moods blend into each other (heights and colours ease), never snap.
 *
 * One canvas (sharp at any pixel ratio) drawn by one requestAnimationFrame loop that reads the audio directly, so React
 * never re-renders per frame. It sleeps while the tab is hidden or the visualizer is off screen, and while it's
 * settled and still (paused). At Gentle motion it moves less and slower; at Off, or when the OS asks for less motion,
 * it's a still meter of five bars updated a few times a second (VoiceMeter). The mood is always said in text beside it
 * (the room's status label); the canvas itself is decorative.
 */
export function VoiceVisualizer({
  mood,
  voice,
  mic,
  size = "lg",
  motion,
  className,
}: {
  mood: VoiceMood;
  /** Saba's voice (useInterviewerVoice's activity): drives the bars while she speaks. */
  voice?: VoiceActivity | null;
  /** The candidate's mic analyser: drives the bars while she hears you. */
  mic?: AnalyserNode | undefined;
  size?: "lg" | "sm";
  /** Preview a motion level (the component gallery); by default the app's setting and the OS decide. */
  motion?: VoiceMotion;
  className?: string;
}) {
  const app = useMotion();
  const osReduce = useMediaQuery("(prefers-reduced-motion: reduce)");
  const level: VoiceMotion = motion ?? (app === "off" || osReduce ? "static" : app === "reduced" ? "reduced" : "full");
  if (level === "static") return <VoiceMeter mood={mood} voice={voice} mic={mic} size={size} className={className} />;
  return <VoiceCanvas mood={mood} voice={voice} mic={mic} size={size} gentle={level === "reduced"} className={className} />;
}

function VoiceCanvas({
  mood,
  voice,
  mic,
  size,
  gentle,
  className,
}: {
  mood: VoiceMood;
  voice: VoiceActivity | null | undefined;
  mic: AnalyserNode | undefined;
  size: "lg" | "sm";
  gentle: boolean;
  className?: string | undefined;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const input = useRef({ mood, voice, mic });
  input.current = { mood, voice, mic };
  const wake = useRef<() => void>(() => undefined);
  const bars = SIZES[size].bars;

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (!el || !g) return;
    const n = bars;
    const half = n / 2;
    const values = new Float32Array(n);
    const targets = new Float32Array(n);
    const glows = new Float32Array(n); // per-bar extra strength (the thinking shimmer)
    const bands = new Float32Array(half);
    const micReader = new AnalyserReader();
    let inks = readInks(el);
    let inksAt = 0;
    const look = LOOK[input.current.mood];
    const bar: Rgb = [...inks[look.bar]];
    const disc: Rgb = [...inks[look.disc]];
    let barAlpha = look.barAlpha;
    let discAlpha = look.discAlpha;
    let loud = 0;
    // A listening nod (D76): a soft pulse on each new syllable of the candidate's voice.
    let nod = 0;
    let lastMic = 0;
    let moodNow = input.current.mood;
    let moodSince = performance.now();
    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let visible = true;
    let lastDraw = 0;

    const resize = () => {
      const box = el.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = box.width;
      height = box.height;
      el.width = Math.max(1, Math.round(width * dpr));
      el.height = Math.max(1, Math.round(height * dpr));
      lastDraw = 0;
      wake.current();
    };

    const shaped = new Float32Array(half);
    // A voice's bars: the spectrum smoothed across neighbours (so a gap between harmonics doesn't notch the middle),
    // blended with the overall level on a dome (centre tallest), so loudness moves them at once even where the
    // spectrum lags (the mic's analyser smooths it).
    const shape = (lvl: number) => {
      for (let k = 0; k < half; k++) {
        const left = bands[k === 0 ? 1 : k - 1] ?? 0;
        const right = bands[Math.min(half - 1, k + 1)] ?? 0;
        const smooth = (left + 2 * bands[k]! + right) / 4;
        const dome = 1 - 0.4 * Math.pow(k / Math.max(1, half - 1), 1.6);
        shaped[k] = Math.min(1, (0.7 * smooth + 0.3 * lvl) * dome);
      }
    };

    const idle = (k: number, t: number, amp: number) => 0.05 + amp * (0.5 + 0.5 * Math.sin(t * (gentle ? 1.3 : 2.3) - k * 0.55));

    const voiceFrame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden || !width) return;
      const { mood: m, voice: v, mic: a } = input.current;
      if (m !== moodNow) {
        moodNow = m;
        moodSince = now;
      }
      const busy = m === "speaking" || m === "hearing";
      // A calm mood draws at ~30 a second; a voice at the display's rate.
      if (!busy && lastDraw && now - lastDraw < 32) {
        raf = requestAnimationFrame(voiceFrame);
        return;
      }
      const dt = lastDraw ? Math.min(64, now - lastDraw) : 16;
      lastDraw = now;
      if (now - inksAt > 1000) {
        inks = readInks(el); // the accent can change in Settings
        inksAt = now;
      }
      const t = now / 1000;
      const since = now - moodSince;
      let lvl = 0;
      if (m === "speaking" && v) lvl = v.sample(bands, now);
      else if (m === "hearing" && a) lvl = micReader.read(a, bands);
      if (lvl > 0 || m === "speaking" || m === "hearing") shape(lvl);
      const scale = gentle ? 0.7 : 1;
      for (let i = 0; i < n; i++) {
        const k = i < half ? half - 1 - i : i - half; // distance from the centre: the low bands sit in the middle
        let target = 0;
        let glow = 0;
        switch (m) {
          case "speaking":
            target = v?.source() ? shaped[k]! : idle(k, t, 0.04);
            break;
          case "hearing":
            target = a ? shaped[k]! * 0.9 : idle(k, t, 0.1);
            break;
          case "listening":
            target = idle(k, t, gentle ? 0.04 : 0.07);
            break;
          case "thinking": {
            const period = gentle ? 2400 : 1500;
            const pos = ((now % period) / period) * (n + 10) - 5;
            glow = Math.exp(-((i - pos) ** 2) / (2 * 2.4 * 2.4));
            target = gentle ? 0.07 : 0.06 + 0.13 * glow;
            break;
          }
          case "preparing": {
            // A breath in, every 1.6 s: the bars lift together, a little more in the middle.
            const breath = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 1.6);
            target = 0.05 + (gentle ? 0.03 : 0.08) * breath * (1 - 0.45 * (k / half));
            break;
          }
          case "joining": {
            const rise = gentle ? 1 : ease((since - k * 32) / 480);
            target = rise * idle(k, t, 0.06);
            break;
          }
          case "paused":
            target = 0;
            break;
        }
        targets[i] = Math.min(1, target * (m === "speaking" || m === "hearing" ? scale : 1));
        values[i] = follow(values[i]!, targets[i]!, dt, gentle ? 110 : 28, gentle ? 320 : 95);
        glows[i] = follow(glows[i]!, glow, dt, 120, 220);
      }
      loud = follow(loud, lvl, dt, 60, 260);
      if (m === "hearing") {
        if (lvl - lastMic > 0.12 && lastMic < 0.4) nod = 1;
        lastMic = follow(lastMic, lvl, dt, 40, 120);
      }
      nod *= Math.exp(-dt / 240);
      const goal = LOOK[m];
      const tint = (from: Rgb, to: Rgb) => {
        for (let c = 0; c < 3; c++) from[c] = follow(from[c]!, to[c]!, dt, 220, 220);
      };
      tint(bar, inks[goal.bar]);
      tint(disc, inks[goal.disc]);
      // Joining at Gentle fades the bars in instead of raising them.
      const fadeIn = m === "joining" && gentle ? ease(since / 400) : 1;
      barAlpha = follow(barAlpha, goal.barAlpha * fadeIn, dt, 220, 220);
      discAlpha = follow(discAlpha, goal.discAlpha * (1 + (gentle ? 0.3 : 0.5) * loud + 0.6 * nod), dt, 60, 300);

      // Draw: the presence disc, its hairline, then the bars, vertically centred so they go up and down.
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      const cx0 = width / 2;
      const cy0 = height / 2;
      const r0 = Math.min(width, height) / 2 - 1;
      const r = r0 * (gentle ? 0.97 : 0.93 + 0.07 * loud + 0.03 * nod);
      const rgba = (c: Rgb, alpha: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, alpha))})`;
      g.beginPath();
      g.arc(cx0, cy0, r, 0, Math.PI * 2);
      g.fillStyle = rgba(disc, discAlpha);
      g.fill();
      g.lineWidth = 1;
      g.strokeStyle = rgba(disc, discAlpha * 2.2);
      g.stroke();
      if (!gentle && (m === "thinking" || m === "joining")) {
        // A short arc running round the hairline: working on it.
        const a0 = (now / 1300) * Math.PI * 2;
        g.beginPath();
        g.arc(cx0, cy0, r, a0, a0 + Math.PI * 0.42);
        g.lineWidth = 1.5;
        g.strokeStyle = rgba(inks.accentSoft, 0.55 * Math.min(1, since / 300));
        g.lineCap = "round";
        g.stroke();
      }
      const inner = r0 * 0.8;
      const spanHalf = inner * 0.86;
      const pitch = (spanHalf * 2) / n;
      const barW = Math.max(1.5, pitch * 0.52);
      g.lineCap = "round";
      g.lineWidth = barW;
      g.strokeStyle = rgba(bar, 1);
      for (let i = 0; i < n; i++) {
        const x = cx0 - spanHalf + pitch * (i + 0.5);
        const dx = x - cx0;
        const chord = 2 * Math.sqrt(Math.max(0, inner * inner - dx * dx));
        const maxH = Math.max(barW, chord * 0.84);
        const h = barW + values[i]! * (maxH - barW);
        const stem = Math.max(0, (h - barW) / 2);
        g.globalAlpha = Math.max(0, Math.min(1, barAlpha + glows[i]! * 0.5));
        g.beginPath();
        g.moveTo(x, cy0 - stem);
        g.lineTo(x, cy0 + stem + 0.01); // never zero-length: a flat bar is still a dot
        g.stroke();
      }
      g.globalAlpha = 1;

      // Paused and settled: nothing moves, so stop until the mood changes.
      let settled = m === "paused";
      if (settled) for (let i = 0; i < n && settled; i++) settled = Math.abs(values[i]! - targets[i]!) < 0.002;
      if (settled) settled = Math.abs(barAlpha - goal.barAlpha) < 0.005 && Math.abs(bar[0]! - inks[goal.bar][0]) < 0.5;
      if (!settled) raf = requestAnimationFrame(voiceFrame);
    };

    wake.current = () => {
      if (!raf && visible && !document.hidden) raf = requestAnimationFrame(voiceFrame);
    };
    const sizes = new ResizeObserver(resize);
    sizes.observe(el);
    const seen = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting);
      if (visible) wake.current();
    });
    seen.observe(el);
    const onVisibility = () => {
      if (!document.hidden) {
        lastDraw = 0;
        wake.current();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    resize();
    return () => {
      cancelAnimationFrame(raf);
      raf = 0;
      wake.current = () => undefined;
      sizes.disconnect();
      seen.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [bars, gentle]);

  useEffect(() => wake.current(), [mood, voice, mic]);

  return (
    <div className={cx("relative shrink-0", SIZES[size].box, className)} aria-hidden="true">
      <canvas ref={canvas} data-voice-visualizer="" data-mood={mood} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

const METER_MS = 160; // ~6 updates a second: a meter, not an animation
const METER_SHAPE = [0.5, 0.78, 1, 0.78, 0.5];

/**
 * The still version (motion Off, or the OS asking for less): five bars on a flat disc whose heights step with the
 * voice a few times a second, without transitions, and a meter for assistive technology. The room's status text says
 * what's happening.
 */
function VoiceMeter({
  mood,
  voice,
  mic,
  size,
  className,
}: {
  mood: VoiceMood;
  voice: VoiceActivity | null | undefined;
  mic: AnalyserNode | undefined;
  size: "lg" | "sm";
  className?: string | undefined;
}) {
  const meter = useRef<HTMLDivElement | null>(null);
  const input = useRef({ mood, voice, mic });
  input.current = { mood, voice, mic };
  const yours = mood === "hearing";
  useEffect(() => {
    const el = meter.current;
    if (!el) return;
    const bands = new Float32Array(8);
    let wave = new Float32Array(0);
    let shown = -1;
    const tick = () => {
      if (document.hidden) return;
      const { mood: m, voice: v, mic: a } = input.current;
      let lvl = 0;
      if (m === "speaking" && v) lvl = v.sample(bands, performance.now());
      else if (m === "hearing" && a) {
        if (wave.length !== a.fftSize) wave = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(wave);
        lvl = voiceLevel(rms(wave));
      }
      const stepped = Math.round(lvl * 10) / 10;
      if (stepped === shown) return;
      shown = stepped;
      el.setAttribute("aria-valuenow", String(Math.round(stepped * 100)));
      el.querySelectorAll<HTMLElement>("[data-bar]").forEach((b, i) => {
        b.style.height = `${Math.round((0.12 + 0.88 * stepped * METER_SHAPE[i]!) * 100)}%`;
      });
    };
    tick();
    const timer = window.setInterval(tick, METER_MS);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div
      className={cx(
        "relative flex shrink-0 items-center justify-center rounded-full ring-1",
        SIZES[size].box,
        yours ? "bg-white/[0.05] ring-white/15" : mood === "paused" ? "bg-white/[0.04] ring-white/10" : "bg-indigo-500/10 ring-indigo-400/25",
        className,
      )}
    >
      <div
        ref={meter}
        role="meter"
        aria-label={yours ? "Your voice level" : "Interviewer's voice level"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        className={cx("flex items-center", size === "lg" ? "h-16 gap-2 sm:h-20" : "h-9 gap-1")}
      >
        {METER_SHAPE.map((_, i) => (
          <span
            key={i}
            data-bar=""
            style={{ height: "12%" }}
            className={cx(
              "rounded-full",
              size === "lg" ? "w-2" : "w-1",
              yours ? "bg-zinc-100" : mood === "paused" ? "bg-zinc-500" : mood === "speaking" ? "bg-indigo-400" : "bg-indigo-300/60",
            )}
          />
        ))}
      </div>
    </div>
  );
}
