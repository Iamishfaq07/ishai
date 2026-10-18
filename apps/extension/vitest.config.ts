import { defineConfig } from "vitest/config";

export default defineConfig({
  // Auto-apply's pauses are instant in unit tests (a person's pace is 1).
  define: { __ORBIT_APPLY_PACE__: "0", __ORBIT_API_URL__: JSON.stringify("http://orbit.test/api") },
  test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 30_000 },
});
