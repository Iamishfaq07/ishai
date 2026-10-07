import { describe, expect, it } from "vitest";
import { PAGE_META, metaFor, withPageMeta } from "./meta.js";

describe("metaFor (the Worker's per-page link previews)", () => {
  it("knows the public pages people share, with or without a trailing slash", () => {
    expect(metaFor("/")?.path).toBe("/");
    expect(metaFor("/resume-ai")?.title).toMatch(/^Orbit Resume AI/);
    expect(metaFor("/jobs/")?.path).toBe("/jobs");
    expect(metaFor("/warmup")?.title).toMatch(/practice question/i);
  });

  it("leaves every other address to index.html", () => {
    for (const path of ["/jobs/matches", "/resume-ai/abc", "/login", "/api/v1/me", "/constructor", "/__proto__"]) {
      expect(metaFor(path)).toBeNull();
    }
  });

  it("keeps titles and descriptions short enough for a preview", () => {
    for (const { title, description } of Object.values(PAGE_META)) {
      expect(title.length).toBeLessThanOrEqual(80);
      expect(description.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("withPageMeta", () => {
  const url = new URL("https://orbit.example/resume-ai");
  it("returns anything that isn't an HTML page untouched", () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    expect(withPageMeta(json, url)).toBe(json);
    const missing = new Response("", { status: 404, headers: { "content-type": "text/html" } });
    expect(withPageMeta(missing, url)).toBe(missing);
  });

  it("returns the page untouched where there's no HTMLRewriter (outside Cloudflare)", () => {
    const html = new Response("<title>Orbit</title>", { headers: { "content-type": "text/html; charset=utf-8" } });
    expect(withPageMeta(html, url)).toBe(html);
  });
});
