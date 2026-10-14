import { describe, expect, it, vi } from "vitest";
import { getShownMore, jobProfileWasSuggested, markJobProfileSuggested, setShownMore } from "./jobsSession";
import { clearAsyncCache, shareInflight } from "./useAsync";

describe("shareInflight", () => {
  it("runs one request while two callers ask for the same key", async () => {
    clearAsyncCache();
    let calls = 0;
    const run = async () => {
      calls += 1;
      return calls;
    };
    const [a, b] = await Promise.all([shareInflight("resumes", run), shareInflight("resumes", run)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(calls).toBe(1);
  });

  it("starts a new request after the account changes, and again once the first has finished", async () => {
    clearAsyncCache();
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = async () => {
      calls += 1;
      const mine = calls;
      await gate;
      return mine;
    };
    const first = shareInflight("resumes", run);
    clearAsyncCache();
    const second = shareInflight("resumes", run);
    release();
    expect(await first).toBe(1);
    expect(await second).toBe(2);
    expect(await shareInflight("resumes", async () => 3)).toBe(3);
  });

  it("forgets the last person's extra job pages and the profile suggestion when the account changes", () => {
    setShownMore({ key: "k", items: [], page: 2, hasMore: false });
    markJobProfileSuggested();
    clearAsyncCache();
    expect(getShownMore()).toBeNull();
    expect(jobProfileWasSuggested()).toBe(false);
  });

  it("drops browser data that used to be shared by every account", () => {
    const store = new Map<string, string>([
      ["orbit.support.v1", "{\"id\":\"t\"}"],
      ["orbit.practiceGoal", "7"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    clearAsyncCache();
    expect(store.has("orbit.support.v1")).toBe(false);
    expect(store.has("orbit.practiceGoal")).toBe(false);
    vi.unstubAllGlobals();
  });
});
