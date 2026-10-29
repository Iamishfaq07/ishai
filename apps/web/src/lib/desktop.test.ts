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
  }, 20_000); // the first import of the badge's module graph takes ~4.5 s, over the 5 s default on a busy machine

  it("links Orbit's listing in Microsoft's direct-install mode once live", async () => {
    vi.stubEnv("VITE_MS_STORE_LIVE", "true");
    const { MS_STORE_LIVE, MS_STORE_URL } = await import("./desktop");
    expect(MS_STORE_LIVE).toBe(true);
    expect(MS_STORE_URL).toBe("https://apps.microsoft.com/detail/9NJ1ZXGTCZKL?mode=direct");
  });

  it("sends Windows downloads to the listing (no Beta label) once live, else the direct installer", async () => {
    vi.stubEnv("VITE_MS_STORE_LIVE", "true");
    let m = await import("./desktop");
    expect(m.WINDOWS_APP_URL).toBe(m.MS_STORE_URL);
    expect(m.WINDOWS_APP_BETA).toBe(false);
    vi.resetModules();
    vi.stubEnv("VITE_MS_STORE_LIVE", "");
    m = await import("./desktop");
    expect(m.WINDOWS_APP_URL).toBe(m.DESKTOP_DOWNLOAD_URL);
    expect(m.WINDOWS_APP_BETA).toBe(m.DESKTOP_BETA);
  });
});
