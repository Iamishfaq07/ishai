/**
 * The film engine: a film is a list of scenes on one clock. `window.FILM.seek(t)` poses everything at t seconds:
 * the app frames (iframes of app.html, each on its own virtual clock that starts when the frame opens), then the
 * film's own layers, drawn by React from t alone. tools/render.mjs calls seek for every frame and takes a screenshot.
 */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { CSSProperties, ReactNode } from "react";
import { tick as filmTick, settle as filmSettle, real } from "../app/virtualTime";

// ── Formats ─────────────────────────────────────────────────────────────────────────────────────────────────────
export type FmtId = "16x9" | "9x16" | "1x1" | "4x5";
export interface Fmt {
  id: FmtId;
  w: number;
  h: number;
  /** Where the platform's own buttons and captions sit (px): keep words out of these bands. */
  safe: { t: number; b: number; l: number; r: number };
  portrait: boolean;
  square: boolean;
}
export const FORMATS: Record<FmtId, Fmt> = {
  "16x9": { id: "16x9", w: 1920, h: 1080, safe: { t: 54, b: 96, l: 96, r: 96 }, portrait: false, square: false },
  "9x16": { id: "9x16", w: 1080, h: 1920, safe: { t: 270, b: 390, l: 64, r: 120 }, portrait: true, square: false },
  "1x1": { id: "1x1", w: 1080, h: 1080, safe: { t: 64, b: 96, l: 64, r: 64 }, portrait: false, square: true },
  "4x5": { id: "4x5", w: 1080, h: 1350, safe: { t: 72, b: 140, l: 64, r: 64 }, portrait: true, square: false },
};

// ── App frames ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface FrameLayout {
  /** Centre of the frame on the stage (px), its scale, and an optional tilt (degrees). */
  cx: number;
  cy: number;
  scale: number;
  opacity?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  z?: number;
  /** 0..1: how much shadow it casts (it floats). */
  lift?: number;
  radius?: number;
  blur?: number;
  /** Dim the frame towards the backdrop (0..1), for a focus elsewhere. */
  dim?: number;
}
export type AppRect = { x: number; y: number; w: number; h: number };
export type Query = (selector: string, text?: string) => AppRect | null;

export interface FrameSpec {
  id: string;
  /** The app route the frame opens on. */
  path: string;
  scenario?: string;
  theme?: "light" | "dark";
  /** The app window's size in CSS px: its own media queries see this, so 390 wide is the phone layout. */
  viewport: [number, number];
  /** Film times it exists; its app clock reads `preroll` ms at `from`. */
  from: number;
  to: number;
  preroll?: number;
  /** Where the frame is at t; `q` finds an element inside it (app px), for a camera that follows something. */
  layout: (t: number, q: Query) => FrameLayout;
  /** A thin top bar with the address, for "on the web". */
  bar?: boolean;
  storage?: Record<string, string>;
  /** A recorded flow answering the API (fixtures/flows/<name>.json), from this point of it (99: its end). */
  flow?: string;
  flowEpoch?: number;
  /** GETs answered with the newest answer to a change: { "GET /v1/linkedin": "POST /v1/linkedin" }. */
  latest?: Record<string, string>;
  /** Fixed answers of the scene's own: { "GET /v1/voice": { status, body } }. */
  routes?: Record<string, unknown>;
  /** Saba's voice: the files (served by tools/render.mjs at /__vo/) the voice endpoint answers with, by their words. */
  voiceClips?: Array<{ text: string; file: string }>;
  /** What happens in the app, at film seconds after `from` (src/app/scenarios.ts `Step`, with `at` in seconds). */
  script?: Array<Record<string, unknown> & { at: number }>;
  historyState?: unknown;
  /** Shift the app's "now" by this many ms. */
  epochShift?: number;
  /** How fast the app's clock runs against the film's (1.5: its timers and animations half again as fast). */
  speed?: number;
  /** Answers that take a moment ("POST /v1/resumes/fix": 1400), on the app's clock. */
  delays?: Record<string, number>;
  theme2?: never;
}

/** Where an app point (CSS px in the frame) lands on the stage, for a layout without tilt. */
export function appToStage(spec: Pick<FrameSpec, "viewport">, l: FrameLayout, ax: number, ay: number): [number, number] {
  const [vw, vh] = spec.viewport;
  return [l.cx + (ax - vw / 2) * l.scale, l.cy + (ay - vh / 2) * l.scale];
}
/** The layout that puts app point (ax, ay) at stage point (sx, sy) at this scale. */
export function focus(viewport: [number, number], ax: number, ay: number, sx: number, sy: number, scale: number): FrameLayout {
  const [vw, vh] = viewport;
  return { cx: sx - (ax - vw / 2) * scale, cy: sy - (ay - vh / 2) * scale, scale };
}

// ── Sound and music cues (for audio/score.py) ───────────────────────────────────────────────────────────────────
export interface Cue {
  t: number;
  kind: string;
  dur?: number;
  gain?: number;
  pan?: number;
  [k: string]: unknown;
}

// ── Scenes and films ────────────────────────────────────────────────────────────────────────────────────────────
export interface Ctx {
  fmt: Fmt;
  t: number;
  /** A frame's stage rect for an element inside it (null until the frame has it). */
  rect: (frameId: string, selector: string, text?: string, row?: string) => { x: number; y: number; w: number; h: number } | null;
}
export interface Scene {
  id: string;
  from: number;
  to: number;
  render?: (t: number, ctx: Ctx) => ReactNode;
  frames?: FrameSpec[];
  cues?: Cue[];
}
export interface Caption {
  from: number;
  to: number;
  text: string;
}
export interface Film {
  id: string;
  fmt: Fmt;
  duration: number;
  scenes: Scene[];
  /** Music section markers: name and start time. */
  music: Array<{ name: string; t: number }>;
  bpm: number;
  captions: Caption[];
  /** Voice-over clips: file id and start time. */
  vo: Array<{ id: string; t: number; text: string; dur: number }>;
  /** Drawn over everything (captions, a progress hairline). */
  overlay?: (t: number, ctx: Ctx) => ReactNode;
  background?: string;
  /** Times good for a cover picture. */
  cover?: number;
}

// ── The frames host: iframes keep their element (and their app) from frame to frame ────────────────────────────
const STEP = 1000 / 60;
type Live = { spec: FrameSpec; el: HTMLIFrameElement; wrap: HTMLDivElement; booted: boolean; vt: number; gen: number };
const live = new Map<string, Live>();

function frameWindow(f: Live): (Window & { __video?: Record<string, (...a: unknown[]) => unknown> }) | null {
  return (f.el.contentWindow as never) ?? null;
}

function mount(spec: FrameSpec, host: HTMLElement, gen: number): Live {
  const wrap = document.createElement("div");
  wrap.className = "app-frame";
  const el = document.createElement("iframe");
  const pre = spec.preroll ?? 1200;
  el.name = JSON.stringify({
    theme: spec.theme ?? "light", motion: "full", storage: spec.storage ?? {}, clean: true, flow: spec.flow,
    historyState: spec.historyState, epochShift: spec.epochShift, delays: spec.delays, flowEpoch: spec.flowEpoch, latest: spec.latest, routes: spec.routes, voiceClips: spec.voiceClips,
    script: (spec.script ?? []).map((s) => ({ ...s, at: Math.round(s.at * 1000 * (spec.speed ?? 1) + pre), ...(typeof s.dur === "number" ? { dur: s.dur * (spec.speed ?? 1) } : {}) })),
  });
  el.src = spec.path;
  el.width = String(spec.viewport[0]);
  el.height = String(spec.viewport[1]);
  el.setAttribute("scrolling", "no");
  el.style.cssText = `border:0;display:block;width:${spec.viewport[0]}px;height:${spec.viewport[1]}px;background:transparent;`;
  if (spec.bar) {
    const bar = document.createElement("div");
    bar.className = `app-bar ${spec.theme === "dark" ? "dark" : ""}`;
    bar.innerHTML = `<span class="dots"><i></i><i></i><i></i></span><span class="addr"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>orbitanswer.com</span>`;
    wrap.appendChild(bar);
  }
  wrap.appendChild(el);
  host.appendChild(wrap);
  return { spec, el, wrap, booted: false, vt: 0, gen };
}

async function boot(f: Live): Promise<void> {
  // The page and its first chunks: wait (real time; this page's own clock is the film's) with the app's clock still
  // at 0. A page that hasn't drawn in 12 s is loaded again (a stalled request in a busy browser), twice at most.
  for (let attempt = 0; ; attempt++) {
    const t0 = real.now();
    let drawn = false;
    while (real.now() - t0 < 12000) {
      const w = frameWindow(f);
      if (w?.__video && (w.__video.ready as () => boolean)()) {
        drawn = true;
        break;
      }
      await new Promise((r) => real.setTimeout(r, 30));
    }
    if (drawn) break;
    if (attempt >= 2) throw new Error(`frame ${f.spec.id} (${f.spec.path}) never drew`);
    console.warn(`[video] frame ${f.spec.id} hasn't drawn: loading it again`);
    f.el.src = f.spec.path;
  }
  // Let late chunks and pictures arrive: until nothing new has loaded for a moment.
  let n = -1;
  let calm = 0;
  while (calm < 6) {
    const w = frameWindow(f) as unknown as Window;
    const now = w.performance.getEntriesByType("resource").length;
    calm = now === n ? calm + 1 : 0;
    n = now;
    await new Promise((r) => real.setTimeout(r, 40));
  }
  f.booted = true;
  await advance(f, f.spec.preroll ?? 1200);
}

async function advance(f: Live, target: number): Promise<void> {
  const w = frameWindow(f);
  if (!w?.__video) return;
  const v = w.__video as unknown as { tick: (ms: number) => void; settle: (n?: number) => Promise<void> };
  while (f.vt < target - 0.01) {
    f.vt = Math.min(target, f.vt + STEP);
    v.tick(f.vt);
    await v.settle(1);
  }
  await v.settle(2);
}

function place(f: Live, l: FrameLayout): void {
  const [vw, vh] = f.spec.viewport;
  const barH = f.spec.bar ? 34 : 0;
  const s = f.wrap.style;
  s.position = "absolute";
  s.left = `${l.cx - vw / 2}px`;
  s.top = `${l.cy - (vh + barH) / 2}px`;
  s.width = `${vw}px`;
  s.height = `${vh + barH}px`;
  s.transformOrigin = "50% 50%";
  s.transform = `perspective(2600px) scale(${l.scale}) rotateX(${l.rx ?? 0}deg) rotateY(${l.ry ?? 0}deg) rotateZ(${l.rz ?? 0}deg)`;
  s.opacity = String(l.opacity ?? 1);
  s.zIndex = String(l.z ?? 10);
  const lift = l.lift ?? 1;
  const r = l.radius ?? 14;
  s.borderRadius = `${r}px`;
  s.overflow = "hidden";
  s.boxShadow =
    lift > 0
      ? `0 0 0 1px rgba(15,18,30,${0.09 * lift}), 0 ${2 * lift}px ${4 * lift}px rgba(15,18,30,${0.05 * lift}), 0 ${24 * lift}px ${60 * lift}px -${12 * lift}px rgba(15,18,30,${0.28 * lift}), 0 ${60 * lift}px ${120 * lift}px -${40 * lift}px rgba(40,30,90,${0.22 * lift})`
      : "none";
  s.filter = [l.blur ? `blur(${l.blur}px)` : "", l.dim ? `brightness(${1 - l.dim * 0.5}) saturate(${1 - l.dim * 0.4})` : ""].filter(Boolean).join(" ") || "none";
  s.visibility = (l.opacity ?? 1) <= 0.001 ? "hidden" : "visible";
}

// ── The page ────────────────────────────────────────────────────────────────────────────────────────────────────
let root: Root | null = null;
let framesHost: HTMLDivElement | null = null;
let layer: HTMLDivElement | null = null;
let current: Film | null = null;
const layouts = new Map<string, FrameLayout>();

function ctxFor(film: Film, t: number): Ctx {
  return {
    fmt: film.fmt,
    t,
    rect: (frameId, selector, text, row) => {
      const f = live.get(frameId);
      const l = layouts.get(frameId);
      const w = f && frameWindow(f);
      if (!f || !l || !w?.__video) return null;
      const r = (w.__video.rect as (s: string, t?: string, row?: string) => { x: number; y: number; w: number; h: number } | null)(selector, text, row);
      if (!r) return null;
      const barH = f.spec.bar ? 34 : 0;
      const [x, y] = appToStage(f.spec, { ...l, cy: l.cy + (barH / 2) * l.scale }, r.x, r.y);
      return { x, y, w: r.w * l.scale, h: r.h * l.scale };
    },
  };
}

function draw(film: Film, t: number): void {
  const ctx = ctxFor(film, t);
  const visible = film.scenes.filter((s) => t >= s.from && t < s.to);
  flushSync(() => {
    root!.render(
      <>
        {visible.map((s) => (
          <div key={s.id} className="scene" data-scene={s.id}>
            {s.render?.(t, ctx)}
          </div>
        ))}
        {film.overlay?.(t, ctx)}
      </>,
    );
  });
}

export async function seek(t: number): Promise<void> {
  const film = current!;
  // Frames that exist at t: open new ones, close old ones, re-open one the clock went back past.
  const wanted = film.scenes.flatMap((s) => s.frames ?? []).filter((f) => t >= f.from && t < f.to);
  for (const [id, f] of live) {
    const spec = wanted.find((w) => w.id === id);
    const target = spec ? (t - spec.from) * 1000 * (spec.speed ?? 1) + (spec.preroll ?? 1200) : 0;
    if (!spec || target < f.vt - 0.5) {
      f.wrap.remove();
      live.delete(id);
    }
  }
  for (const spec of wanted) {
    if (!live.has(spec.id)) live.set(spec.id, mount(spec, framesHost!, 0));
  }
  for (const spec of wanted) {
    const f = live.get(spec.id)!;
    if (!f.booted) await boot(f);
    await advance(f, (t - spec.from) * 1000 * (spec.speed ?? 1) + (spec.preroll ?? 1200));
    const w = frameWindow(f);
    const cache = new Map<string, AppRect | null>();
    const q: Query = (sel, text) => {
      const k = `${sel}|${text ?? ""}`;
      if (!cache.has(k)) cache.set(k, ((w?.__video?.rect as (s: string, t?: string) => AppRect | null) ?? (() => null))(sel, text));
      return cache.get(k) ?? null;
    };
    const l = spec.layout(t, q);
    layouts.set(spec.id, l);
    place(f, l);
  }
  filmTick(t * 1000);
  draw(film, t);
  await filmSettle(2);
  unscroll();
}

/** An app's scrollIntoView (or a focus) scrolls every ancestor too, the film's own page included: put it back. */
function unscroll(): void {
  for (const el of [document.scrollingElement, document.documentElement, document.body, document.getElementById("film"), framesHost, layer]) {
    if (el && (el.scrollTop || el.scrollLeft)) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  }
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  for (const f of live.values()) {
    if (f.wrap.scrollTop || f.wrap.scrollLeft) {
      f.wrap.scrollTop = 0;
      f.wrap.scrollLeft = 0;
    }
  }
}

export function start(film: Film): void {
  current = film;
  const stage = document.getElementById("film")!;
  const s = stage.style as CSSProperties as Record<string, string>;
  s.width = `${film.fmt.w}px`;
  s.height = `${film.fmt.h}px`;
  s.background = film.background ?? "#ffffff";
  stage.className = `stage fmt-${film.fmt.id}`;
  layer = document.createElement("div");
  layer.className = "layer";
  framesHost = document.createElement("div");
  framesHost.className = "layer frames";
  stage.append(framesHost, layer);
  root = createRoot(layer);
}

export function cuesOf(film: Film): Cue[] {
  return film.scenes.flatMap((s) => s.cues ?? []).sort((a, b) => a.t - b.t);
}

/** Every audio clip each frame played (app ms on its clock), in film seconds: where Saba's voice really fell. */
export function mediaLogs(): Array<{ frame: string; at: number; end: number | null; duration: number; served: string | null }> {
  return [...live.values()].flatMap((f) => {
    const log = (frameWindow(f)?.__video?.media as unknown as Array<{ at: number; end: number | null; duration: number; served: string | null }>) ?? [];
    const toFilm = (ms: number) => f.spec.from + (ms - (f.spec.preroll ?? 1200)) / 1000 / (f.spec.speed ?? 1);
    return log.map((e) => ({ frame: f.spec.id, at: toFilm(e.at), end: e.end === null ? null : toFilm(e.end), duration: e.duration, served: e.served }));
  });
}

export function misses(): string[] {
  return [...live.values()].flatMap((f) => ((frameWindow(f)?.__video?.misses as unknown as string[]) ?? []).map((m) => `${f.spec.id}: ${m}`));
}
