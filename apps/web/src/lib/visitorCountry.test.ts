import { describe, expect, it, vi } from "vitest";
import { createVisitorCountry, pickCountry, visitorCountryWithin } from "./visitorCountry";

describe("the country a page uses", () => {
  it("is the saved account country, then the visitor's from the edge, then the browser's guess", () => {
    expect(pickCountry("GB", "US", "IN")).toBe("GB");
    expect(pickCountry(null, "US", "IN")).toBe("US");
    expect(pickCountry("", "US", "IN")).toBe("US");
    expect(pickCountry(null, null, "IN")).toBe("IN");
    expect(pickCountry(undefined, undefined, "DE")).toBe("DE"); // not asked yet: the guess
  });
});

describe("the visitor's country", () => {
  it("is asked once, shared, and tells whoever is listening", async () => {
    const fetchRegion = vi.fn(async () => ({ country: "us" }));
    const store = createVisitorCountry(fetchRegion);
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    expect(store.get()).toBeUndefined();
    const [a, b] = await Promise.all([store.load(), store.load()]);
    expect(a).toBe("US");
    expect(b).toBe("US");
    expect(store.get()).toBe("US");
    expect(fetchRegion).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    await store.load();
    expect(fetchRegion).toHaveBeenCalledTimes(1);
  });

  it("is null when the edge doesn't know, names something odd, or the request fails", async () => {
    for (const fetchRegion of [
      async () => ({ country: null }),
      async () => ({ country: "XX" }),
      async () => Promise.reject(new Error("offline")),
    ]) {
      const store = createVisitorCountry(fetchRegion);
      expect(await store.load()).toBeNull();
      expect(store.get()).toBeNull();
    }
  });

  it("doesn't hold up sign-up for long", async () => {
    vi.useFakeTimers();
    try {
      const slow = createVisitorCountry(() => new Promise(() => undefined));
      const answer = visitorCountryWithin(1500, slow);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await answer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
    const known = createVisitorCountry(async () => ({ country: "GB" }));
    await known.load();
    expect(await visitorCountryWithin(10, known)).toBe("GB");
  });
});
