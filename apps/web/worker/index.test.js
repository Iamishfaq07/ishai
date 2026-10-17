import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index.js";

// The /api proxy: what reaches the API, whatever a visitor sends (docs/SECURITY_REVIEW.md, red team RT-W).
describe("the /api proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  const env = { API_URL: "https://api.orbit.example", PROXY_SECRET: "s".repeat(40) };

  async function proxied(headers) {
    const seen = [];
    vi.stubGlobal("fetch", async (req, init) => {
      seen.push({ req, init });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    await worker.fetch(new Request("https://orbit.example/api/v1/auth/me", { headers }), env);
    expect(seen).toHaveLength(1);
    return seen[0];
  }

  it("goes only to the API's host, without following its redirects", async () => {
    const { req, init } = await proxied({ "cf-connecting-ip": "203.0.113.7" });
    expect(new URL(req.url).origin).toBe("https://api.orbit.example");
    expect(new URL(req.url).pathname).toBe("/v1/auth/me");
    expect(init?.redirect).toBe("manual");
  });

  it("states the client IP itself and drops every copy a visitor sends", async () => {
    const { req } = await proxied({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "10.0.0.1",
      "x-orbit-proxy-secret": "guess",
      "x-orbit-client-ip": "10.0.0.2",
      "x-orbit-client-country": "IN",
      forwarded: "for=10.0.0.3;proto=http;host=evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "http",
      "x-real-ip": "10.0.0.4",
      "true-client-ip": "10.0.0.5",
    });
    expect(req.headers.get("x-forwarded-for")).toBe("203.0.113.7");
    expect(req.headers.get("x-orbit-client-ip")).toBe("203.0.113.7");
    expect(req.headers.get("x-orbit-proxy-secret")).toBe(env.PROXY_SECRET);
    expect(req.headers.get("x-orbit-client-country")).toBeNull(); // no cf country in the test: none stated
    for (const name of ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "true-client-ip"]) {
      expect(req.headers.get(name), name).toBeNull();
    }
  });

  it("sends no secret and no client IP without Cloudflare's own address", async () => {
    const { req } = await proxied({ "x-forwarded-for": "10.0.0.1", "x-orbit-proxy-secret": "guess" });
    expect(req.headers.get("x-forwarded-for")).toBeNull();
    expect(req.headers.get("x-orbit-proxy-secret")).toBeNull();
    expect(req.headers.get("x-orbit-client-ip")).toBeNull();
  });
});
