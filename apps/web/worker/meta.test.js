import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PAGE_IMAGES, PAGE_META, imageFor, metaFor, withPageMeta } from "./meta.js";

describe("metaFor (the Worker's per-page link previews)", () => {
  it("knows the public pages people share, with or without a trailing slash", () => {
    expect(metaFor("/")?.path).toBe("/");
    expect(metaFor("/resume-ai")?.title).toMatch(/^Orbit Resume AI/);
    expect(metaFor("/jobs/")?.path).toBe("/jobs");
    expect(metaFor("/warmup")?.title).toMatch(/Interview Warmup alternative/i);
    expect(metaFor("/contact/")?.title).toMatch(/^Contact Orbit AI/);
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

describe("imageFor (each page's preview picture)", () => {
  it("gives a page its own picture, and anything else the front page's", () => {
    expect(imageFor("/resume-ai")).toBe("/og/resume-ai.jpg");
    expect(imageFor("/jobs")).toBe("/og/jobs.jpg");
    expect(imageFor("/somewhere-new")).toBe("/og-image.jpg");
    expect(imageFor("__proto__")).toBe("/og-image.jpg");
  });

  it("points only at pictures that exist in public/", () => {
    for (const file of [...Object.values(PAGE_IMAGES), "/og-image.jpg"]) {
      expect(existsSync(fileURLToPath(new URL(`../public${file}`, import.meta.url))), file).toBe(true);
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
