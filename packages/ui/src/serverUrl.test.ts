import { describe, expect, it } from "vitest";
import { checkServerUrl, trimTrailingSlashes } from "./serverUrl";

const ok = (v: string, allowInsecure = false) => checkServerUrl(v, { allowInsecure });

describe("checkServerUrl", () => {
  it("accepts https anywhere and plain http only on this machine", () => {
    expect(ok("https://orbit-api.example.com/")).toEqual({ ok: true, url: "https://orbit-api.example.com" });
    expect(ok("http://localhost:8010")).toEqual({ ok: true, url: "http://localhost:8010" });
    expect(ok("http://127.0.0.1:8000").ok).toBe(true);
    expect(ok("http://[::1]:8000").ok).toBe(true);
  });

  it("rejects remote http, other schemes, credentials and junk", () => {
    const remote = ok("http://orbit-api.example.com");
    expect(remote.ok).toBe(false);
    if (!remote.ok) expect(remote.reason).toMatch(/https/);
    expect(ok("http://localhost.evil.com").ok).toBe(false); // not loopback, just a lookalike
    expect(ok("http://192.168.1.20:8000").ok).toBe(false);
    expect(ok("ftp://x.example.com").ok).toBe(false);
    expect(ok("https://user:pw@x.example.com").ok).toBe(false);
    expect(ok("not a url").ok).toBe(false);
    expect(ok("   ").ok).toBe(false);
  });

  it("development builds may use remote http", () => {
    expect(ok("http://192.168.1.20:8000", true).ok).toBe(true);
  });
});

describe("trimTrailingSlashes", () => {
  it("drops only the trailing slashes, and stays fast on a long run of them", () => {
    expect(trimTrailingSlashes("https://a.example/api///")).toBe("https://a.example/api");
    expect(trimTrailingSlashes("https://a.example")).toBe("https://a.example");
    expect(trimTrailingSlashes("///")).toBe("");
    expect(trimTrailingSlashes(`${"/".repeat(100_000)}a`)).toHaveLength(100_001);
  });
});
