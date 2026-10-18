// Records what the API answers while the real web app is used on a LOCAL seeded stack (marketing/screens/seed.py,
// tools/seed_video.py, the API run by tools/demo_api.py), one flow at a time, so a film can replay the same steps
// with no server: fixtures/flows/<flow>.json. Never production: refuses orbitanswer.com.
//
//   node tools/record-flows.mjs <flow> [--web http://localhost:5197] [--api http://localhost:8034] [--shots <dir>]
//
// The file maps "METHOD /path?query" to the answers in the order they came. A GET is kept per "epoch" (how many
// changes - POST, PUT, PATCH, DELETE - came before it), so the replay (src/app/fixtureApi.ts) answers a GET with what
// the server said at the same point of the flow, however many times the page asks.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const args = process.argv.slice(2);
const flowName = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const WEB = opt("web", "http://localhost:5197");
const API = opt("api", "http://localhost:8034");
if (/orbitanswer\.com/i.test(WEB + API)) throw new Error("local stacks only: never point this at production");
const SHOTS = opt("shots", null);
const PW = join(REPO, "node_modules/.pnpm/playwright-core@1.64.1/node_modules/playwright-core/index.mjs");
const { chromium } = await import(pathToFileURL(PW).href);
const STATE = JSON.parse(readFileSync(join(REPO, "marketing/screens/.seed-state.json"), "utf8"));

const FLOWS = {
  /** LinkedIn AI: the profile's score, then a fix for the headline, the About and the current role, each applied. */
  async linkedin(page, h) {
    await h.go("/linkedin");
    await h.shot("1-start", true);
    await h.click(page.getByRole("radio", { name: "Both" }).or(page.getByRole("button", { name: "Both", exact: true })).first());
    await h.wait(600);
    await page.locator("select").filter({ hasText: "Aditi Rao, analyst" }).first().selectOption({ label: "Aditi Rao, analyst" }).catch(() => undefined);
    await h.wait(600);
    const rows = ["Rewrite the headline", "Rewrite the About", "Rewrite Senior Data Analyst at Juniper Logistics", "Reorder and add skills"];
    for (const [i, label] of rows.entries()) {
      await h.click(page.locator("li", { hasText: label }).first().getByRole("button", { name: /fix with ai|write|fix it/i }).first());
      await h.wait(2500);
      await h.shot(`${i + 2}a-written`, true);
      await h.click(page.getByRole("button", { name: /apply to my orbit copy/i }).first());
      await h.wait(1500);
      await h.shot(`${i + 2}b-applied`, true);
    }
  },
  /** Resume AI: the draft's score, then Fix with AI on what the AI can fix. */
  async resume(page, h) {
    await h.go(`/resume-ai/${STATE.draft_resume_id}`);
    await h.shot("1-editor");
    await h.click(page.getByRole("tab", { name: "ATS score" }));
    await h.wait(800);
    await h.shot("2-score", true);
    await h.click(page.getByRole("button", { name: /fix everything with ai/i }).first());
    await h.wait(3000);
    await h.shot("3-fixed", true);
    for (let i = 0; i < 2; i++) {
      const add = page.getByRole("button", { name: /^add all$/i }).first();
      if (!(await add.count())) break;
      await h.click(add);
      await h.wait(1500);
    }
    await h.shot("4-skills", true);
  },
  /** Offer AI: the offer against the market, then the negotiation plan. */
  async offer(page, h) {
    await h.go(`/offers/${STATE.offer_id}`);
    await h.shot("1-offer", true);
    await h.click(page.getByRole("button", { name: /make my plan/i }).first());
    await h.wait(2500);
    await h.shot("2-plan", true);
  },
  /** Interview day: the job's interview tab, the copilot set up with the job, a live session, the wrap-up. */
  async dayloop(page, h) {
    const entry = STATE.tracker["Kestrel Pay"];
    await h.go("/");
    await h.shot("1-home", true);
    await h.go(`/jobs/mission/${entry}?tab=interview`);
    await h.shot("2-interview-tab", true);
    await h.go(`/start?application=${entry}`);
    await h.shot("3-setup", true);
    await h.go(`/sessions/${STATE.interview_session_id}`);
    await h.shot("4-wrapup", true);
    const draft = page.getByRole("button", { name: /draft|thank-you|write/i }).first();
    if (await draft.count()) {
      await h.click(draft);
      await h.wait(2500);
      await h.shot("5-thanks", true);
    }
  },
  /** The copilot's live page and Practice's live room, as the server greets them (its WebSocket frames). */
  async live(page, h) {
    for (const [kind, body] of [
      ["interview", { title: "Kestrel Pay: hiring manager round", type: "interview", role: "Product Analyst", company: "Kestrel Pay", document_ids: [STATE.document_id], application_id: STATE.tracker["Kestrel Pay"] }],
      ["mock", { title: "Product analyst: hiring manager round", type: "mock", role: "Product Analyst", company: "Kestrel Pay", document_ids: [STATE.document_id],
        mock: { interview_type: "mixed", difficulty: "medium", duration_minutes: 20, persona: "hiring_manager" } }],
    ]) {
      const created = await page.context().request.post(`${API}/v1/sessions`, { headers: { Origin: WEB, "X-CSRF-Token": h.csrf }, data: body });
      if (!created.ok()) throw new Error(`session: ${created.status()} ${await created.text()}`);
      const sid = (await created.json()).id;
      out.__sessions = { ...(out.__sessions ?? {}), [kind]: sid };
      h.wsKind = kind;
      await page.goto(`${WEB}/`);
      await page.evaluate((id) => history.replaceState({ usr: { systemAudio: true }, key: "demo", idx: 0 }, "", `/live/${id}`), sid);
      await page.reload();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await h.wait(2500);
      const share = page.getByRole("button", { name: "Share tab audio" });
      if (await share.count()) await share.first().click();
      await h.wait(kind === "mock" ? 9000 : 4000);
      await h.shot(`${kind}`, false);
      await page.context().request.post(`${API}/v1/sessions/${sid}/end`, { headers: { Origin: WEB, "X-CSRF-Token": h.csrf } }).catch(() => undefined);
      await h.wait(800);
    }
  },
  /** Jobs AI: a match saved from the list (it goes to the tracker). */
  async jobs(page, h) {
    await h.go("/jobs/matches");
    const save = page.getByRole("button", { name: /^save$/i }).first();
    await h.shot("1-matches", true);
    if (await save.count()) {
      await h.click(save);
      await h.wait(1200);
    }
    await h.shot("2-saved", true);
    await h.go("/jobs/tracker");
    await h.shot("3-tracker", true);
  },
  /** The AI video interview (Saba's room): what the server sends as the room opens and the first lines are said. */
  async video(page, h) {
    const body = { title: "Video interview: Product Analyst", type: "mock", language: "en", length: "standard", style: "natural", auto_answer: false,
      role: "Product Analyst", document_ids: [STATE.document_id],
      mock: { video: true, company: "Kestrel Pay", interview_type: "mixed", difficulty: "medium", duration_minutes: 10, adaptive_depth: true } };
    const created = await page.context().request.post(`${API}/v1/sessions`, { headers: { Origin: WEB, "X-CSRF-Token": h.csrf }, data: body });
    if (!created.ok()) throw new Error(`session: ${created.status()} ${await created.text()}`);
    const sid = (await created.json()).id;
    out.__sessions = { video: sid };
    h.wsKind = "video";
    await page.goto(`${WEB}/`);
    await page.evaluate((id) => history.replaceState({ usr: { systemAudio: false }, key: "demo", idx: 0 }, "", `/live/${id}`), sid);
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await h.wait(4000);
    await h.shot("room", false);
    await h.wait(8000);
    await h.shot("room-2", false);
    await page.context().request.post(`${API}/v1/sessions/${sid}/end`, { headers: { Origin: WEB, "X-CSRF-Token": h.csrf } }).catch(() => undefined);
    await h.wait(1500);
    await h.shot("room-end", false);
  },
  /** The review of an ended video interview with Saba (tools/seed_video.py video). */
  async sabaReview(page, h) {
    await h.go(`/sessions/${STATE.video_session_id}`);
    await h.shot("review", true);
  },
  /** Screens with nothing to do but be seen. */
  async screens(page, h) {
    for (const p of ["/", "/jobs", "/jobs/matches", "/jobs/tracker", `/jobs/mission/${STATE.tracker["Kestrel Pay"]}`, "/mock",
      `/sessions/${STATE.mock_session_id}`, "/learn", "/code", "/start", "/offers", "/resume-ai", `/resume-ai/${STATE.resume_id}`, "/sessions"]) {
      await h.go(p);
      await h.shot(p.replace(/[^a-z0-9]+/gi, "_").slice(0, 40), true);
    }
  },
  async explore(page, h) {
    for (const p of (opt("paths", "/") || "/").split(",")) {
      await h.go(p);
      await h.shot(p.replace(/[^a-z0-9]+/gi, "_"), true);
    }
  },
};

const flow = FLOWS[flowName];
if (!flow) throw new Error(`no flow ${flowName}; one of ${Object.keys(FLOWS).join(", ")}`);
const browser = await chromium.launch({ channel: "chrome", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, colorScheme: "light", timezoneId: "Asia/Kolkata", locale: "en-US" });
await ctx.addInitScript(() => {
  localStorage.setItem("orbit.cookies.v1", "1");
  localStorage.setItem("orbit.theme", "light");
  localStorage.setItem("orbit.design", JSON.stringify({ accent: "nebula", textSize: "md", motion: "off" }));
  try {
    Object.defineProperty(window, "speechSynthesis", { value: { speak() {}, cancel() {}, pause() {}, resume() {}, getVoices: () => [], speaking: false, pending: false, paused: false, addEventListener() {}, removeEventListener() {} } });
  } catch {}
});
const login = await ctx.request.post(`${API}/v1/auth/login`, { headers: { Origin: WEB }, data: { email: STATE.email, password: STATE.password } });
if (!login.ok()) throw new Error(`sign-in failed: ${login.status()}`);
const csrf = (await login.json()).user?.csrf_token;
const page = await ctx.newPage();
const wsFrames = [];
await page.routeWebSocket(/\/v1\/sessions\/[^/]+\/live/, (route) => {
  const server = route.connectToServer();
  route.onMessage((m) => server.send(m));
  server.onMessage((m) => {
    try {
      wsFrames.push({ kind: h.wsKind ?? "live", at: Date.now(), frame: JSON.parse(m) });
    } catch {}
    route.send(m);
  });
});
page.on("pageerror", (e) => console.log("page error:", e.message.slice(0, 200)));

const out = { __meta: { flow: flowName, recordedAt: Date.now() } };
let epoch = 0;
page.on("response", async (res) => {
  const url = res.url();
  if (!url.startsWith(API)) return;
  const req = res.request();
  const u = new URL(url);
  const method = req.method();
  if (method === "OPTIONS") return;
  const key = `${method} ${u.pathname}${u.search}`;
  const thisEpoch = method === "GET" ? epoch : epoch;
  if (method !== "GET") epoch += 1;
  let body = null;
  try {
    const ct = res.headers()["content-type"] ?? "";
    body = ct.includes("json") ? await res.json() : await res.text();
  } catch {
    return;
  }
  (out[key] ??= []).push({ status: res.status(), body, epoch: thisEpoch, ...(method !== "GET" ? { sent: safeJson(req.postData()) } : {}) });
});
function safeJson(s) {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return s ? String(s).slice(0, 2000) : null;
  }
}

let n = 0;
const h = {
  csrf,
  wsKind: null,
  async go(path) {
    await page.goto(WEB + path);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
  },
  async click(locator) {
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    await locator.click();
    await page.waitForLoadState("networkidle").catch(() => undefined);
  },
  wait: (ms) => page.waitForTimeout(ms),
  async shot(name, full = false) {
    if (!SHOTS) return;
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${flowName}-${String(++n).padStart(2, "0")}-${name}.png`), fullPage: full });
  },
};
try {
  await flow(page, h);
} finally {
  await page.waitForTimeout(800);
  const file = join(HERE, "..", "fixtures", "flows", `${flowName}.json`);
  mkdirSync(dirname(file), { recursive: true });
  if (wsFrames.length) out.__ws = wsFrames;
  if (flowName !== "explore") writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(Object.keys(out).length - 1, "requests ->", file);
  await browser.close();
}
