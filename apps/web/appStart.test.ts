import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// public/app-start.js (inline in every built page's <head>): a page built as HTML starts the app once it has painted.
const SOURCE = readFileSync(new URL("./public/app-start.js", import.meta.url), "utf8");
const FILES = ["/assets/index-A.js", "/assets/jsx-runtime-B.js", "/assets/ui-C.js"];

type El = { tag: string; [key: string]: string };

/** The script run against a pretend page: what it appends to <head>, and the browser's hooks it left waiting. */
function page({ list = FILES as string[] | null, visible = true, paintTiming = true } = {}) {
  const appended: El[] = [];
  const timers: Array<() => void> = [];
  const frames: Array<() => void> = [];
  const listeners: Record<string, () => void> = {};
  let paints: ((entries: { getEntriesByName: (name: string) => unknown[] }, observer: { disconnect: () => void }) => void) | null = null;
  const document = {
    visibilityState: visible ? "visible" : "hidden",
    addEventListener: (type: string, fn: () => void) => {
      listeners[type] = fn;
    },
    getElementById: (id: string) => (id === "orbit-app" && list ? { textContent: JSON.stringify(list) } : null),
    createElement: (tag: string) => ({ tag }) as El,
    head: { appendChild: (el: El) => appended.push(el) },
  };
  class PerformanceObserver {
    static supportedEntryTypes = paintTiming ? ["paint", "largest-contentful-paint"] : ["navigation"];
    constructor(fn: typeof paints) {
      paints = fn;
    }
    observe() {}
    disconnect() {}
  }
  new Function("document", "PerformanceObserver", "setTimeout", "requestAnimationFrame", SOURCE)(
    document,
    PerformanceObserver,
    (fn: () => void) => timers.push(fn),
    (fn: () => void) => frames.push(fn),
  );
  listeners.DOMContentLoaded?.();
  const paint = (...names: string[]) => paints?.({ getEntriesByName: (n) => names.filter((x) => x === n) }, { disconnect() {} });
  return { appended, timers, frames, listeners, paint, runTimers: () => timers.splice(0).forEach((fn) => fn()) };
}

describe("app-start.js (the app after a built page's first paint)", () => {
  it("does nothing on a page that loads the app itself", () => {
    const p = page({ list: null });
    expect(p.appended).toEqual([]);
    expect(p.timers).toEqual([]);
  });

  it("waits for the first contentful paint, then loads the entry and what it imports, once", () => {
    const p = page();
    expect(p.appended).toEqual([]);
    p.paint("first-paint");
    expect(p.timers).toHaveLength(1); // only the fallback
    p.paint("first-paint", "first-contentful-paint");
    expect(p.timers).toHaveLength(2);
    p.timers.pop()!();
    expect(p.appended).toEqual([
      { tag: "script", type: "module", src: FILES[0], crossOrigin: "anonymous" },
      { tag: "link", rel: "modulepreload", href: FILES[1], crossOrigin: "anonymous" },
      { tag: "link", rel: "modulepreload", href: FILES[2], crossOrigin: "anonymous" },
    ]);
    // The fallback timer and a later tab switch don't load it again.
    p.runTimers();
    p.listeners.visibilitychange?.();
    expect(p.appended).toHaveLength(3);
  });

  it("starts at once in a background tab, after a few seconds without a paint, or when the tab is hidden", () => {
    expect(page({ visible: false }).appended).toHaveLength(3);
    const slow = page();
    slow.runTimers();
    expect(slow.appended).toHaveLength(3);
    const hidden = page();
    hidden.listeners.visibilitychange!();
    expect(hidden.appended).toHaveLength(3);
  });

  it("without paint timing, starts just after the next frame is drawn", () => {
    const p = page({ paintTiming: false });
    expect(p.frames).toHaveLength(1);
    p.frames[0]!();
    p.timers.pop()!();
    expect(p.appended).toHaveLength(3);
  });
});
