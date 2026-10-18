// The films' own layer: backdrops, kinetic type, the Orbit mark drawn on, a cursor, captions, spotlights. Every
// component here is a pure function of the clock `t` (seconds), so a frame always looks the same.
import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { Fmt } from "./engine";
import { clamp, ep, envelope, inOut, keys, lerp, out3, out4, out5, outBack, prog } from "./anim";

export const INK = "#0b0d14";
export const INK2 = "#454a63";
export const INK3 = "#6e7396";
export const ACCENT = "#7048F5";
export const ACCENT5 = "#8666FF";
export const ACCENT4 = "#A48BFA";
export const AURORA = "#22D3EE";
export const CANVAS_DARK = "#0B0F17";
export const FONT = "'IBM Plex Sans Variable', 'IBM Plex Sans', 'Nirmala UI', 'Yu Gothic UI', system-ui, sans-serif";

export const abs = (s: CSSProperties): CSSProperties => ({ position: "absolute", ...s });

/** A size for this format, from the 16:9 one (portrait and square frames are 1080 wide). */
export function fs(fmt: Fmt, landscape: number, portrait = landscape * 0.86, square = portrait * 0.94): number {
  return fmt.id === "16x9" ? landscape : fmt.id === "1x1" ? square : portrait;
}

// ── Backdrops ───────────────────────────────────────────────────────────────────────────────────────────────────
export function Backdrop({ fmt, mode, t, opacity = 1, z = 0 }: { fmt: Fmt; mode: "light" | "mist" | "ink"; t: number; opacity?: number; z?: number }) {
  const dark = mode === "ink";
  const base = dark ? CANVAS_DARK : mode === "mist" ? "#F5F6F8" : "#FFFFFF";
  const grid = dark ? "rgba(255,255,255,0.045)" : "rgba(20,22,45,0.05)";
  const drift = (t * 6) % 64;
  return (
    <div style={abs({ inset: 0, background: base, opacity, zIndex: z, overflow: "hidden" })}>
      <div
        style={abs({
          inset: -64,
          backgroundImage: `linear-gradient(${grid} 1px, transparent 1px), linear-gradient(90deg, ${grid} 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          transform: `translateY(${drift}px)`,
          maskImage: "radial-gradient(ellipse 75% 60% at 50% 30%, #000 20%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 75% 60% at 50% 30%, #000 20%, transparent 75%)",
        })}
      />
      <div
        style={abs({
          left: "50%",
          top: -fmt.h * 0.35,
          width: fmt.w * 1.3,
          height: fmt.h * 0.9,
          transform: "translateX(-50%)",
          background: dark
            ? "radial-gradient(closest-side, rgba(112,72,245,0.26), rgba(112,72,245,0.06) 55%, transparent)"
            : "radial-gradient(closest-side, rgba(134,102,255,0.13), rgba(134,102,255,0.03) 55%, transparent)",
        })}
      />
    </div>
  );
}

// ── Kinetic type ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Words that rise into place one after another (a mask, a short blur), and leave together. `*word*` is set in the
 * accent. `at` is when the first word starts; `out` when they all leave (omit to stay).
 */
export function Words({
  text, t, at, out, size, weight = 600, color = INK, lh = 1.08, ls = -0.032, align = "left", stagger = 0.055, dur = 0.7,
  style, accent = ACCENT, lineGap, rise = 0.62,
}: {
  text: string; t: number; at: number; out?: number; size: number; weight?: number; color?: string; lh?: number; ls?: number;
  align?: "left" | "center" | "right"; stagger?: number; dur?: number; style?: CSSProperties; accent?: string; lineGap?: number; rise?: number;
}) {
  const lines = text.split("\n");
  let i = 0;
  // *several words* across a line break are one accent run: a word opening with * starts it, one closing it ends it.
  let inAccent = false;
  const leave = out === undefined ? 0 : ep(t, out, out + 0.45, inOut);
  return (
    <div style={{ font: `${weight} ${size}px/${lh} ${FONT}`, letterSpacing: `${ls}em`, color, textAlign: align, ...style }}>
      {lines.map((line, li) => (
        <div key={li} style={{ display: "block", marginTop: li && lineGap ? lineGap : 0, whiteSpace: "nowrap" }}>
          {line.split(" ").map((raw, wi) => {
            const k = i++;
            if (raw.startsWith("*")) inAccent = true;
            const hot = inAccent;
            if (raw.replace(/[.,!?:;]+$/, "").endsWith("*")) inAccent = false;
            const word = raw.replace(/\*/g, "");
            const p = ep(t, at + k * stagger, at + k * stagger + dur, out5);
            const y = (1 - p) * rise + leave * -0.18;
            const o = clamp(p * 1.4) * (1 - leave);
            const blur = (1 - p) * 8 + leave * 6;
            return (
              <Fragment key={wi}>
                <span
                  style={{
                    display: "inline-block",
                    transform: `translateY(${y}em)`,
                    opacity: o,
                    filter: blur > 0.05 ? `blur(${blur}px)` : "none",
                    color: hot ? accent : undefined,
                  }}
                >
                  {word}
                </span>
                {wi < line.split(" ").length - 1 ? " " : ""}
              </Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Small sentence-case label with the product's dot, as the site's eyebrows. */
export function Eyebrow({ text, t, at, out, size = 26, color = ACCENT, dot = ACCENT, dark = false, style }: {
  text: string; t: number; at: number; out?: number; size?: number; color?: string; dot?: string; dark?: boolean; style?: CSSProperties;
}) {
  const p = ep(t, at, at + 0.6, out4);
  const o = p * (out === undefined ? 1 : 1 - ep(t, out, out + 0.4));
  return (
    <div
      style={{
        display: "inline-flex", alignItems: "center", gap: size * 0.45, padding: `${size * 0.32}px ${size * 0.62}px`, borderRadius: 999,
        background: dark ? "rgba(255,255,255,0.07)" : "rgba(112,72,245,0.08)", border: `1px solid ${dark ? "rgba(255,255,255,0.12)" : "rgba(112,72,245,0.18)"}`,
        font: `600 ${size}px/1 ${FONT}`, letterSpacing: "-0.01em", color, opacity: o, transform: `translateY(${(1 - p) * 14}px)`, ...style,
      }}
    >
      <span style={{ width: size * 0.36, height: size * 0.36, borderRadius: 99, background: dot }} />
      {text}
    </div>
  );
}

// ── The Orbit mark, drawn on ────────────────────────────────────────────────────────────────────────────────────
// Paths from marketing/brand/orbit-mark-*.svg and apps/web/src/marketing/BrandLogo.tsx (64-unit grid).
const RING = "M51.41 20.84 A23 23 0 1 1 43.16 12.59";
const RING_LEN = 2 * Math.PI * 23 * (315 / 360);
const SPARK = "M48.26 6.76 L50.34 13.66 L57.24 15.74 L50.34 17.82 L48.26 24.72 L46.18 17.82 L39.28 15.74 L46.18 13.66Z";
export const WORD =
  "M101.04 50.43Q97.25 50.43 94.26 48.88Q91.27 47.33 89.56 44.42Q87.85 41.51 87.85 37.45V36.67Q87.85 32.62 89.56 29.71Q91.27 26.79 94.26 25.24Q97.25 23.69 101.04 23.69Q104.83 23.69 107.81 25.24Q110.8 26.79 112.51 29.71Q114.22 32.62 114.22 36.67V37.45Q114.22 41.51 112.51 44.42Q110.8 47.33 107.81 48.88Q104.83 50.43 101.04 50.43ZM101.04 45.22Q104.26 45.22 106.31 43.14Q108.36 41.07 108.36 37.31V36.82Q108.36 33.05 106.33 30.98Q104.3 28.91 101.04 28.91Q97.82 28.91 95.77 30.98Q93.71 33.05 93.71 36.82V37.31Q93.71 41.07 95.77 43.14Q97.82 45.22 101.04 45.22ZM119.18 49.72V24.41H124.94V27.32H125.81Q126.4 25.76 127.72 25.03Q129.05 24.31 130.92 24.31H133.97V29.54H130.77Q128.25 29.54 126.65 30.89Q125.04 32.25 125.04 35.08V49.72ZM152.84 50.43Q149.29 50.43 147.37 49.18Q145.45 47.92 144.55 46.38H143.68V49.72H137.92V13.88H143.78V27.58H144.65Q145.23 26.59 146.22 25.72Q147.22 24.84 148.84 24.27Q150.46 23.69 152.84 23.69Q155.97 23.69 158.6 25.21Q161.22 26.73 162.81 29.65Q164.4 32.56 164.4 36.67V37.45Q164.4 41.57 162.81 44.48Q161.22 47.39 158.59 48.91Q155.96 50.43 152.84 50.43ZM151.11 45.3Q154.3 45.3 156.41 43.24Q158.52 41.18 158.52 37.31V36.82Q158.52 32.94 156.43 30.88Q154.35 28.82 151.11 28.82Q147.93 28.82 145.81 30.88Q143.7 32.94 143.7 36.82V37.31Q143.7 41.18 145.81 43.24Q147.93 45.3 151.11 45.3ZM169.36 49.72V24.41H175.22V49.72ZM172.29 21.21Q170.66 21.21 169.53 20.14Q168.4 19.08 168.4 17.36Q168.4 15.64 169.53 14.58Q170.66 13.52 172.29 13.52Q173.97 13.52 175.08 14.58Q176.18 15.64 176.18 17.36Q176.18 19.08 175.08 20.14Q173.97 21.21 172.29 21.21ZM191.05 49.72Q188.63 49.72 187.16 48.25Q185.7 46.78 185.7 44.3V29.29H179.07V24.41H185.7V16.27H191.56V24.41H198.83V29.29H191.56V43.3Q191.56 44.84 193.01 44.84H198.09V49.72Z";

/** The mark (and, with `word`, the wordmark) drawn on from `at`: the ring sweeps round, the core lands, the spark. */
export function Logo({ t, at, height, dark = false, word = false, wordAt, id = "lg", style }: {
  t: number; at: number; height: number; dark?: boolean; word?: boolean; wordAt?: number; id?: string; style?: CSSProperties;
}) {
  const ring = ep(t, at, at + 1.1, inOut);
  const core = ep(t, at + 0.35, at + 0.95, outBack);
  const spark = ep(t, at + 0.75, at + 1.3, outBack);
  const wa = wordAt ?? at + 0.7;
  const wp = ep(t, wa, wa + 0.8, out4);
  const ink = dark ? "#ffffff" : "#14162D";
  const w = word ? (height * 202) / 64 : height;
  return (
    <svg viewBox={word ? "0 0 202 64" : "0 0 64 64"} width={w} height={height} style={{ overflow: "visible", ...style }}>
      <defs>
        <linearGradient id={`${id}-r`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={ACCENT} />
          <stop offset="0.5" stopColor={ACCENT4} />
          <stop offset="1" stopColor={AURORA} />
        </linearGradient>
        <linearGradient id={`${id}-c`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#C4B5FD" />
          <stop offset="1" stopColor={ACCENT} />
        </linearGradient>
        <clipPath id={`${id}-wc`}>
          <rect x={80} y={0} width={130 * wp} height={64} />
        </clipPath>
      </defs>
      <path d={RING} fill="none" stroke={`url(#${id}-r)`} strokeWidth="8" strokeLinecap="round" strokeDasharray={RING_LEN} strokeDashoffset={RING_LEN * (1 - ring)} opacity={ring > 0.001 ? 1 : 0} />
      <circle cx="32" cy="32" r={8.5 * core} fill={`url(#${id}-c)`} />
      <path d={SPARK} fill={ink} transform={`translate(48.26 15.74) scale(${spark}) rotate(${(1 - spark) * -90}) translate(-48.26 -15.74)`} opacity={spark > 0.01 ? 1 : 0} />
      {word && (
        <g clipPath={`url(#${id}-wc)`}>
          <path d={WORD} fill={ink} transform={`translate(${(1 - wp) * -14} 0)`} opacity={wp} />
        </g>
      )}
    </svg>
  );
}

// ── Cursor ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type CursorKey = { t: number; x: number; y: number; click?: boolean };
/** A pointer that glides between keys (eased) and presses on the ones marked `click`. */
export function Cursor({ t, keys: ks, show, hide, scale = 1, z = 60 }: { t: number; keys: CursorKey[]; show: number; hide: number; scale?: number; z?: number }) {
  if (!ks.length || t < show - 0.01 || t > hide + 0.4) return null;
  let x = ks[0]!.x;
  let y = ks[0]!.y;
  for (let i = 1; i < ks.length; i++) {
    const a = ks[i - 1]!;
    const b = ks[i]!;
    if (t >= b.t) {
      x = b.x;
      y = b.y;
      continue;
    }
    if (t > a.t) {
      const p = inOut(prog(t, a.t, b.t));
      // a slight arc, like a hand
      const arc = Math.sin(p * Math.PI) * Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
      x = lerp(a.x, b.x, p);
      y = lerp(a.y, b.y, p) - arc;
    }
    break;
  }
  const o = ep(t, show, show + 0.3) * (1 - ep(t, hide, hide + 0.35));
  const press = Math.max(0, ...ks.filter((k) => k.click).map((k) => envelope(t, k.t - 0.08, k.t + 0.16, 0.08, 0.16)));
  const ripples = ks.filter((k) => k.click && t >= k.t && t < k.t + 0.7);
  return (
    <>
      {ripples.map((k, i) => {
        const p = prog(t, k.t, k.t + 0.7);
        return (
          <div key={i} style={abs({ left: k.x, top: k.y, width: 0, height: 0, zIndex: z - 1 })}>
            <div style={abs({ left: -40 * scale * out3(p), top: -40 * scale * out3(p), width: 80 * scale * out3(p), height: 80 * scale * out3(p), borderRadius: 999, border: `${2.5 * scale}px solid rgba(112,72,245,${0.55 * (1 - p)})`, background: `rgba(112,72,245,${0.12 * (1 - p)})` })} />
          </div>
        );
      })}
      <svg width={30 * scale} height={30 * scale} viewBox="0 0 24 24" style={abs({ left: x - 4 * scale, top: y - 2 * scale, zIndex: z, opacity: o, transform: `scale(${1 - press * 0.14})`, transformOrigin: "4px 2px", filter: "drop-shadow(0 3px 6px rgba(10,12,30,0.35))" })}>
        <path d="M4.5 2.2 L19.6 13.4 L12.6 14.3 L16.4 21.2 L13.6 22.6 L9.9 15.7 L4.9 20.4 Z" fill="#fff" stroke="#0b0d14" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </>
  );
}

// ── Spotlight on a part of a frame ──────────────────────────────────────────────────────────────────────────────
export function Spot({ r, t, at, out, pad = 10, radius = 14, z = 40, color = ACCENT5 }: {
  r: { x: number; y: number; w: number; h: number } | null; t: number; at: number; out: number; pad?: number; radius?: number; z?: number; color?: string;
}) {
  if (!r) return null;
  const o = envelope(t, at, out, 0.4, 0.4);
  if (o <= 0) return null;
  const grow = 1 + (1 - ep(t, at, at + 0.5, out4)) * 0.06;
  return (
    <div
      style={abs({
        left: r.x - pad, top: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2, borderRadius: radius, zIndex: z, opacity: o,
        boxShadow: `0 0 0 3px ${color}, 0 0 0 9px rgba(134,102,255,0.18), 0 12px 40px -8px rgba(112,72,245,0.45)`, transform: `scale(${grow})`,
      })}
    />
  );
}

// ── Captions (burned in: most feeds autoplay muted) ─────────────────────────────────────────────────────────────
export type Word = [string, number, number];
export type Chunk = { from: number; to: number; words: Word[] };

/** A caption box of a film's own: centred at x, y (film pixels), up to `max` letters a chunk, wrapping at `maxWidth`. */
export type CaptionBox = { x?: number; y?: number; max?: number; maxWidth?: number; size?: number };

const letters = (ws: Word[]) => ws.map((w) => w[0]).join(" ").length;
const ENDS = /[.?!:]$/;
const WEAK = /^(the|a|an|to|of|and|or|for|with|in|on|at|your|our|my|from|by|as|is)$/i;

/** Splits timed words into caption chunks that fit this format: about one line on 16:9, two short ones upright. */
export function chunk(words: Word[], fmt: Fmt, maxLetters?: number): Chunk[] {
  const max = maxLetters ?? (fmt.id === "16x9" ? 46 : fmt.id === "9x16" ? 34 : 36);
  const out: Chunk[] = [];
  let cur: Word[] = [];
  let len = 0;
  const flush = () => {
    if (!cur.length) return;
    out.push({ from: cur[0]![1], to: cur[cur.length - 1]![2], words: cur });
    cur = [];
    len = 0;
  };
  for (const w of words) {
    const add = w[0].length + (cur.length ? 1 : 0);
    if (cur.length && len + add > max) flush();
    cur.push(w);
    len += add;
    if (/[.?!:]$/.test(w[0]) && len > max * 0.45) flush();
    else if (/,$/.test(w[0]) && len > max * 0.7) flush();
  }
  flush();
  // A sentence's last word left on its own ("now.") reads badly: it and the chunk before are split evenly instead.
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    if (letters(cur.words) >= max * 0.34 || ENDS.test(prev.words[prev.words.length - 1]![0])) continue;
    const all = [...prev.words, ...cur.words];
    let best = -1;
    let worst = Infinity;
    for (let k = 1; k < all.length; k++) {
      const a = letters(all.slice(0, k));
      const b = letters(all.slice(k));
      if (a > max || b > max) continue;
      // a comma is a good place to break; after "the", "with" or "your" a bad one
      const last = all[k - 1]![0];
      const score = Math.max(a, b) - (/,$/.test(last) ? 6 : 0) + (WEAK.test(last) ? 4 : 0);
      if (score < worst) {
        worst = score;
        best = k;
      }
    }
    if (best < 0) continue;
    const head = all.slice(0, best);
    const tail = all.slice(best);
    out[i - 1] = { from: head[0]![1], to: head[head.length - 1]![2], words: head };
    out[i] = { from: tail[0]![1], to: tail[tail.length - 1]![2], words: tail };
  }
  // Each chunk stays until the next one starts (a short hold after the last word, never past the next).
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1];
    out[i]!.to = next ? Math.min(next.from, out[i]!.to + 0.9) : out[i]!.to + 0.7;
  }
  return out;
}

export function Captions({ t, fmt, chunks, dark = false, box = {} }: { t: number; fmt: Fmt; chunks: Chunk[]; dark?: boolean; box?: CaptionBox }) {
  const c = chunks.find((k) => t >= k.from - 0.05 && t < k.to);
  if (!c) return null;
  const size = box.size ?? (fmt.id === "16x9" ? 38 : fmt.id === "9x16" ? 50 : 44);
  const y = box.y ?? (fmt.id === "16x9" ? fmt.h - 92 : fmt.id === "9x16" ? fmt.h - fmt.safe.b - 70 : fmt.id === "4x5" ? fmt.h - 150 : fmt.h - 112);
  const o = envelope(t, c.from - 0.05, c.to, 0.12, 0.12);
  // centred on x: a full-width row moved so its middle is there
  const shift = box.x === undefined ? 0 : box.x - fmt.w / 2;
  return (
    <div style={abs({ left: shift, right: -shift, top: y, zIndex: 90, display: "flex", justifyContent: "center", pointerEvents: "none" })}>
      <div
        style={{
          transform: "translateY(-50%)", maxWidth: box.maxWidth ?? (fmt.id === "16x9" ? 1320 : fmt.w - 120), padding: `${size * 0.32}px ${size * 0.6}px`,
          borderRadius: size * 0.42, background: dark ? "rgba(255,255,255,0.92)" : "rgba(11,13,22,0.80)", color: dark ? INK : "#fff",
          font: `600 ${size}px/1.24 ${FONT}`, letterSpacing: "-0.012em", textAlign: "center", textWrap: "balance", opacity: o,
          boxShadow: "0 8px 30px -10px rgba(0,0,0,0.35)", backdropFilter: "blur(8px)",
        }}
      >
        {c.words.map((w, i) => (
          <span key={i} style={{ opacity: t >= w[1] - 0.04 ? 1 : 0.42 }}>
            {w[0]}
            {i < c.words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Little building blocks ──────────────────────────────────────────────────────────────────────────────────────
export function Fade({ t, at, out, dur = 0.5, children, style, y = 0, scale = 0 }: {
  t: number; at: number; out?: number; dur?: number; children: ReactNode; style?: CSSProperties; y?: number; scale?: number;
}) {
  const p = ep(t, at, at + dur, out4);
  const q = out === undefined ? 0 : ep(t, out, out + dur * 0.8, inOut);
  const o = p * (1 - q);
  if (o <= 0.001) return null;
  return <div style={{ ...style, opacity: o, transform: `${style?.transform ?? ""} translateY(${(1 - p) * y - q * y * 0.4}px) scale(${1 + (1 - p) * scale})` }}>{children}</div>;
}

/** A number that counts from `a` to `b` over [at, at+dur]. */
export function count(t: number, at: number, dur: number, a: number, b: number): number {
  return Math.round(keys(t, [[at, a], [at + dur, b, out4]]));
}
