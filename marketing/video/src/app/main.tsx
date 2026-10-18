// The real Orbit web app for the films: apps/web's own App and providers, on the virtual clock and the recorded API.
// Order matters: the clock and the fakes are installed before any of the app's modules run.
import { CONFIG, settle, tick, nowMs, setEpoch } from "./virtualTime";
import { misses, log, useRecorded } from "./fixtureApi";
import { sockets } from "./fakeLive";
import { mediaLog, served } from "./media";
import recorded from "../../fixtures/recorded.json";
import { patchRecorded } from "../../fixtures/patches";
import { find, runScenario } from "./scenarios";

const rec = recorded as unknown as Record<string, unknown> & { __meta?: { recordedAt?: number } };
const base = rec.__meta?.recordedAt ?? Date.UTC(2026, 9, 18, 6, 30);
if (CONFIG.epoch === undefined) setEpoch(base + ((CONFIG as { epochShift?: number }).epochShift ?? 0));
useRecorded(patchRecorded(rec) as never);
runScenario();

const CLEAN_CSS = `
  a[href="/admin/users"], a[href^="/admin"], button[aria-label="Chat with support"], button[aria-label^="Support chat"] { display: none !important; }
  /* No blinking text caret in a still frame. */
  * { caret-color: transparent !important; }
  html { scrollbar-width: none; }
  ::-webkit-scrollbar { display: none; }
`;
const style = document.createElement("style");
style.textContent = CLEAN_CSS;
document.head.appendChild(style);

declare global {
  interface Window {
    __video: Record<string, unknown>;
  }
}

window.__video = {
  tick,
  settle,
  now: nowMs,
  misses,
  log,
  sockets,
  /** Each audio clip the page played on the virtual clock (Saba's voice): media.ts. */
  media: mediaLog,
  /** The voice files answered, in order (file|app ms|the words asked for). */
  voice: served,
  /** The page has drawn something and its fonts are in. */
  ready: () => (document.getElementById("root")?.childElementCount ?? 0) > 0 && document.fonts.status === "loaded",
  /** Where an element is in the page (CSS px), for the film's cursor and its spotlights. */
  rect: (selector: string, text?: string, row?: string) => {
    // The same element a script step would press (scenarios.ts find), so the film's cursor lands on it.
    const el = find({ sel: selector, text, row });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  },
};

await import("./boot");
