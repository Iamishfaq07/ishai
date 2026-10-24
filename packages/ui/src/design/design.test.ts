import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCENTS, applyDesign, defaultMotion, effectiveMotion, loadDesign, parseMotion, saveDesign, type MotionEnv } from "./design";

function fakeRoot() {
  const props = new Map<string, string>();
  const attrs = new Map<string, string>();
  return {
    style: { setProperty: (k: string, v: string) => void props.set(k, v), fontSize: "" },
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    props,
    attrs,
  };
}

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

const PLAIN: MotionEnv = { reducedMotion: false, saveData: false };
const OS_REDUCED: MotionEnv = { reducedMotion: true, saveData: false };
const SAVE_DATA: MotionEnv = { reducedMotion: false, saveData: true };

describe("design prefs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("applies accent variables, text size and the motion level", () => {
    const root = fakeRoot();
    applyDesign({ accent: "emerald", textSize: "lg", motion: "off" }, root as unknown as HTMLElement, PLAIN);
    expect(root.props.get("--accent-500")).toBe(ACCENTS.emerald.palette[5]);
    expect(root.props.get("--accent-950")).toBe(ACCENTS.emerald.palette[10]);
    expect(root.style.fontSize).toBe("18px");
    expect(root.attrs.get("data-motion")).toBe("off");
  });

  it("round-trips and falls back on junk", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadDesign(PLAIN)).toEqual({ accent: "route", textSize: "md", motion: "full" });
    saveDesign({ accent: "rose", textSize: "sm", motion: "reduced" });
    expect(loadDesign(PLAIN)).toEqual({ accent: "rose", textSize: "sm", motion: "reduced" });
    localStorage.setItem("orbit.design", JSON.stringify({ accent: "neon", textSize: "xxl", motion: "yes" }));
    expect(loadDesign(PLAIN)).toEqual({ accent: "route", textSize: "md", motion: "full" });
    // The old default (nebula), saved before Route green replaced it, loads as the current default (design.ts).
    localStorage.setItem("orbit.design", JSON.stringify({ accent: "nebula", textSize: "md", motion: "full" }));
    expect(loadDesign(PLAIN).accent).toBe("route");
    localStorage.setItem("orbit.design", "{not json");
    expect(loadDesign(PLAIN)).toEqual({ accent: "route", textSize: "md", motion: "full" });
  });
});

describe("motion level", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the old on/off switch's choice: on is Full, off is Off, whatever the device asks", () => {
    for (const env of [PLAIN, OS_REDUCED, SAVE_DATA]) {
      expect(parseMotion(true, env)).toBe("full");
      expect(parseMotion(false, env)).toBe("off");
    }
    vi.stubGlobal("localStorage", fakeStorage());
    localStorage.setItem("orbit.design", JSON.stringify({ accent: "sky", textSize: "lg", motion: false }));
    expect(loadDesign(PLAIN)).toEqual({ accent: "sky", textSize: "lg", motion: "off" });
    localStorage.setItem("orbit.design", JSON.stringify({ accent: "sky", textSize: "lg", motion: true }));
    expect(loadDesign(SAVE_DATA)).toEqual({ accent: "sky", textSize: "lg", motion: "full" });
  });

  it("reads the three levels as stored", () => {
    expect(parseMotion("full", OS_REDUCED)).toBe("full");
    expect(parseMotion("reduced", PLAIN)).toBe("reduced");
    expect(parseMotion("off", PLAIN)).toBe("off");
  });

  it("starts at Gentle when the OS asks for less motion or data saver is on", () => {
    expect(defaultMotion(PLAIN)).toBe("full");
    expect(defaultMotion(OS_REDUCED)).toBe("reduced");
    expect(defaultMotion(SAVE_DATA)).toBe("reduced");
    expect(parseMotion(undefined, SAVE_DATA)).toBe("reduced");
    expect(parseMotion("bouncy", OS_REDUCED)).toBe("reduced");
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadDesign(SAVE_DATA).motion).toBe("reduced");
  });

  it("lets the OS cap Full at Gentle, never raise a lower choice", () => {
    expect(effectiveMotion("full", PLAIN)).toBe("full");
    expect(effectiveMotion("full", OS_REDUCED)).toBe("reduced");
    expect(effectiveMotion("reduced", OS_REDUCED)).toBe("reduced");
    expect(effectiveMotion("off", OS_REDUCED)).toBe("off");
    // Data saver only picks the starting level: a user who chose Full gets Full.
    expect(effectiveMotion("full", SAVE_DATA)).toBe("full");
    const root = fakeRoot();
    applyDesign({ accent: "nebula", textSize: "md", motion: "full" }, root as unknown as HTMLElement, OS_REDUCED);
    expect(root.attrs.get("data-motion")).toBe("reduced");
  });
});
