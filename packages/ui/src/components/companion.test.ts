import { describe, expect, it } from "vitest";
import { encode } from "uqr";
import { companionLink } from "./CompanionShare";

describe("companion link", () => {
  it("keeps the code in the fragment, never the path or query", () => {
    expect(companionLink("https://orbit.example/", "abc_-123")).toBe("https://orbit.example/companion#abc_-123");
  });

  it("fits a full-length link in a phone-scannable QR code", () => {
    const link = companionLink("https://orbit-web.example.workers.dev", "x".repeat(43)); // token_urlsafe(32)
    const qr = encode(link, { ecc: "M", border: 2 });
    expect(qr.version).toBeLessThanOrEqual(6); // ≤ 41 modules + border: large modules at 176 px
  });
});
