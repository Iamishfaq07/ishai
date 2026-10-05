import { defineConfig } from "vitest/config";

// Unit tests for the plain logic (audio source picking, rejoin settings, shortcut migration…), not the UI.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
