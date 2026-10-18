import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the Microsoft Store badge", () => {
  it("is off until VITE_MS_STORE_LIVE says the listing is public, and renders nothing meanwhile", async () => {
    vi.stubEnv("VITE_MS_STORE_LIVE", "");
    const { MS_STORE_LIVE } = await import("./desktop");
    const { StoreBadge } = await import("../components/StoreBadge");
    expect(MS_STORE_LIVE).toBe(false);
    expect(StoreBadge({})).toBeNull();
  });

  it("links Orbit's listing in Microsoft's direct-install mode once live", async () => {
    vi.stubEnv("VITE_MS_STORE_LIVE", "true");
    const { MS_STORE_LIVE, MS_STORE_URL } = await import("./desktop");
    expect(MS_STORE_LIVE).toBe(true);
    expect(MS_STORE_URL).toBe("https://apps.microsoft.com/detail/9NJ1ZXGTCZKL?mode=direct");
  });
});
