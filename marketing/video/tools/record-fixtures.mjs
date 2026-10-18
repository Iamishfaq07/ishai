// Records the API answers the real web app gets on a LOCAL seeded stack, so the video compositions can replay them
// without any server (marketing/video/src/app/fixtureApi.ts). Never production: refuses orbitanswer.com.
//
//   node marketing/video/tools/record-fixtures.mjs --web http://localhost:5197 --api http://localhost:8034 [--shots <dir>]
//
// Signs in as the demo person (marketing/screens/seed.py), opens every route in ROUTES with motion off, and writes
// every JSON answer from the API to fixtures/recorded.json as { "GET /v1/...": { status, body } } (the query string
// is part of the key). --shots also saves a 1280x800 picture of each page, for review.
// The AI's own words on a mock stack say "[mock]": fixtures/patches.mjs replaces those with written demo content at
// replay time, so this file stays exactly what the server said.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const WEB = opt("web", "http://localhost:5197");
const API = opt("api", "http://localhost:8034");
if (/orbitanswer\.com/i.test(WEB + API)) throw new Error("local stacks only: never point this at production");
const SHOTS = opt("shots", null);
const PW = opt("playwright", join(REPO, "node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs"));
const { chromium } = await import(pathToFileURL(PW).href);
const STATE = JSON.parse(readFileSync(join(REPO, "marketing/screens/.seed-state.json"), "utf8"));
const OUT = join(HERE, "..", "fixtures", "recorded.json");
const only = opt("only", "").split(",").filter(Boolean);

const ROUTES = {
  home: "/",
  matches: "/jobs/matches",
  overview: "/jobs",
  tracker: "/jobs/tracker",
  mission: `/jobs/mission/${STATE.tracker["Kestrel Pay"]}`,
  missionOffer: `/jobs/mission/${STATE.tracker["Cobalt Commerce"]}`,
  resumeHome: "/resume-ai",
  resume: `/resume-ai/${STATE.resume_id}`,
  practice: "/mock",
  review: `/sessions/${STATE.mock_session_id}`,
  sessions: "/sessions",
  start: "/start",
  linkedin: "/linkedin",
  learn: "/learn",
  offers: "/offers",
  settings: "/settings",
  interview: "/interview",
  code: "/code",
  offer: `/offers/${STATE.offer_id}`,
  wrapup: `/sessions/${STATE.interview_session_id}`,
  interviewTab: `/jobs/mission/${STATE.tracker["Kestrel Pay"]}?tab=interview`,
  setupFromJob: `/start?application=${STATE.tracker["Kestrel Pay"]}`,
  draft: `/resume-ai/${STATE.draft_resume_id}`,
};

const recorded = existsSync(OUT) && only.length ? JSON.parse(readFileSync(OUT, "utf8")) : {};
recorded.__meta = { recordedAt: Date.now(), timezone: "UTC" };
const browser = await chromium.launch({ channel: "chrome", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: "light", timezoneId: "Asia/Kolkata", locale: "en-US" });
await ctx.addInitScript(() => {
  localStorage.setItem("orbit.cookies.v1", "1");
  localStorage.setItem("orbit.theme", "light");
  localStorage.setItem("orbit.design", JSON.stringify({ accent: "nebula", textSize: "md", motion: "off" }));
  // Never speak: headless Chrome's speechSynthesis plays through Windows past --mute-audio.
  try {
    Object.defineProperty(window, "speechSynthesis", { value: { speak() {}, cancel() {}, pause() {}, resume() {}, getVoices: () => [], speaking: false, pending: false, paused: false, addEventListener() {}, removeEventListener() {} } });
  } catch {}
});
const login = await ctx.request.post(`${API}/v1/auth/login`, { headers: { Origin: WEB }, data: { email: STATE.email, password: STATE.password } });
if (!login.ok()) throw new Error(`sign-in failed: ${login.status()}`);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("page error:", e.message.slice(0, 200)));
page.on("response", async (res) => {
  const url = res.url();
  if (!url.startsWith(API)) return;
  const req = res.request();
  const u = new URL(url);
  const key = `${req.method()} ${u.pathname}${u.search}`;
  try {
    const ct = res.headers()["content-type"] ?? "";
    const body = ct.includes("json") ? await res.json() : await res.text();
    recorded[key] = { status: res.status(), body, ...(ct.includes("json") ? {} : { type: ct }) };
  } catch {
    // a redirect or an aborted request: nothing to keep
  }
});
for (const [name, path] of Object.entries(ROUTES)) {
  if (only.length && !only.includes(name)) continue;
  await page.goto(WEB + path);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
  }
  console.log("visited", name, path);
}
writeFileSync(OUT, JSON.stringify(recorded, null, 1));
console.log(Object.keys(recorded).length, "answers ->", OUT);
await browser.close();
