import { defineConfig } from "vitest/config";
export default defineConfig({
  define: { __ORBIT_APPLY_PACE__: "0" },
  test: { environment: "node", include: ["src/**/*.test.ts"], testTimeout: 30_000 },
});
