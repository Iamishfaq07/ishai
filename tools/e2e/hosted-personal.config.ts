import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: ".", testMatch: "hosted-personal.e2e.ts", timeout: 60_000, workers: 1,
  // Orbit opens light unless someone chooses otherwise; the tests choose "follow my device", so a test that emulates a
  // dark device (colorScheme: "dark") audits dark mode as it always has.
  use: { baseURL: "http://127.0.0.1:5185", storageState: { cookies: [], origins: [{ origin: "http://127.0.0.1:5185", localStorage: [{ name: "orbit.theme", value: "system" }] }] }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  reporter: "list",
  webServer: [
    { command: "uv run uvicorn orbit_api.main:app --host 127.0.0.1 --port 8105", cwd: resolve("apps/api"),
      url: "http://127.0.0.1:8105/health", timeout: 120_000, reuseExistingServer: false,
      env: { ORBIT_ENV: "test", ORBIT_DATABASE_URL: `sqlite+aiosqlite:///./hosted-e2e-${Date.now()}.db`,
        ORBIT_LLM_PROVIDER: "mock", ORBIT_STT_PROVIDER: "mock", ORBIT_ADMIN_EMAIL: "hosted-qa-admin@example.com",
        ORBIT_WEB_URL: "http://127.0.0.1:5185", ORBIT_CORS_ORIGINS: "http://127.0.0.1:5185",
        ORBIT_HOSTED_APPLY: "true", ORBIT_APPLY_WORKER_SECRET: "hosted-browser-tests-fixture-1234567890",
        ORBIT_DEV_OUTBOX: "./hosted-e2e-outbox.txt", ORBIT_SMTP_HOST: "", DEEPSEEK_API_KEY: "", DEEPGRAM_API_KEY: "" } },
    { command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5185", cwd: resolve("apps/web"),
      url: "http://127.0.0.1:5185", timeout: 60_000, reuseExistingServer: false,
      env: { VITE_API_URL: "http://127.0.0.1:8105", VITE_LIVE_URL: "http://127.0.0.1:8105" } },
  ],
});
