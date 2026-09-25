import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCENTS, applyDesign, loadDesign, saveDesign } from "./design";

function fakeRoot() {
  const props = new Map<string, string>();
  const classes = new Set<string>();
  return {
    style: { setProperty: (k: string, v: string) => void props.set(k, v), fontSize: "" },
    classList: { toggle: (c: string, on: boolean) => void (on ? classes.add(c) : classes.delete(c)) },
    props,
    classes,
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

describe("design prefs", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("applies accent variables, text size and the motion switch", () => {
    const root = fakeRoot();
    applyDesign({ accent: "emerald", textSize: "lg", motion: false }, root as unknown as HTMLElement);
    expect(root.props.get("--accent-500")).toBe(ACCENTS.emerald.palette[5]);
    expect(root.props.get("--accent-950")).toBe(ACCENTS.emerald.palette[10]);
    expect(root.style.fontSize).toBe("18px");
    expect(root.classes.has("reduce-motion")).toBe(true);
  });

  it("round-trips and falls back on junk", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(loadDesign()).toEqual({ accent: "nebula", textSize: "md", motion: true });
    saveDesign({ accent: "rose", textSize: "sm", motion: false });
    expect(loadDesign()).toEqual({ accent: "rose", textSize: "sm", motion: false });
    localStorage.setItem("orbit.design", JSON.stringify({ accent: "neon", textSize: "xxl", motion: "yes" }));
    expect(loadDesign()).toEqual({ accent: "nebula", textSize: "md", motion: true });
  });
});
