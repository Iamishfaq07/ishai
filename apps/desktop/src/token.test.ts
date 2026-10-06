import { describe, expect, it } from "vitest";
import { roughDuration, tokenExpiry } from "./token";

/** A JWT-shaped token (unsigned: only the payload matters here). */
function jwt(claims: object): string {
  const part = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${part({ alg: "HS256", typ: "JWT" })}.${part(claims)}.c2ln`;
}

describe("reading a sign-in token's expiry", () => {
  it("reads exp in milliseconds", () => {
    expect(tokenExpiry(jwt({ sub: "u1", exp: 1_760_000_000, auth: 1_759_395_200 }))).toBe(1_760_000_000_000);
  });

  it("copes with base64url characters and missing padding", () => {
    // "subject?>" encodes with "_" and "-" in base64url
    expect(tokenExpiry(jwt({ sub: "subject?>~~", exp: 42 }))).toBe(42_000);
  });

  it("is null for anything that isn't a JWT with an exp", () => {
    expect(tokenExpiry("opaque-token")).toBeNull();
    expect(tokenExpiry("a.%%%.c")).toBeNull();
    expect(tokenExpiry(jwt({ sub: "u1" }))).toBeNull();
  });
});

describe("saying how long until then", () => {
  it("rounds to what a person would say", () => {
    expect(roughDuration(30_000)).toBe("1 minute");
    expect(roughDuration(45 * 60_000)).toBe("45 minutes");
    expect(roughDuration(170 * 60_000)).toBe("about 3 hours");
    expect(roughDuration(3 * 24 * 3_600_000)).toBe("about 3 days");
  });
});
