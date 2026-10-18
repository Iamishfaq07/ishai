import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

// Orbit Apply, both halves together, headless and on a throwaway profile only (never anyone's own browser or screen):
// the real API (apps/api/scripts/e2e_apply_integrated.py: SQLite in the temp folder, the mock AI, fixture jobs and the
// server-side copies of the recorded forms) and the real web app (Vite), and the built extension in Chromium,
// connected through Orbit's own Connect page. The ATS hostnames resolve to a local HTTPS fake ATS serving the recorded
// Greenhouse, Lever and Ashby pages; every other hostname fails to resolve, so no employer site can be reached.
//
//   pnpm exec playwright test -c tools/e2e/apply-integrated.config.ts      (screenshots: %TEMP%\orbit-apply-integrated)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURES = join(ROOT, "tools/e2e/ats-fixtures");
const FAKE_ATS_JS = readFileSync(join(FIXTURES, "fake-ats.js"), "utf8");
const API_PORT = Number(process.env.APPLY_E2E_API_PORT ?? 8147);
const WEB_PORT = Number(process.env.APPLY_E2E_WEB_PORT ?? 5247);
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const SHOTS = join(tmpdir(), "orbit-apply-integrated");
const ATS_HOSTS = ["job-boards.greenhouse.io", "boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"];

const URLS = {
  gitlab: "https://job-boards.greenhouse.io/gitlab/jobs/8860302002",
  gitlabCaptcha: "https://job-boards.greenhouse.io/gitlab/jobs/1000000001",
  discord: "https://job-boards.greenhouse.io/discord/jobs/8806482002",
  palantir: "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd/apply",
  notion: "https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a/application",
  notion2: "https://jobs.ashbyhq.com/notion/2ac309c8-da20-4ff2-84c7-8b863ece2b0b/application",
};
const PAGES: Record<string, { fixture: string; ats: string; variant?: string }> = {
  [URLS.gitlab]: { fixture: "greenhouse-gitlab", ats: "greenhouse" },
  [URLS.gitlabCaptcha]: { fixture: "greenhouse-gitlab", ats: "greenhouse", variant: "captcha" },
  [URLS.discord]: { fixture: "greenhouse-discord", ats: "greenhouse" },
  [URLS.palantir]: { fixture: "lever-palantir", ats: "lever" },
  [URLS.notion]: { fixture: "ashby-notion", ats: "ashby" },
  [URLS.notion2]: { fixture: "ashby-notion", ats: "ashby" },
};

// ---- the fake ATS -------------------------------------------------------------------------------------------------
const submissions: { ats: string; url: string; data: Record<string, unknown> }[] = [];
const atsRequests: string[] = [];
const submitted = (url: string) => submissions.filter((s) => s.url.startsWith(url)).length;

function send(res: ServerResponse, status: number, type: string, body: string) {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

async function fakeAts(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `https://${req.headers.host}`);
  atsRequests.push(`${req.method} ${url.href}`);
  if (url.pathname === "/__fake/submit" && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    submissions.push(JSON.parse(raw || "{}"));
    return send(res, 200, "application/json", "{}");
  }
  if (url.pathname.startsWith("/fake-captcha/")) return send(res, 200, "text/html", "<!doctype html><p>Select all images with traffic lights</p>");
  if (url.pathname.endsWith("/confirmation")) {
    return send(res, 200, "text/html", "<!doctype html><html><head><title>Thank you</title></head><body><main><h1>Thank you for applying.</h1><p>Your application has been received. We will review it right away.</p></main></body></html>");
  }
  if (url.pathname.endsWith("/thanks")) {
    return send(res, 200, "text/html", '<!doctype html><html><body><div class="template-content"><h3>Application submitted!</h3><p>Thanks for applying.</p></div></body></html>');
  }
  const page = PAGES[`${url.origin}${url.pathname}`];
  if (!page || req.method !== "GET") return send(res, 404, "text/plain", "");
  const html = readFileSync(join(FIXTURES, `${page.fixture}.html`), "utf8").replace(
    "</body>",
    () => `<script>window.__FAKE_ATS=${JSON.stringify({ ats: page.ats, variant: page.variant ?? "ok", options: {} })}</script><script>${FAKE_ATS_JS}</script></body>`,
  );
  return send(res, 200, "text/html", html);
}

// ---- processes --------------------------------------------------------------------------------------------------
const procs: ChildProcess[] = [];
let atsServer: HttpsServer;
let context: BrowserContext;
let popup: Page;
let extensionId = "";
let outbox = "";
let firstNotion = "";

async function waitFor(url: string, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} didn't come up`);
}

function start(cmd: string, args: string[], cwd: string, env: Record<string, string>, log: string) {
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  const lines: string[] = [];
  p.stdout?.on("data", (d) => lines.push(String(d)));
  p.stderr?.on("data", (d) => lines.push(String(d)));
  p.on("exit", () => writeFileSync(log, lines.join("")));
  procs.push(p);
  return lines;
}

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};

type Packet = { id: string; status: string; group: string; company: string; apply_url: string; has_proof: boolean; reason: string };
type Detail = Packet & { missing_questions: { question_id: string | null; label: string; kind: string; options: string[] | null }[]; unknown_questions: { label: string }[]; confirmation_text: string | null; final_url: string | null; screenshot_url: string | null; result_status: string | null; result_reason: string | null; tracker_id: string | null };
const apiGet = async <T>(path: string): Promise<T> => {
  const r = await context.request.get(`${API}${path}`);
  expect(r.status(), `${path}: ${await r.text()}`).toBe(200);
  return (await r.json()) as T;
};
const packets = () => apiGet<Packet[]>("/v1/apply/packets");
const detail = (id: string) => apiGet<Detail>(`/v1/apply/packets/${id}`);
const byUrl = async (url: string) => (await packets()).find((p) => url.startsWith(p.apply_url) || p.apply_url.startsWith(url))!;

/** What the candidate would answer: each question Orbit asked them about, by its label. */
function answerFor(label: string, kind: string, options: string[] | null): string {
  const pick = (want: string) => options?.find((o) => o === want) ?? want;
  if (/language skill/i.test(label)) return pick("English (ENG)");
  if (/sponsor/i.test(label)) return pick("No");
  if (/university/i.test(label)) return pick("Other - School Not Listed");
  if (/how you heard|how did you hear/i.test(label)) return pick("LinkedIn");
  if (/notetaker/i.test(label)) return pick("No, I do not consent");
  if (/singapore/i.test(label)) return pick("No");
  if (/country of residence/i.test(label)) return pick("India");
  if (/employment agreements|previously worked/i.test(label)) return pick("No");
  if (/anchor days/i.test(label)) return pick("Yes");
  if (/bay area/i.test(label)) return pick("Yes");
  if (/located in the us|authorized to work in the united states/i.test(label)) return pick("No");
  if (/why do you want/i.test(label)) return "I'd like to build reliable backend services for a product I use every day.";
  if (options?.length) return options[0]!;
  return kind === "boolean" ? "Yes" : "Yes";
}

async function answerAll(id: string) {
  const d = await detail(id);
  const answers = d.missing_questions.map((m) => ({ question_id: m.question_id, label: m.label, value: answerFor(m.label, m.kind, m.options) }));
  const r = await context.request.post(`${API}/v1/apply/packets/${id}/answers`, { data: { answers } });
  expect(r.status(), await r.text()).toBe(200);
  return (await r.json()) as Detail;
}

/** Nudges the runner (the popup's "Check now") until `done` holds. */
async function until<T>(what: string, done: () => Promise<T | null | undefined | false>, ms = 4 * 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await done().catch(() => null);
    if (got) return got;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: "autoApply:refresh" }).catch(() => undefined)).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function openPopup() {
  popup = await context.newPage();
  // Just after a reload the extension's pages are refused for a moment.
  for (let i = 0; ; i++) {
    try {
      await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
      return;
    } catch (e) {
      if (i >= 40) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Watches for one of `ids` in hand: while its window is open and filling, or right as its submit button is
 * pressed (the runner notes that just before the click). The popup records which one it saw. */
async function watchFor(condition: "filling" | "submit_pressed", ids: string[]) {
  await popup.evaluate(
    ([cond, list]) => {
      const w = window as unknown as { __hit?: { id: string; at: number } };
      delete w.__hit;
      chrome.storage.onChanged.addListener((changes) => {
        const cur = changes.autoApplyCurrent?.newValue as { id: string; submitAt?: number } | undefined;
        if (w.__hit || !cur || !list.includes(cur.id)) return;
        if (cond === "submit_pressed" && !cur.submitAt) return;
        if (cond === "filling" && cur.submitAt) return;
        w.__hit = { id: cur.id, at: Date.now() };
      });
    },
    [condition, ids] as const,
  );
}

/** Stops the extension's service worker, as the browser does to an idle or stuck one (DevTools' "Stop"): its memory
 * is gone, its storage and the windows it opened stay. The next event (the popup's "Check now") starts a new one. */
type Version = { versionId: string; scriptURL: string; runningStatus: string };
/** A DevTools session on the popup that keeps the extension's service worker versions up to date. */
async function workerControl() {
  const cdp = await context.newCDPSession(popup);
  const versions = new Map<string, Version>();
  cdp.on("ServiceWorker.workerVersionUpdated", (e: { versions: Version[] }) => {
    for (const v of e.versions) versions.set(v.versionId, v);
  });
  await cdp.send("ServiceWorker.enable");
  return {
    async stop() {
      const mine = [...versions.values()].filter((v) => v.scriptURL.startsWith(`chrome-extension://${extensionId}/`) && v.runningStatus === "running");
      expect(mine.length, "the extension's running service worker").toBeGreaterThan(0);
      await Promise.all(mine.map((v) => cdp.send("ServiceWorker.stopWorker", { versionId: v.versionId })));
      // Stopped for real (its memory gone), not just asked to.
      const end = Date.now() + 15_000;
      while (Date.now() < end && mine.some((m) => versions.get(m.versionId)?.runningStatus !== "stopped")) await new Promise((r) => setTimeout(r, 50));
      const stopped = mine.every((m) => versions.get(m.versionId)?.runningStatus === "stopped");
      await cdp.detach().catch(() => undefined);
      return stopped;
    },
  };
}

/** Waits until the watched moment comes (nudging the runner meanwhile), stops the service worker then (after
 * `delayMs`), and returns the packet that was in hand. */
async function stopWhenSeen(what: string, delayMs: number): Promise<string> {
  const control = await workerControl();
  const end = Date.now() + 4 * 60_000;
  let last = 0;
  for (;;) {
    const hit = await popup.evaluate(() => (window as unknown as { __hit?: { id: string; at: number } }).__hit ?? null);
    if (hit) {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const t0 = Date.now();
      const stopped = await control.stop();
      console.log(`[e2e] ${what}: seen at ${hit.at}, stop sent ${t0}, ${stopped ? "stopped" : "still running"} at ${Date.now()}`);
      expect(stopped, "the service worker stopped").toBe(true);
      return hit.id;
    }
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    if (Date.now() - last > 1500) {
      last = Date.now();
      void popup.evaluate(() => chrome.runtime.sendMessage({ type: "autoApply:refresh" }).catch(() => undefined)).catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "orbit-apply-integrated-"));
  outbox = join(tmp, "outbox.txt");
  // The API and the web app.
  start("uv", ["run", "python", "scripts/e2e_apply_integrated.py", "--port", String(API_PORT), "--web", WEB, "--db", join(tmp, "apply.db")], join(ROOT, "apps/api"), {}, join(tmp, "api.log"));
  start("pnpm", ["--filter", "@orbit/web", "dev", "--host", "127.0.0.1", "--port", String(WEB_PORT), "--strictPort"], ROOT, { VITE_API_URL: API, VITE_LIVE_URL: API }, join(tmp, "web.log"));
  // The fake ATS: a local HTTPS server (throwaway self-signed certificate) for the four ATS hostnames only.
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(tmp, "key.pem"), "-out", join(tmp, "cert.pem"), "-days", "1", "-subj", "/CN=orbit-e2e-fake-ats",
    "-addext", `subjectAltName=${ATS_HOSTS.map((h) => `DNS:${h}`).join(",")}`], { stdio: "ignore" });
  atsServer = createHttpsServer({ key: readFileSync(join(tmp, "key.pem")), cert: readFileSync(join(tmp, "cert.pem")) }, (req, res) => void fakeAts(req, res).catch(() => send(res, 500, "text/plain", "")));
  await new Promise<void>((r) => atsServer.listen(0, "127.0.0.1", r));
  const atsPort = (atsServer.address() as AddressInfo).port;
  const hostRules = [...ATS_HOSTS.map((h) => `MAP ${h} 127.0.0.1:${atsPort}`), "MAP * ~NOTFOUND", "EXCLUDE 127.0.0.1"].join(", ");
  // The extension as built for the store, but pointed at the local Orbit, with the four ATS sites granted up front (a
  // headless browser can't click the permission prompt) and a person's pace sped up.
  const ext = join(tmp, "ext");
  execFileSync("node", ["apps/extension/build.mjs"], { cwd: ROOT, env: { ...process.env, ORBIT_EXTENSION_OUT: ext, ORBIT_WEB_URL: WEB, ORBIT_API_URL: API, ORBIT_APPLY_PACE: "0.03", ORBIT_E2E_GRANT_HOSTS: "1" }, stdio: "inherit" });
  await waitFor(`${API}/health`, 120_000);
  await waitFor(WEB, 120_000);
  context = await chromium.launchPersistentContext(join(tmp, "profile"), {
    ...(process.env.ORBIT_E2E_CHROMIUM ? { executablePath: process.env.ORBIT_E2E_CHROMIUM } : { channel: "chromium" }),
    headless: true,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--host-resolver-rules=${hostRules}`, "--ignore-certificate-errors"],
  });
  await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
  let worker = context.serviceWorkers()[0];
  for (let i = 0; !worker && i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    worker = context.serviceWorkers()[0];
  }
  extensionId = new URL(worker!.url()).host;
  for (const p of context.pages()) await p.close().catch(() => undefined); // the install's own Connect tab
});

test.afterAll(async () => {
  await context?.close().catch(() => undefined);
  await new Promise((r) => atsServer?.close(r));
  for (const p of procs) {
    if (p.pid && process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* already gone */
      }
    } else p.kill();
  }
});

test.describe.configure({ mode: "serial" });

test("nothing but the local servers is reachable", async () => {
  const page = await context.newPage();
  const blocked = await page.evaluate(() => fetch("https://example.com/").then(() => "reached", () => "blocked")).catch(() => "blocked");
  expect(blocked).toBe("blocked");
  // A real employer's own site isn't one of the four ATS names: it doesn't resolve either.
  expect(await page.goto("https://www.gitlab.com/").then(() => "reached", () => "blocked")).toBe("blocked");
  await page.close();
  const ats = await context.newPage();
  await ats.goto(URLS.palantir);
  expect(await ats.evaluate(() => typeof (window as unknown as { __FAKE_ATS?: unknown }).__FAKE_ATS)).toBe("object");
  await ats.close();
});

test("the setup wizard turns Orbit Apply on, says the extension is needed, and the planner prepares packets", async () => {
  const email = `apply-${crypto.randomUUID().slice(0, 8)}@example.com`;
  let r = await context.request.post(`${API}/v1/auth/register`, { data: { email, password: "correct horse battery", name: "Asha Rao", country: "IN" } });
  expect(r.status()).toBe(201);
  const RESUME = {
    basics: { name: "Asha Rao", headline: "Backend Engineer", email, phone: "+91 98765 43210", location: "Bengaluru, Karnataka", summary: "Backend engineer building Python services and APIs on AWS.",
      links: [{ label: "LinkedIn", url: "https://linkedin.com/in/asha" }, { label: "GitHub", url: "https://github.com/asha" }] },
    experience: [{ title: "Backend Engineer", company: "PayNest", location: "Bengaluru", start: "Jan 2021", current: true,
      bullets: ["Built Python services on PostgreSQL handling 2M payments a day", "Designed REST APIs used by 40 partner banks"] }],
    education: [{ school: "RV College of Engineering", degree: "B.E.", field: "Computer Science" }],
    skills: [{ name: "Skills", items: ["Python", "PostgreSQL", "AWS", "REST APIs", "Docker"] }],
  };
  r = await context.request.post(`${API}/v1/resumes`, { data: { title: "Master CV", data: RESUME } });
  const rid = (await r.json()).id;
  await context.request.put(`${API}/v1/jobs/profile`, { data: { prefs: { titles: ["Backend Engineer"], skills: ["Python", "PostgreSQL", "AWS"], locations: ["Bengaluru"], posted_within: 30 }, resume_id: rid } });

  const page = await context.newPage();
  await page.goto(`${WEB}/jobs/auto-apply`);
  await page.getByRole("heading", { name: "Set up Orbit Apply" }).waitFor();
  const note = page.getByTestId("extension-state");
  await expect(note).toHaveAttribute("data-state", "never");
  await expect(note).toContainText("Apply for me automatically");
  await expect(note.getByRole("link", { name: /extension/ })).toHaveAttribute("href", "/extension/connect");
  await shot(page, "01-setup-extension-needed");
  await page.getByRole("button", { name: "Approve this resume" }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByLabel("Notice period (days)").fill("30");
  await page.getByRole("button", { name: "Add a country" }).click();
  await page.getByLabel("Country code").last().fill("IN");
  await page.getByLabel("Authorised to work there?").last().selectOption("yes");
  await page.getByLabel("Need visa sponsorship?").last().selectOption("no");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: /^Next/ }).click();
  await expect(page.getByText("Turning it on here alone sends nothing.")).toBeVisible();
  await page.getByLabel("I agree").check();
  await shot(page, "02-setup-consent");
  await page.getByRole("button", { name: "Save and turn on" }).click();
  await page.getByText("Orbit Apply is on").waitFor();
  await page.getByRole("button", { name: "Find jobs now" }).click();
  await page.getByText(/Prepared \d+ new application/).waitFor({ timeout: 60_000 });
  await shot(page, "03-planned");
  const all = await packets();
  expect(all.map((p) => p.company).sort()).toEqual(["Discord", "GitLab", "GitLab", "Notion", "Notion", "Palantir"]);
  // Discord's form couldn't be read: standard fields, ready. The others wait for answers only the candidate has.
  expect((await byUrl(URLS.discord)).status).toBe("ready");
  for (const u of [URLS.gitlab, URLS.palantir, URLS.notion]) expect((await byUrl(u)).status).toBe("needs_answer");
  await page.close();
});

test("the extension connects through Orbit's Connect page and is switched on in its popup", async () => {
  const site = await context.newPage();
  await site.goto(`${WEB}/extension/connect`);
  await expect(site.getByText("Apply for me automatically")).toBeVisible();
  await site.getByRole("button", { name: "Connect the extension" }).click();
  await expect(site.getByText("Connected.", { exact: false })).toBeVisible();
  await shot(site, "04-extension-connected");
  await site.close();
  await openPopup();
  await expect(popup.getByRole("heading", { name: "Auto-apply" })).toBeVisible();
  // The test build has the four sites granted already; the browser's prompt can't be clicked headless.
  await popup.evaluate(() => {
    chrome.permissions.request = async () => true;
  });
  await popup.getByRole("switch").click();
  await expect(popup.getByText(/Today: \d+ of 10 applications\./)).toBeVisible();
  await shot(popup, "05-popup-on");
});

test("Discord: a required question Orbit couldn't see comes back as needs you; answered in the web; the next run submits", async () => {
  const discord = await byUrl(URLS.discord);
  const after = await until("Discord's first result", async () => {
    const d = await detail(discord.id);
    return d.result_status ? d : null;
  });
  expect(after).toMatchObject({ status: "needs_you", result_reason: "unknown_question" });
  expect(submitted(URLS.discord)).toBe(0);
  expect(after.unknown_questions.map((q) => q.label)).toEqual(expect.arrayContaining(["Are you currently located in the US?"]));
  expect(after.missing_questions.length).toBeGreaterThan(0);

  // The web app now knows the extension is on.
  const page = await context.newPage();
  await page.goto(`${WEB}/jobs/applications?packet=${discord.id}`);
  await expect(page.getByTestId("extension-state")).toHaveAttribute("data-state", "on");
  const form = page.locator("form", { hasText: "Only you can answer" });
  await form.waitFor();
  await shot(page, "06-discord-needs-answers");
  const d = await detail(discord.id);
  const fields = form.locator("input, select, textarea");
  expect(await fields.count()).toBe(d.missing_questions.length);
  for (let i = 0; i < d.missing_questions.length; i++) {
    const m = d.missing_questions[i]!;
    const f = fields.nth(i);
    const value = answerFor(m.label, m.kind, m.options);
    if ((await f.evaluate((el) => el.tagName)) === "SELECT") await f.selectOption({ label: value });
    else await f.fill(value);
  }
  await page.getByRole("button", { name: "Save my answers" }).click();
  await expect(page.getByRole("button", { name: "Try again" })).toBeEnabled();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(async () => (await detail(discord.id)).status).not.toBe("needs_you");
  await page.close();

  const done = await until("Discord submitted", async () => {
    const x = await detail(discord.id);
    return x.status === "submitted" ? x : x.status === "needs_you" || x.status === "failed" ? Promise.reject(new Error(`${x.status}: ${x.reason}`)) : null;
  });
  expect(done.confirmation_text).toContain("Thank you for applying");
  expect(submitted(URLS.discord)).toBe(1);
  const sent = submissions.find((s) => s.url.startsWith(URLS.discord))!.data;
  expect(sent).toMatchObject({ first_name: "Asha", country: "India", question_38318893002: "No", question_38318894002: "Yes" });
});

test("GitLab: answered once, sent with proof; the captcha one needs you, by email too, with Finish in one click", async () => {
  // The email goes to a verified address: verify it with the link Orbit sent.
  const link = readFileSync(outbox, "utf8").match(/http:\/\/127\.0\.0\.1:\d+\/verify-email\?token=[\w-]+/)?.[0];
  expect(link).toBeTruthy();
  const v = await context.newPage();
  await v.goto(link!);
  await v.waitForTimeout(1500);
  await v.close();

  const ok = await byUrl(URLS.gitlab);
  const captcha = await byUrl(URLS.gitlabCaptcha);
  const answered = await answerAll(ok.id);
  expect(answered.status).toBe("ready");
  // Saved to the answer bank: the other GitLab packet, asking the same, is ready too.
  await expect.poll(async () => (await detail(captcha.id)).status).toBe("ready");
  const [a, b] = await until("both GitLab results", async () => {
    const x = await detail(ok.id);
    const y = await detail(captcha.id);
    return x.result_status && y.result_status ? [x, y] : null;
  });
  expect(a).toMatchObject({ status: "submitted", has_proof: true, screenshot_url: null });
  expect(a.confirmation_text).toContain("Thank you for applying");
  expect(a.final_url).toBe(`${URLS.gitlab}/confirmation`);
  expect(submitted(URLS.gitlab)).toBe(1);
  const sent = submissions.find((s) => s.url.startsWith(URLS.gitlab))!.data;
  expect(sent).toMatchObject({ first_name: "Asha", question_38624170002: "No", question_38624174002: "India", gender: "Decline To Self Identify" });
  expect(b).toMatchObject({ status: "needs_you", result_reason: "captcha" });
  expect(submitted(URLS.gitlabCaptcha)).toBe(0);
  const mail = await expect.poll(() => readFileSync(outbox, "utf8")).toContain("Orbit Apply needs you").then(() => readFileSync(outbox, "utf8"));
  expect(mail).toContain(`/jobs/applications?packet=${captcha.id}`);
  expect(mail).toContain("Finish in one click");

  const page = await context.newPage();
  await page.goto(`${WEB}/jobs/applications?packet=${captcha.id}`);
  await expect(page.getByText(/captcha/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Finish in one click/ })).toBeVisible();
  await shot(page, "07-gitlab-captcha-needs-you");
  await page.goto(`${WEB}/jobs/applications?packet=${ok.id}`);
  await expect(page.getByRole("heading", { name: "Proof" })).toBeVisible();
  await expect(page.getByTestId("confirmation-text")).toContainText("Thank you for applying");
  await expect(page.getByTestId("final-url")).toHaveAttribute("href", `${URLS.gitlab}/confirmation`);
  expect(await page.locator("img[alt^='The page after applying']").count()).toBe(0); // no picture, no broken image
  await shot(page, "08-gitlab-applied-proof");
  await page.close();
});

test("Palantir (Lever): answered, sent, the thanks page is the proof", async () => {
  const p = await byUrl(URLS.palantir);
  expect((await answerAll(p.id)).status).toBe("ready");
  const done = await until("Palantir's result", async () => {
    const d = await detail(p.id);
    return d.result_status ? d : null;
  });
  expect(done, JSON.stringify(done)).toMatchObject({ status: "submitted", has_proof: true });
  expect(done.confirmation_text).toContain("Application submitted");
  expect(submitted(URLS.palantir)).toBe(1);
  const sent = submissions.find((s) => s.url.startsWith(URLS.palantir))!.data;
  expect(sent).toMatchObject({ name: "Asha Rao", email: expect.stringContaining("@example.com"), "cards[73796cde-fc01-4758-9002-c85155f3503d][field0]": "No, I do not consent" });
});

test("Notion (Ashby): a service worker restarted mid-application fills it again from the start and submits once", async () => {
  const notion = [await byUrl(URLS.notion), await byUrl(URLS.notion2)];
  await watchFor("filling", notion.map((n) => n.id));
  expect((await answerAll(notion[0]!.id)).status).toBe("ready");
  // Saved to the bank: the second Notion posting asks the same, so it's ready too.
  await expect.poll(async () => (await detail(notion[1]!.id)).status).toBe("ready");
  const id = await stopWhenSeen("a Notion application open in its window", 700);
  const url = notion[0]!.id === id ? URLS.notion : URLS.notion2;
  expect(submitted(url)).toBe(0);
  const done = await until("the restarted Notion application's result", async () => {
    const d = await detail(id);
    return d.result_status ? d : null;
  });
  expect(done, JSON.stringify(done)).toMatchObject({ status: "submitted", has_proof: true });
  expect(done.confirmation_text).toContain("successfully submitted");
  expect(submitted(url)).toBe(1); // opened twice, filled twice, sent once
  expect(atsRequests.filter((r) => r === `GET ${url}`).length).toBe(2);
  firstNotion = id;
});

test("the second Notion posting goes too (two per company in 30 days at most), and that's the free trial used up", async () => {
  const other = (await packets()).find((p) => p.company === "Notion" && p.id !== firstNotion)!;
  const done = await until("the second Notion result", async () => {
    const d = await detail(other.id);
    return d.result_status ? d : null;
  });
  expect(done).toMatchObject({ status: "submitted", has_proof: true });
  expect(submitted(other.apply_url)).toBe(1);
  const s = await apiGet<{ quota_left: number; why_not: string | null; today: number }>("/v1/apply/status");
  expect(s).toMatchObject({ quota_left: 0, why_not: "no_quota", today: 5 });
  await popup.reload();
  await expect(popup.locator("li.result.submitted", { hasText: "Notion" }).first()).toBeVisible();
  await shot(popup, "09-popup-results");
});

test("the server shows what was applied: tracker Applied (Orbit Apply), the quota charged only for submissions", async () => {
  const all = await packets();
  const applied = all.filter((p) => p.status === "submitted");
  expect(applied.map((p) => p.company).sort()).toEqual(["Discord", "GitLab", "Notion", "Notion", "Palantir"]);
  expect(applied.every((p) => p.has_proof)).toBe(true);
  const tracker = await apiGet<{ company: string; status: string; applied_via: string | null; notes: string }[]>("/v1/jobs/tracker");
  for (const company of ["Discord", "GitLab", "Notion", "Palantir"]) {
    const e = tracker.find((t) => t.company === company && t.applied_via === "orbit_apply");
    expect(e, company).toMatchObject({ status: "applied" });
    expect(e!.notes).toContain("Applied (Orbit Apply)");
  }
  const setup = await apiGet<{ quota: { used: number }; executor_seen_at: string | null }>("/v1/apply/setup");
  expect(setup.quota.used).toBe(5); // the five submissions; the captcha and the unknown question weren't charged
  expect(setup.executor_seen_at).toBeTruthy();
  const page = await context.newPage();
  await page.goto(`${WEB}/jobs/applications`);
  await page.getByRole("button", { name: /^Applied/ }).click();
  await shot(page, "10-applications-applied");
  await page.goto(`${WEB}/jobs/tracker`);
  await page.getByText("Palantir").first().waitFor();
  await shot(page, "11-tracker");
  await page.close();
});

test("Pause in the popup pauses Orbit Apply on the server, and the web app shows it", async () => {
  await popup.reload();
  await popup.getByRole("button", { name: "Pause" }).click();
  await expect(popup.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(popup.getByText("Paused in Orbit, here and in the web app.")).toBeVisible();
  await shot(popup, "12-popup-paused");
  expect((await apiGet<{ paused: boolean }>("/v1/apply/setup")).paused).toBe(true);
  const page = await context.newPage();
  await page.goto(`${WEB}/jobs/applications`);
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
  await expect(page.getByText("Paused. Resume here or in the extension.")).toBeVisible();
  await shot(page, "13-web-paused");
  // And back from the web: the popup follows.
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.close();
  await popup.reload();
  await expect(popup.getByRole("button", { name: "Pause" })).toBeVisible();
  // Nothing was ever sent anywhere but the fake ATS.
  expect(atsRequests.every((r) => ATS_HOSTS.some((h) => r.includes(`://${h}/`)))).toBe(true);
  writeFileSync(join(SHOTS, "submissions.json"), JSON.stringify({ submissions: submissions.map((s) => ({ ats: s.ats, url: s.url, fields: Object.keys(s.data).length })), atsRequests }, null, 1));
  expect(existsSync(join(SHOTS, "01-setup-extension-needed.png"))).toBe(true);
});
