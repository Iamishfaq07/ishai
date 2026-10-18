import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { policyFile } from "./policyPages";

const publicDir = fileURLToPath(new URL("./public", import.meta.url));

describe("policyFile (the dev server's answer to /privacy)", () => {
  it("serves each policy at its address without .html, as the site does", () => {
    expect(policyFile("/privacy", publicDir)).toBe("/privacy.html");
    expect(policyFile("/terms/", publicDir)).toBe("/terms.html");
    expect(policyFile("/refund?x=1", publicDir)).toBe("/refund.html?x=1");
    expect(policyFile("/cookies", publicDir)).toBe("/cookies.html");
  });

  it("leaves every other address to the app", () => {
    for (const url of ["/", "/privacy.html", "/privacy/x", "/jobs", "/contact", "/assets/x.js"]) expect(policyFile(url, publicDir)).toBeNull();
  });
});
