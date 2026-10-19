import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

const database = process.env.ORBIT_ENTERPRISE_E2E_DB ??= `enterprise-e2e-${Date.now()}.db`;
export default defineConfig({
  testDir: ".", testMatch: ["business-automation.e2e.ts", "business-coordination.e2e.ts", "workflow-ai.e2e.ts", "command-centers.e2e.ts"], timeout: 90_000, workers: 1, reporter: "list",
  use: { baseURL: "http://127.0.0.1:5186", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: [
    { command: "uv run uvicorn orbit_api.main:app --host 127.0.0.1 --port 8106", cwd: resolve("apps/api"),
      url: "http://127.0.0.1:8106/health", timeout: 120_000, reuseExistingServer: false,
      env: { ORBIT_ENV: "test", ORBIT_DATABASE_URL: `sqlite+aiosqlite:///./${database}`,
        ORBIT_LLM_PROVIDER: "mock", ORBIT_STT_PROVIDER: "mock", ORBIT_BUSINESS_AI: "fake",
        ORBIT_WEB_URL: "http://127.0.0.1:5186", ORBIT_CORS_ORIGINS: "http://127.0.0.1:5186",
        ORBIT_DEV_OUTBOX: "./enterprise-e2e-outbox.txt", ORBIT_SMTP_HOST: "", DEEPSEEK_API_KEY: "", DEEPGRAM_API_KEY: "" } },
    { command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5186", cwd: resolve("apps/web"),
      url: "http://127.0.0.1:5186", timeout: 60_000, reuseExistingServer: false,
      env: { VITE_API_URL: "http://127.0.0.1:8106", VITE_LIVE_URL: "http://127.0.0.1:8106" } },
  ],
});
