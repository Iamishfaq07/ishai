import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENDPOINT, changedSince, main, normalise, payloads, readKey, sitemapEntries } from "./indexnow.mjs";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const KEY = readdirSync(PUBLIC).find((f) => /^[0-9a-f]{32}\.txt$/.test(f)).slice(0, -4);

describe("IndexNow submission", () => {
  it("reads the key from its file in public/, which is named after it", () => {
    expect(readKey(PUBLIC, {})).toBe(KEY);
    expect(readKey(PUBLIC, { INDEXNOW_KEY: "abcdef0123456789" })).toBe("abcdef0123456789");
  });

  it("takes only addresses on the site, once each", () => {
    expect(normalise(["/warmup", "https://orbitanswer.com/warmup#x", "/jobs"])).toEqual(["https://orbitanswer.com/warmup", "https://orbitanswer.com/jobs"]);
    expect(() => normalise(["https://example.com/"])).toThrow(/is not on https:\/\/orbitanswer\.com/);
    expect(() => normalise(["http://orbitanswer.com/warmup"])).toThrow(/is not on/);
  });

  it("picks changed pages from the sitemap by lastmod", () => {
    const xml = `<urlset><url><loc>https://orbitanswer.com/a</loc><lastmod>2026-10-17</lastmod></url><url><loc>https://orbitanswer.com/b</loc><lastmod>2026-10-18T09:00:00+05:30</lastmod></url><url><loc>https://orbitanswer.com/c</loc></url></urlset>`;
    expect(changedSince(sitemapEntries(xml), "2026-10-18")).toEqual(["https://orbitanswer.com/b"]);
  });

  it("sends at most 10,000 addresses a request, with the key's location", () => {
    const urls = Array.from({ length: 10_001 }, (_, i) => `https://orbitanswer.com/p${i}`);
    const bodies = payloads(urls, KEY);
    expect(bodies.map((b) => b.urlList.length)).toEqual([10_000, 1]);
    expect(bodies[0]).toMatchObject({ host: "orbitanswer.com", key: KEY, keyLocation: `https://orbitanswer.com/${KEY}.txt` });
  });

  it("only prints without --send", async () => {
    const calls = [];
    const code = await main(["/warmup"], { fetchImpl: async (u) => (calls.push(u), new Response("")), log: () => {}, env: {} });
    expect(code).toBe(0);
    expect(calls).toEqual([]);
  });

  it("stops before submitting when the key file isn't live yet", async () => {
    const calls = [];
    const fetchImpl = async (u) => (calls.push(String(u)), new Response("not found", { status: 404 }));
    expect(await main(["/warmup", "--send"], { fetchImpl, log: () => {}, env: {} })).toBe(1);
    expect(calls).toEqual([`https://orbitanswer.com/${KEY}.txt`]);
  });

  it("submits once the key file answers with the key", async () => {
    const posts = [];
    const fetchImpl = async (u, init) => {
      if (String(u).endsWith(`${KEY}.txt`)) return new Response(KEY);
      posts.push({ url: String(u), body: JSON.parse(init.body) });
      return new Response("", { status: 202 });
    };
    expect(await main(["/warmup", "/jobs", "--send"], { fetchImpl, log: () => {}, env: {} })).toBe(0);
    expect(posts).toEqual([{ url: ENDPOINT, body: { host: "orbitanswer.com", key: KEY, keyLocation: `https://orbitanswer.com/${KEY}.txt`, urlList: ["https://orbitanswer.com/warmup", "https://orbitanswer.com/jobs"] } }]);
  });
});
