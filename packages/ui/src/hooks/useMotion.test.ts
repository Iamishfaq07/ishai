import { afterEach, describe, expect, it, vi } from "vitest";
import { currentMotion, viewTransitionOk, withViewTransition } from "./useMotion";

function page(motion: string | null, pathname = "/jobs", startViewTransition?: (update: () => void) => void) {
  vi.stubGlobal("document", { documentElement: { getAttribute: () => motion }, startViewTransition });
  vi.stubGlobal("location", { pathname });
}

describe("motion level now", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads html[data-motion], else the OS setting alone", () => {
    page("off");
    expect(currentMotion()).toBe("off");
    page("bogus");
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(currentMotion()).toBe("reduced");
    page(null);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(currentMotion()).toBe("full");
  });
});

describe("page transitions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("run when the browser has them and motion isn't Off, never on a live interview", () => {
    const start = vi.fn((update: () => void) => update());
    page("full", "/jobs", start);
    expect(viewTransitionOk("/jobs/matches")).toBe(true);
    expect(viewTransitionOk("/live/abc")).toBe(false);
    page("reduced", "/jobs", start);
    expect(viewTransitionOk()).toBe(true);
    page("off", "/jobs", start);
    expect(viewTransitionOk()).toBe(false);
    page("full", "/live/abc", start);
    expect(viewTransitionOk("/sessions")).toBe(false);
    page("full", "/jobs");
    expect(viewTransitionOk()).toBe(false);
  });

  it("wrap the update when allowed and just run it otherwise", () => {
    const start = vi.fn((update: () => void) => update());
    const update = vi.fn();
    page("full", "/", start);
    withViewTransition(update, "/mock");
    expect(start).toHaveBeenCalledTimes(1);
    page("off", "/", start);
    withViewTransition(update, "/mock");
    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
