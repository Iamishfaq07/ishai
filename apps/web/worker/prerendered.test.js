import { describe, expect, it } from "vitest";
import { PAGE_META } from "./meta.js";
import { hasSession, pageAsset, pageRequest } from "./prerendered.js";

describe("pageAsset (the built HTML the Worker serves)", () => {
  const visit = (cookie) => new Request("https://orbit.example/", cookie ? { headers: { cookie } } : undefined);

  it("serves each public page's built copy to anyone signed out, crawlers included", () => {
    expect(pageAsset("/", visit())).toBe("/_prerender/home");
    expect(pageAsset("/resume-ai", visit("theme=dark"))).toBe("/_prerender/resume-ai");
    for (const path of Object.keys(PAGE_META)) expect(pageAsset(path, visit())).toMatch(/^\/_prerender\/[a-z-]+$/);
  });

  it("gives a signed-in visitor the app at their own home, and the built copy of the rest", () => {
    const signedIn = visit("theme=dark; orbit_session=abc.def");
    for (const path of ["/", "/resume-ai", "/jobs"]) expect(pageAsset(path, signedIn)).toBeNull();
    expect(pageAsset("/warmup", signedIn)).toBe("/_prerender/warmup");
  });

  it("only counts Orbit's own session cookie", () => {
    expect(hasSession(visit("orbit_session=x"))).toBe(true);
    expect(hasSession(visit("not_orbit_session=x"))).toBe(false);
    expect(hasSession(visit("orbit_session="))).toBe(false);
    expect(hasSession(visit())).toBe(false);
  });
});

describe("pageRequest", () => {
  it("asks the assets for the built copy at the page's own origin, with the visitor's headers", () => {
    const url = new URL("https://orbit.example/warmup?track=company%3Atcs");
    const request = new Request(url, { headers: { "if-none-match": "x" } });
    const asked = pageRequest("/warmup", request, url);
    expect(asked.url).toBe("https://orbit.example/_prerender/warmup");
    expect(asked.headers.get("if-none-match")).toBe("x");
    const signedIn = new Request("https://orbit.example/", { headers: { cookie: "orbit_session=abc" } });
    expect(pageRequest("/", signedIn, new URL(signedIn.url))).toBe(signedIn);
  });
});
