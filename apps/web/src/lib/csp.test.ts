import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../../vite.config";

describe("content security policy", () => {
  it("is one policy and allows the script hosts the app actually loads", () => {
    const csp = contentSecurityPolicy(["window.__orbit=1"], {
      VITE_API_URL: "/api",
      VITE_LIVE_URL: "https://orbit-api-sg.onrender.com",
    });
    expect(csp.split(";").filter((part) => part.includes("default-src"))).toHaveLength(1);
    expect(csp).toContain("https://checkout.razorpay.com");
    expect(csp).toContain("https://cdn.razorpay.com");
    expect(csp).toContain("https://api.razorpay.com");
    expect(csp).toContain("https://challenges.cloudflare.com");
    expect(csp).toContain("wss://orbit-api-sg.onrender.com");
    expect(csp).toContain("sha256-");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("does not add a second policy in public/_headers", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
    const headers = readFileSync(join(root, "public/_headers"), "utf8").toLowerCase();
    expect(headers).not.toContain("content-security-policy");
    expect(headers).toContain("max-age=31536000");
  });
});
