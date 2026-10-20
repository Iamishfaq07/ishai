import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "./index.js";
import { isolatedApi } from "./environment.js";
const prod = { API_URL: "https://api.orbitanswer.com", DEPLOYMENT_ENV: "production" };
describe("preview isolation across proxy, public employer pages and scheduled requests", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["https://branch.workers.dev", "https://staging.orbitanswer.com"])("blocks every API verb and employer page before fetch on %s", async (origin) => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const path of ["/api/v1/auth/me", "/api/v1/auth/register", "/company/example/jobs/engineer"]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const response = await worker.fetch(new Request(`${origin}${path}`, { method }), prod);
        expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed without an API and refuses production in explicitly isolated environments", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const DEPLOYMENT_ENV of ["preview", "staging"]) {
      const env = { ...prod, DEPLOYMENT_ENV };
      expect(isolatedApi(env, "https://orbitanswer.com")).toBe(false);
      worker.scheduled({}, env, { waitUntil: vi.fn() });
      expect((await worker.fetch(new Request("https://orbitanswer.com/api"), env)).status).toBe(503);
    }
    expect(isolatedApi({ API_URL: "" }, "https://branch.workers.dev")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("normalizes DNS trailing dots and refuses a staging redirect into production", async () => {
    expect(isolatedApi({ API_URL: "https://API.ORBITANSWER.COM." }, "https://branch.workers.dev")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 307, headers: { location: "https://api.orbitanswer.com/v1/auth/me" } })));
    const result = await worker.fetch(new Request("https://branch.workers.dev/api/v1/auth/me"), { API_URL: "https://isolated-api.example.test" });
    expect(result.status).toBe(503);
  });
  it("permits production only on its canonical host and allows separate staging", () => {
    expect(isolatedApi(prod, "https://orbitanswer.com")).toBe(true);
    expect(isolatedApi(prod, "https://www.orbitanswer.com")).toBe(true);
    expect(isolatedApi({ API_URL: "https://api-staging.example.test", DEPLOYMENT_ENV: "staging" }, "https://branch.workers.dev")).toBe(true);
  });
});
