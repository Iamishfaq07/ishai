import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("./api", () => ({ api: server }));

function browser(href: string, referrer: string) {
  const store = new Map<string, string>();
  const url = new URL(href);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0,
  });
  vi.stubGlobal("window", {
    location: url, innerWidth: 390, setInterval: () => 1, clearInterval: () => undefined,
  });
  vi.stubGlobal("document", { referrer, visibilityState: "visible", addEventListener: () => undefined, removeEventListener: () => undefined });
}

describe("activity for the admin's insights", () => {
  beforeEach(() => {
    vi.resetModules();
    server.call.mockReset();
    server.call.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the first visit's source and sends it once with the first batch", async () => {
    browser("https://orbitanswer.com/r/PRIYA10?utm_source=youtube&utm_campaign=launch", "https://www.youtube.com/watch?v=1");
    const activity = await import("./activity");
    activity.rememberSource();
    window.location.pathname = "/";
    activity.rememberSource(); // a later page doesn't replace it
    activity.trackAs("u1");
    await Promise.resolve();
    const first = JSON.parse(server.call.mock.calls[0]![1].body);
    expect(first.source).toMatchObject({ landing: "/r/PRIYA10", referrer: "https://www.youtube.com", utm_source: "youtube",
      utm_campaign: "launch", ref: "PRIYA10" });
    activity.trackPage("Job Search · Orbit");
    activity.trackError("Upload failed: the file is too large.");
    activity.trackError("Upload failed: the file is too large."); // the same one again: once a minute
    activity.trackAs(null);
    await Promise.resolve();
    const second = JSON.parse(server.call.mock.calls[1]![1].body);
    expect(second.source).toBeUndefined();
    expect(second.events.map((e: { kind: string; name: string; device: string }) => [e.kind, e.name, e.device])).toEqual([
      ["page", "Job Search", "phone"], ["error", "Upload failed", "phone"]]);
  });

  it("ignores its own site as a referrer and sends nothing signed out", async () => {
    browser("https://orbitanswer.com/pricing", "https://orbitanswer.com/");
    const activity = await import("./activity");
    activity.rememberSource();
    activity.trackPage("Pricing");
    expect(server.call).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("orbit.source.v1")!)).not.toHaveProperty("referrer");
  });
});
