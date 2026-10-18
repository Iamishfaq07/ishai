/**
 * A clock the film moves. Imported first by the app page (src/app/main.tsx), before any of the app's code runs, so
 * everything time-based in the real app (timers, intervals, animation frames, Date, performance.now, and CSS
 * animations and transitions through the Web Animations API) follows `__video.tick(ms)` instead of the wall clock.
 * The same frame of a film therefore always shows the same picture, however long the machine took to draw it.
 *
 * React itself still schedules its renders on real time (a MessageChannel); a frame waits for them in `settle()`.
 * The page's settings (theme, motion, scenario, the fixed date) come in through `window.name`, set by the film
 * on the iframe, so frames side by side can differ without sharing storage.
 */

export interface VideoConfig {
  /** "light" | "dark" */
  theme?: string;
  /** The app's motion level: "full" plays the app's own animations on the film's clock. */
  motion?: "full" | "reduced" | "off";
  accent?: string;
  /** Which scripted scenario runs (src/app/scenarios.ts). */
  scenario?: string;
  /** Wall-clock time at virtual 0, in ms since the epoch (default: when the fixtures were recorded). */
  epoch?: number;
  /** Extra localStorage entries the app should start with. */
  storage?: Record<string, string>;
  /** Hide the app's floating support button and admin links. */
  clean?: boolean;
}

export const CONFIG: VideoConfig = (() => {
  try {
    return JSON.parse(window.name || "{}") as VideoConfig;
  } catch {
    return {};
  }
})();

const RealDate = Date;
const realRaf = window.requestAnimationFrame.bind(window);
const realSetTimeout = window.setTimeout.bind(window);
export const real = { raf: realRaf, setTimeout: realSetTimeout, now: performance.now.bind(performance), Date: RealDate };

let vnow = 0;
let epoch = CONFIG.epoch ?? RealDate.UTC(2026, 9, 18, 6, 30, 0);
export function setEpoch(ms: number): void {
  epoch = ms;
}
export const nowMs = (): number => vnow;
export const epochNow = (): number => epoch;

// ── Date ────────────────────────────────────────────────────────────────────────────────────────────────────────
function VDate(this: unknown, ...args: unknown[]): unknown {
  if (!(this instanceof VDate)) return new RealDate(epoch + vnow).toString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return args.length ? new (RealDate as any)(...args) : new RealDate(epoch + vnow);
}
VDate.prototype = RealDate.prototype;
VDate.now = () => epoch + vnow;
VDate.parse = RealDate.parse;
VDate.UTC = RealDate.UTC;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).Date = VDate;
performance.now = () => vnow;

// ── Timers and frames ───────────────────────────────────────────────────────────────────────────────────────────
type Timer = { id: number; due: number; seq: number; cb: (...a: unknown[]) => void; args: unknown[]; every: number | null };
const timers = new Map<number, Timer>();
let nextId = 1;
let seq = 1;
function add(cb: TimerHandler, ms: unknown, args: unknown[], every: boolean): number {
  const fn = typeof cb === "function" ? (cb as (...a: unknown[]) => void) : () => new Function(String(cb))();
  const delay = Math.max(0, Number(ms) || 0);
  const id = nextId++;
  timers.set(id, { id, due: vnow + delay, seq: seq++, cb: fn, args, every: every ? Math.max(4, delay) : null });
  return id;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = window as any;
w.setTimeout = (cb: TimerHandler, ms?: number, ...args: unknown[]) => add(cb, ms, args, false);
w.setInterval = (cb: TimerHandler, ms?: number, ...args: unknown[]) => add(cb, ms, args, true);
w.clearTimeout = (id: number) => void timers.delete(id);
w.clearInterval = (id: number) => void timers.delete(id);
let frames = new Map<number, FrameRequestCallback>();
w.requestAnimationFrame = (cb: FrameRequestCallback) => {
  const id = nextId++;
  frames.set(id, cb);
  return id;
};
w.cancelAnimationFrame = (id: number) => void frames.delete(id);
w.requestIdleCallback = (cb: IdleRequestCallback) => add(() => cb({ didTimeout: false, timeRemaining: () => 8 }), 1, [], false);
w.cancelIdleCallback = (id: number) => void timers.delete(id);

/** Things to do at a virtual time (a scenario's script): run before the timers due at the same moment. */
type Cue = { at: number; run: () => void; done?: boolean };
const cues: Cue[] = [];
export function at(ms: number, run: () => void): void {
  cues.push({ at: ms, run });
  cues.sort((a, b) => a.at - b.at);
}

function runCue(upTo: number): boolean {
  const c = cues.find((x) => !x.done && x.at <= upTo);
  if (!c) return false;
  c.done = true;
  vnow = Math.max(vnow, c.at);
  try {
    c.run();
  } catch (err) {
    console.error("[video] cue failed at", c.at, err);
  }
  return true;
}

/** Called after every tick (media playback follows the clock: src/app/media.ts). */
const afterTick: Array<(now: number) => void> = [];
export function onTick(fn: (now: number) => void): void {
  afterTick.push(fn);
}

/** Real work a frame must wait for before it's posed (an audio clip being decoded): counted here. */
let pendingWork = 0;
export async function pending<T>(p: Promise<T>): Promise<T> {
  pendingWork++;
  try {
    return await p;
  } finally {
    pendingWork--;
  }
}

/** Moves the clock to `to` ms: every cue, timer and interval due by then runs in order, then one animation frame. */
export function tick(to: number): void {
  if (to < vnow) to = vnow;
  for (let guard = 0; guard < 200000; guard++) {
    let best: Timer | null = null;
    for (const t of timers.values()) if (t.due <= to && (!best || t.due < best.due || (t.due === best.due && t.seq < best.seq))) best = t;
    const cue = cues.find((x) => !x.done && x.at <= to);
    if (cue && (!best || cue.at <= best.due)) {
      runCue(to);
      continue;
    }
    if (!best) break;
    vnow = Math.max(vnow, best.due);
    if (best.every) {
      best.due += best.every;
      best.seq = seq++;
    } else timers.delete(best.id);
    try {
      best.cb(...best.args);
    } catch (err) {
      console.error("[video] timer failed", err);
    }
  }
  vnow = to;
  for (const fn of afterTick) {
    try {
      fn(vnow);
    } catch (err) {
      console.error("[video] tick hook failed", err);
    }
  }
  const due = frames;
  frames = new Map();
  for (const cb of due.values()) {
    try {
      cb(vnow);
    } catch (err) {
      console.error("[video] frame callback failed", err);
    }
  }
  syncAnimations();
}

/** Every CSS animation and transition (and element.animate) plays on the virtual clock from when it was first seen. */
export function syncAnimations(): void {
  for (const a of document.getAnimations()) {
    const v = a as Animation & { __v0?: number; __skip?: boolean };
    if (v.__skip) continue;
    // Scroll-driven animations follow their scroller, not time.
    if (v.timeline && !(v.timeline instanceof DocumentTimeline)) {
      v.__skip = true;
      continue;
    }
    try {
      if (v.__v0 === undefined) {
        v.__v0 = vnow;
        v.pause();
      }
      v.currentTime = vnow - v.__v0;
    } catch {
      v.__skip = true;
    }
  }
}

/** Real time for React to commit what the last tick changed (MessageChannel tasks), then a painted frame. */
export async function settle(rounds = 2): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise<void>((r) => realSetTimeout(r, 0));
    syncAnimations();
  }
  // Decodes and the like finish before the frame is taken, so the picture never depends on how fast they were.
  for (let i = 0; pendingWork > 0 && i < 400; i++) await new Promise<void>((r) => realSetTimeout(r, 5));
  await new Promise<void>((r) => realRaf(() => r()));
  syncAnimations();
}

// ── Storage: each frame of the app keeps its own, so two windows of different themes don't share settings ──────
class MemoryStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}
const local = new MemoryStorage();
const session = new MemoryStorage();
Object.defineProperty(window, "localStorage", { value: local, configurable: true });
Object.defineProperty(window, "sessionStorage", { value: session, configurable: true });
local.setItem("orbit.cookies.v1", "1");
local.setItem("orbit.theme", CONFIG.theme ?? "light");
local.setItem("orbit.liveSettingsOpen", "closed");
local.setItem("orbit.design", JSON.stringify({ accent: CONFIG.accent ?? "nebula", textSize: "md", motion: CONFIG.motion ?? "full" }));
// Signed in here before (lib/auth.tsx): the app goes straight to the workbench instead of a public page.
local.setItem("orbit.browser-account-id", "2ee4a43b-6ebb-4406-bc25-01b205eef95c");
for (const [k, v] of Object.entries(CONFIG.storage ?? {})) local.setItem(k, v);
// What public/theme-init.js does before the first paint on the real site.
document.documentElement.classList.toggle("dark", (CONFIG.theme ?? "light") === "dark");

// ── Nothing speaks: headless Chrome's speechSynthesis plays through the speakers past --mute-audio ──────────────
try {
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak() {}, cancel() {}, pause() {}, resume() {}, getVoices: () => [], speaking: false, pending: false, paused: false,
      addEventListener() {}, removeEventListener() {}, onvoiceschanged: null,
    },
  });
} catch {
  // not configurable here: leave it (the render browser is muted too)
}
