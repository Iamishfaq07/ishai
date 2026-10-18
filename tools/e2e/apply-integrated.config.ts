import { defineConfig } from "@playwright/test";

// The integrated Orbit Apply run (apply-integrated.e2e.ts): it starts its own API, web app and fake ATS, so it has
// its own config (no shared web servers) and is never picked up by the main suite's *.spec.ts.
//   pnpm exec playwright test -c tools/e2e/apply-integrated.config.ts
export default defineConfig({
  testDir: ".",
  testMatch: "apply-integrated.e2e.ts",
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
