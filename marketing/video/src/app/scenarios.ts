/**
 * What happens in a frame of the app, on its virtual clock: the film passes a script (data, in the iframe's config)
 * and it runs here, in the app page itself, so a film only moves the clock.
 *
 * - `flow`: a recorded flow (fixtures/flows/<name>.json) answers the API on top of fixtures/recorded.json;
 * - `script`: steps at times in ms of the frame's clock: click, type, scroll, select, live (the server's side of
 *   the live session, docs/PROTOCOL.md), css.
 */
import { at, CONFIG, epochNow, setEpoch } from "./virtualTime";
import { useFlow } from "./fixtureApi";
import { server, whenConnected, type FakeSocket } from "./fakeLive";
import { setLevel } from "./media";
import resume from "../../fixtures/flows/resume.json";
import linkedin from "../../fixtures/flows/linkedin.json";
import offer from "../../fixtures/flows/offer.json";
import dayloop from "../../fixtures/flows/dayloop.json";
import live from "../../fixtures/flows/live.json";
import jobs from "../../fixtures/flows/jobs.json";
import video from "../../fixtures/flows/video.json";
import sabaReview from "../../fixtures/flows/sabaReview.json";

const FLOWS: Record<string, Record<string, unknown>> = { resume, linkedin, offer, dayloop, live, jobs, video, sabaReview };

/** What to act on: elements matching `sel` whose words include `text` ("=Save": exactly "Save"), inside the
 *  smallest block that has the words `row` too (a list row and its own button), the `nth` of them. */
export type Target = { sel?: string; text?: string; nth?: number; within?: string; row?: string };
export type Step =
  | { at: number; click: Target }
  | { at: number; type: Target; text: string; dur?: number }
  | { at: number; scroll: Target | number; dur?: number; offset?: number; within?: string }
  | { at: number; select: Target; value: string }
  | { at: number; live: string; data?: unknown; dur?: number }
  | { at: number; css: string }
  | { at: number; level: number }
  | { at: number; hide: Target }
  | { at: number; shiftClock: number };

export interface ScenarioConfig {
  flow?: string;
  script?: Step[];
  /** history.state for the first route (the live page reads { usr: { systemAudio } }). */
  historyState?: unknown;
  /** Shift the app's "now" (ms), e.g. a day later so an interview reads "tomorrow". */
  epochShift?: number;
}

// ── Finding things on the page ─────────────────────────────────────────────────────────────────────────────────
export function find(t: Target): HTMLElement | null {
  let scope: ParentNode = (t.within && document.querySelector(t.within)) || document;
  if (t.row) {
    const blocks = [...document.querySelectorAll<HTMLElement>("li, article, section, div")].filter((e) => norm(e.textContent ?? "").includes(norm(t.row!)) && e.getClientRects().length > 0);
    const rows = blocks.filter((b) => b.querySelector(t.sel ?? "button, a"));
    const smallest = rows.sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0))[0];
    if (smallest) scope = smallest;
  }
  const els = [...scope.querySelectorAll<HTMLElement>(t.sel ?? "button, a, [role=tab], [role=radio], label, summary")];
  const exact = t.text?.startsWith("=");
  const want = norm(exact ? t.text!.slice(1) : t.text ?? "");
  const match = t.text ? els.filter((e) => (exact ? norm(e.textContent ?? "") === want : norm(e.textContent ?? "").includes(want)) || norm(e.getAttribute("aria-label") ?? "") === want) : els;
  const visible = match.filter((e) => e.getClientRects().length > 0);
  // With words to find, the innermost element that has them (not a container of the whole page), in page order.
  const inner = t.text ? visible.filter((e) => !visible.some((o) => o !== e && e.contains(o))) : visible;
  return inner[t.nth ?? 0] ?? null;
}
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

function scroller(within?: string): { el: Element; get: () => number; set: (y: number) => void } {
  const el = (within && document.querySelector(within)) || document.scrollingElement || document.documentElement;
  return { el, get: () => el.scrollTop, set: (y) => (el.scrollTop = y) };
}

function smooth(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Runs `fn(progress)` every 16 ms of the virtual clock over `dur` ms. */
function over(dur: number, fn: (p: number) => void): void {
  const t0 = performance.now();
  fn(0);
  const id = window.setInterval(() => {
    const p = Math.min(1, (performance.now() - t0) / Math.max(1, dur));
    fn(p);
    if (p >= 1) window.clearInterval(id);
  }, 16);
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

// ── The live session's server side ─────────────────────────────────────────────────────────────────────────────
const SETTINGS = { auto_answer: true, length: "auto", style: "natural", answer_language: null, response_timing: "balanced", thinking: "off", coding_language: null, experience: "auto" };
let greeting: Array<{ type: string; data: unknown }> = [];

function greet(s: FakeSocket): void {
  for (const g of greeting) s.emit(g.type, g.data);
}

/** Macros a script can call by name: `{ at, live: "answer", data: {...}, dur }` and so on. */
const LIVE: Record<string, (data: unknown, dur: number) => void> = {
  // The question arrives word by word as the interviewer says it (partials), then as a final line.
  say: (d, dur) => {
    const { turn_id, speaker, text } = d as { turn_id: string; speaker: string; text: string };
    const words = text.split(" ");
    over(dur, (p) => {
      const n = Math.max(1, Math.round(words.length * p));
      if (p < 1) server("transcript.partial", { turn_id, speaker, text: words.slice(0, n).join(" ") });
      else server("transcript.final", { turn_id, speaker, text, start_ms: 0, end_ms: Math.round(dur) });
    });
  },
  // An answer streamed over `dur` ms: answer.started, chunks with more of the text each time, answer.completed.
  answer: (d, dur) => {
    const { answer_id, question_id, answer, size = "medium" } = d as { answer_id: string; question_id: string; answer: Record<string, unknown>; size?: string };
    server("state.changed", { state: "generating" });
    server("answer.started", { answer_id, question_id, length: "standard", size, reasoning: "light", source: "auto" });
    const words = String(answer.direct_answer ?? "").split(" ");
    server("state.changed", { state: "streaming" });
    let last = -1;
    over(dur, (p) => {
      const n = Math.round(words.length * Math.min(1, p / 0.86));
      if (n !== last && p < 1) {
        last = n;
        server("answer.chunk", { answer_id, partial: { ...answer, direct_answer: words.slice(0, n).join(" "), key_points: p > 0.9 ? answer.key_points : [], sources: [], follow_up: null } });
      }
      if (p >= 1) {
        server("answer.chunk", { answer_id, partial: answer });
        server("answer.completed", { answer_id, answer, latency: { first_token_ms: 620, total_ms: Math.round(dur) } });
        server("state.changed", { state: "answer_complete" });
      }
    });
  },
  // The candidate speaking: a partial line that grows (the key points tick off as they're said).
  speak: (d, dur) => {
    const { turn_id, text, from = "" } = d as { turn_id: string; text: string; from?: string };
    const before = from ? from.split(" ").length : 0;
    const words = text.split(" ");
    over(dur, (p) => {
      setLevel(p < 1 ? 0.6 + 0.4 * Math.sin(p * 40) : 0);
      const n = before + Math.max(1, Math.round((words.length - before) * p));
      server("transcript.partial", { turn_id, speaker: "candidate", text: words.slice(0, n).join(" ") });
    });
  },
  emit: (d) => {
    const { type, data } = d as { type: string; data: unknown };
    server(type, data);
  },
};

export function runScenario(): void {
  const cfg = CONFIG as typeof CONFIG & ScenarioConfig;
  const f = cfg.flow ? FLOWS[cfg.flow] : undefined;
  if (cfg.flow && !f) console.warn("[video] no flow", cfg.flow);
  if (f) {
    useFlow(f, (cfg as { flowEpoch?: number }).flowEpoch ?? 0);
    const meta = f.__meta as { recordedAt?: number } | undefined;
    if (meta?.recordedAt && CONFIG.epoch === undefined) setEpoch(meta.recordedAt + (cfg.epochShift ?? 0));
  }
  // The live page's greeting, as the local server sent it (the mock providers reported as working ones).
  const ws = (live.__ws as Array<{ kind: string; frame: { type: string; data: Record<string, unknown> } }>) ?? [];
  const keep = new Set(["session.started", "provider.status", "audio.mic_status", "audio.system_status"]);
  greeting = ws
    .filter((w) => w.kind === "interview" && keep.has(w.frame.type))
    .map((w) => {
      const data = { ...w.frame.data };
      if (w.frame.type === "provider.status" && data.state === "mock") Object.assign(data, { state: "ok", name: data.provider === "stt" ? "speech" : "ai" });
      if (w.frame.type.startsWith("audio.")) Object.assign(data, { state: "connected", detail: "receiving" });
      return { type: w.frame.type, data };
    });
  greeting.push({ type: "state.changed", data: { state: "listening" } });
  if (!greeting.some((g) => g.type === "session.started")) greeting.unshift({ type: "session.started", data: { state: "listening", settings: SETTINGS } });
  whenConnected(greet);
  if (cfg.historyState !== undefined) history.replaceState(cfg.historyState, "", location.pathname + location.search);

  for (const s of cfg.script ?? []) {
    at(s.at, () => {
      if ("click" in s) {
        const el = find(s.click);
        if (el) el.click();
        else console.warn("[video] nothing to click:", JSON.stringify(s.click));
      } else if ("type" in s) {
        const el = find({ sel: "input, textarea", ...s.type }) as HTMLInputElement | null;
        if (!el) return console.warn("[video] nothing to type into:", JSON.stringify(s.type));
        el.focus();
        over(s.dur ?? 900, (p) => setValue(el, s.text.slice(0, Math.round(s.text.length * p))));
      } else if ("select" in s) {
        const el = find({ sel: "select", ...s.select }) as HTMLSelectElement | null;
        if (el) setValue(el, s.value);
      } else if ("scroll" in s) {
        const sc = scroller(s.within);
        const from = sc.get();
        let to: number;
        if (typeof s.scroll === "number") to = s.scroll;
        else {
          const el = find({ sel: "*", ...s.scroll });
          if (!el) return console.warn("[video] nothing to scroll to:", JSON.stringify(s.scroll));
          to = from + el.getBoundingClientRect().top - (s.offset ?? 80);
        }
        over(s.dur ?? 900, (p) => sc.set(from + (to - from) * smooth(p)));
      } else if ("live" in s) {
        LIVE[s.live]?.(s.data, s.dur ?? 1000);
      } else if ("css" in s) {
        const st = document.createElement("style");
        st.textContent = s.css;
        document.head.appendChild(st);
      } else if ("level" in s) setLevel(s.level);
      else if ("hide" in s) {
        const el = find({ sel: "summary, button, h2, h3, p, div", ...s.hide });
        const box = (el?.closest("details") as HTMLElement | null) ?? el;
        if (box) box.style.display = "none";
      } else if ("shiftClock" in s) setEpoch(epochNow() + s.shiftClock);
    });
  }
}
