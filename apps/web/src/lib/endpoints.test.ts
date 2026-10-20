import { describe, expect, it } from "vitest";
import { endpointBases } from "./endpoints";
const configured = { api: "/api", direct: "https://api.orbitanswer.com", live: "https://api.orbitanswer.com" };
describe("preview endpoint isolation", () => {
  it("keeps production direct REST and live endpoints on the production site", () => {
    expect(endpointBases("https://orbitanswer.com", configured)).toEqual({ api: "https://orbitanswer.com/api", direct: configured.direct, live: configured.live });
  });
  it.each(["https://branch.orbit.workers.dev", "https://staging.orbitanswer.com", "http://localhost:5173"])("never contacts production from %s, even with a production build", (origin) => {
    expect(endpointBases(origin, configured)).toEqual({ api: `${origin}/api`, direct: null, live: `${origin}/api` });
    expect(endpointBases(origin, { ...configured, api: configured.direct }).api).toBe(`${origin}/api`);
  });
  it("normalizes DNS trailing dots before deciding isolation", () => {
    expect(endpointBases("https://branch.workers.dev", { api: "https://API.ORBITANSWER.COM.", direct: "https://API.ORBITANSWER.COM.", live: "https://API.ORBITANSWER.COM." })).toEqual({ api: "https://branch.workers.dev/api", direct: null, live: "https://branch.workers.dev/api" });
  });
  it("permits independently configured staging and local endpoints", () => {
    expect(endpointBases("https://staging.orbitanswer.com", { api: "/api", live: "https://api-staging.example.test" }).live).toBe("https://api-staging.example.test");
    expect(endpointBases("http://localhost:5173", { api: "http://localhost:8000" }).api).toBe("http://localhost:8000");
  });
});
