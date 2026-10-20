import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";

// Disposable fixtures per run; never reuse a stale local schema or share another test run's account data.
const database = process.env.ORBIT_E2E_DB ??= `web-e2e-${Date.now()}.db`;
export default defineConfig({
  testDir: "./tools/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:5173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: [
    { command: "uv run uvicorn orbit_api.main:app --host 127.0.0.1 --port 8000", cwd: resolve("apps/api"),
      url: "http://127.0.0.1:8000/health", timeout: 120_000, reuseExistingServer: !process.env.CI,
      env: { ORBIT_ENV: "test", ORBIT_LLM_PROVIDER: "mock", ORBIT_STT_PROVIDER: "mock", ORBIT_BUSINESS_AI: "fake",
        ORBIT_DATABASE_URL: `sqlite+aiosqlite:///./${database}`, ORBIT_ADMIN_EMAIL: "qa-admin@example.com",
        // The camera coach is on, so the video room is checked with its button (video-room.spec.ts).
        ORBIT_VIDEO_MOCK: "true",
        ORBIT_WEB_URL: "http://127.0.0.1:5173", ORBIT_CORS_ORIGINS: "http://127.0.0.1:5173",
        DEEPSEEK_API_KEY: "", DEEPGRAM_API_KEY: "", ORBIT_SMTP_HOST: "", ORBIT_DEV_OUTBOX: "./e2e-outbox.txt" } },
    { command: "node node_modules/vite/bin/vite.js --host 127.0.0.1", cwd: resolve("apps/web"), url: "http://127.0.0.1:5173", timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: { VITE_API_URL: "http://127.0.0.1:8000", VITE_LIVE_URL: "http://127.0.0.1:8000" } },
  ],
});
