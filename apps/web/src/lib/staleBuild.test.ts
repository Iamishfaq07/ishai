import { describe, expect, it } from "vitest";
import { isStaleBuildError } from "./staleBuild";

describe("stale build errors", () => {
  it("knows each browser's wording for a missing page file", () => {
    expect(isStaleBuildError(new TypeError("Failed to fetch dynamically imported module: https://orbitanswer.com/assets/Mock-Dz6TnAXj.js"))).toBe(true);
    expect(isStaleBuildError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleBuildError(new TypeError("error loading dynamically imported module: https://x/assets/a.js"))).toBe(true);
    expect(isStaleBuildError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
    expect(isStaleBuildError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStaleBuildError(null)).toBe(false);
  });
});
