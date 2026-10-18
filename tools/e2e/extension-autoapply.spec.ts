import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";

// Auto-apply in the browser extension, end to end: the built extension in Chromium (headless, throwaway profile),
// a fake Orbit API implementing the apply contract (next / result / status, resume download), and a fake ATS that
// serves the recorded Greenhouse, Lever and Ashby pages (tools/e2e/ats-fixtures) on their real hostnames: a local HTTPS
// server the browser's resolver maps those four names to. Every other hostname fails to resolve, so nothing reaches a
// real employer site.
const FIXTURES = resolve("tools/e2e/ats-fixtures");
const FAKE_ATS_JS = readFileSync(join(FIXTURES, "fake-ats.js"), "utf8");
const WEB = "http://127.0.0.1:5173";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

type Ats = "greenhouse" | "lever" | "ashby";
type Answer = { question_id?: string; label: string; kind: string; value: string | string[] | boolean; source: string };
type Result = { status: string; reason: string | null; unknown_questions: { label: string; kind: string; options?: string[] }[]; confirmation_text: string | null; final_url: string | null; screenshot_png_b64: string | null; submitted: { fields: Record<string, string>; answers: { question_id: string | null; label: string; value: unknown }[] } };

// ---- Fake Orbit API -------------------------------------------------------------------------------------------------
const api = { queue: [] as unknown[], results: [] as { id: string; body: Result }[], nextCalls: 0, resumeAuth: [] as string[] };
let server: Server;
let atsServer: HttpsServer;
const ATS_HOSTS = ["job-boards.greenhouse.io", "boards.greenhouse.io", "jobs.lever.co", "jobs.ashbyhq.com"];
let API = "";

function json(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", API);
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST" });
    return res.end();
  }
  if (url.pathname === "/files/resume.pdf") {
    api.resumeAuth.push(req.headers.authorization ?? "");
    res.writeHead(200, { "Content-Type": "application/pdf" });
    return res.end(PDF);
  }
  if (req.headers.authorization !== "Bearer e2e-token") return json(res, 401, { detail: "Not signed in" });
  if (url.pathname === "/v1/extension/me") return json(res, 200, { email: "asha@example.com", name: "Asha Rao" });
  if (url.pathname === "/v1/apply/status") return json(res, 200, { today: api.results.filter((r) => r.body.status === "submitted").length, limit: 10, paused: false, next_due: null });
  if (url.pathname === "/v1/apply/next") {
    api.nextCalls++;
    const next = api.queue.shift();
    return next ? json(res, 200, next) : json(res, 204);
  }
  const m = url.pathname.match(/^\/v1\/apply\/([^/]+)\/result$/);
  if (m && req.method === "POST") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    api.results.push({ id: decodeURIComponent(m[1]!), body: JSON.parse(raw) as Result });
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { detail: "Not found" });
}

// ---- Fake ATS (the recorded pages on their real hostnames) -----------------------------------------------------------
type Page_ = { fixture: string; ats: Ats; variant?: string };
const PAGES: Record<string, Page_> = {
  "https://job-boards.greenhouse.io/gitlab/jobs/8860302002": { fixture: "greenhouse-gitlab", ats: "greenhouse" },
  "https://job-boards.greenhouse.io/gitlab/jobs/1000000001": { fixture: "greenhouse-gitlab", ats: "greenhouse", variant: "captcha" },
  "https://job-boards.greenhouse.io/discord/jobs/8806482002": { fixture: "greenhouse-discord", ats: "greenhouse" },
  "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd/apply": { fixture: "lever-palantir", ats: "lever" },
  "https://jobs.lever.co/palantir/00000000-captcha-on-submit/apply": { fixture: "lever-palantir", ats: "lever", variant: "captcha_on_submit" },
  "https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a/application": { fixture: "ashby-notion", ats: "ashby" },
};
const submissions: { ats: string; url: string; data: Record<string, unknown> }[] = [];
const atsRequests: string[] = [];

function send(res: ServerResponse, status: number, type: string, body: string | Buffer) {
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
    return send(res, 200, "text/html", '<!doctype html><html><head><title>Thank you</title></head><body><main><h1>Thank you for applying.</h1><p>Your application has been received. We will review it right away.</p></main></body></html>');
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

// ---- Packets ----------------------------------------------------------------------------------------------------------
const FIELDS = {
  first_name: "Asha", last_name: "Rao", email: "asha@example.com", phone: "+91 98765 43210", location: "Bengaluru",
  linkedin: "https://linkedin.com/in/asha", website: "", github: "https://github.com/asha", country: "India", current_company: "Acme Robotics",
};
const ans = (label: string, value: Answer["value"], question_id?: string): Answer => ({ label, value, question_id, kind: "text", source: "bank" });
let seq = 0;
function packet(applyUrl: string, ats: Ats, answers: Answer[], company = "Acme") {
  return {
    id: `pkt_${++seq}`,
    job: { url: applyUrl, apply_url: applyUrl, ats, company, title: "Software Engineer" },
    resume: { filename: "Asha Rao Resume.pdf", download_url: `${API}/files/resume.pdf` },
    cover_letter: "Dear team, I'd like to apply. Prepared with Orbit AI from my verified profile.",
    fields: FIELDS,
    answers,
    eeo: "decline",
    not_before: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}
const GITLAB_ANSWERS = [ans("Employment agreements", "No", "question_38624170002"), ans("Sponsorship", "No", "question_38624172002"), ans("Worked at GitLab", "No", "question_38624173002"), ans("Country of residence", "India", "question_38624174002")];
const NOTETAKER = "As part of our interview process, we may use AI notetakers to transcribe conversations for accuracy and efficiency. Please see our candidate privacy policy for more information on how we process your data. Your decision to opt in or out of this tooling will not impact your candidacy.";
const PALANTIR_ANSWERS = [
  ans("Language Skill(s) (Check all that apply)", ["English (ENG)", "Hindi (HIN)"]),
  ans("Are you legally authorized to work in the country for which you are applying?", true),
  ans("Will you now or in the future require sponsorship for employment visa status (e.g., H-1B, etc.)?", false),
  ans('Which university are you currently attending or did you last attend? Please select "Other (School Not Listed)" if your school is not listed.', "Other - School Not Listed"),
  ans("Please tell us how you heard about this opportunity.", "LinkedIn"),
  ans(NOTETAKER, "No, I do not consent"),
  ans("Are you a Singapore citizen?", "No"),
  ans("Are you a Singapore permanent resident?", "No"),
];

// ---- Browser ------------------------------------------------------------------------------------------------------------
let context: BrowserContext;
let popup: Page;
let extensionId = "";
let profileDir = "";
let ext = "";
let prodExt = "";

function build(out: string, env: Record<string, string>) {
  execFileSync("node", ["apps/extension/build.mjs"], { env: { ...process.env, ORBIT_EXTENSION_OUT: out, ...env }, stdio: "inherit" });
}

test.beforeAll(async () => {
  server = createServer((req, res) => void handle(req, res).catch((e: unknown) => json(res, 500, { detail: String(e) })));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  API = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const tmp = mkdtempSync(join(tmpdir(), "orbit-autoapply-"));
  // The fake ATS: a local HTTPS server (throwaway self-signed certificate) that the browser reaches for the four ATS
  // hostnames. Every other hostname fails to resolve, so nothing can reach a real employer site.
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(tmp, "key.pem"), "-out", join(tmp, "cert.pem"), "-days", "1", "-subj", "/CN=orbit-e2e-fake-ats",
    "-addext", `subjectAltName=${ATS_HOSTS.map((h) => `DNS:${h}`).join(",")}`], { stdio: "ignore" });
  atsServer = createHttpsServer({ key: readFileSync(join(tmp, "key.pem")), cert: readFileSync(join(tmp, "cert.pem")) }, (req, res) => void fakeAts(req, res).catch(() => send(res, 500, "text/plain", "")));
  await new Promise<void>((r) => atsServer.listen(0, "127.0.0.1", r));
  const atsPort = (atsServer.address() as AddressInfo).port;
  const hostRules = [...ATS_HOSTS.map((h) => `MAP ${h} 127.0.0.1:${atsPort}`), "MAP * ~NOTFOUND", "EXCLUDE 127.0.0.1"].join(", ");
  ext = join(tmp, "ext");
  prodExt = join(tmp, "ext-prod");
  profileDir = join(tmp, "profile");
  // The store build (sites optional) for the manifest check; the test build lists the ATS sites as granted (a headless
  // browser can't click the permission prompt) and applies at 2% of a person's pace.
  build(prodExt, { ORBIT_WEB_URL: WEB, ORBIT_API_URL: API });
  build(ext, { ORBIT_WEB_URL: WEB, ORBIT_API_URL: API, ORBIT_APPLY_PACE: "0.02", ORBIT_E2E_GRANT_HOSTS: "1" });
  context = await chromium.launchPersistentContext(profileDir, {
    ...(process.env.ORBIT_E2E_CHROMIUM ? { executablePath: process.env.ORBIT_E2E_CHROMIUM } : { channel: "chromium" }),
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--host-resolver-rules=${hostRules}`, "--ignore-certificate-errors"],
  });
  // Belt and braces for the pages Playwright opens: only the local servers.
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "127.0.0.1" || u.protocol === "chrome-extension:" || ATS_HOSTS.includes(u.hostname)) return route.fallback();
    return route.abort();
  });
  let worker = context.serviceWorkers()[0];
  for (let i = 0; !worker && i < 50; i++) {
    await new Promise((r) => setTimeout(r, 200));
    worker = context.serviceWorkers()[0];
  }
  extensionId = new URL(worker!.url()).host;
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popup.evaluate(() => chrome.storage.local.set({ token: "e2e-token" }));
  // The install opened Orbit's connect page: not needed here.
  for (const p of context.pages()) if (p !== popup) await p.close();
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((r) => server?.close(r));
  await new Promise((r) => atsServer?.close(r));
  if (profileDir) rmSync(join(profileDir, ".."), { recursive: true, force: true });
});

async function enable() {
  await popup.evaluate(() => chrome.storage.local.set({ autoApply: { enabled: true, paused: false } }));
}

/** Queues a packet and nudges the runner (as the popup's "Check now" does) until it takes it; then waits for the result. */
async function applyOnce(p: ReturnType<typeof packet>, watch?: () => Promise<void>): Promise<Result> {
  const before = api.results.length;
  api.queue.push(p);
  await enable();
  const end = Date.now() + 90_000;
  while (api.results.length === before) {
    if (Date.now() > end) throw new Error("no result posted");
    if (api.queue.length) await popup.evaluate(() => chrome.runtime.sendMessage({ type: "autoApply:refresh" }).catch(() => undefined)).catch(() => undefined);
    await watch?.();
    await new Promise((r) => setTimeout(r, 700));
  }
  const got = api.results[api.results.length - 1]!;
  expect(got.id).toBe(p.id);
  const history = (await popup.evaluate(() => chrome.storage.local.get(["autoApplyHistory"]))).autoApplyHistory as { id: string; detail?: string }[];
  test.info().annotations.push({ type: "detail", description: history.find((h) => h.id === p.id)?.detail ?? "" });
  return got.body;
}

const atsPagesOpen = () => context.pages().filter((p) => /greenhouse|lever|ashby/.test(p.url())).length;

test.describe.configure({ mode: "serial" });

test("the fake ATS answers for the four ATS hostnames; nothing else resolves", async () => {
  const probe = await context.newPage();
  await probe.goto("https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd/apply");
  await expect(probe.locator("#btn-submit")).toBeVisible();
  expect(await probe.evaluate(() => typeof (window as unknown as { __FAKE_ATS?: unknown }).__FAKE_ATS)).toBe("object");
  // The resolver, not Playwright routing, is what keeps the browser off the internet (extension-opened windows too).
  const blocked = await popup.evaluate(() => fetch("https://example.com/").then(() => "reached", () => "blocked"));
  expect(blocked).toBe("blocked");
  await probe.close();
});

test("opt-in asks for exactly the four ATS sites; opt-out gives them back; the store build has no job-site access", async () => {
  const manifest = JSON.parse(readFileSync(join(prodExt, "manifest.json"), "utf8"));
  const sites = ["https://boards.greenhouse.io/*", "https://job-boards.greenhouse.io/*", "https://jobs.lever.co/*", "https://jobs.ashbyhq.com/*"];
  expect(manifest.optional_host_permissions).toEqual(sites);
  expect(manifest.host_permissions.some((h: string) => /greenhouse|lever|ashby/.test(h))).toBe(false);
  expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage", "alarms", "tabGroups"]);

  await popup.reload();
  await expect(popup.getByText("Signed in as asha@example.com")).toBeVisible();
  await expect(popup.getByRole("heading", { name: "Auto-apply" })).toBeVisible();
  await expect(popup.getByText("It never solves captchas")).toBeVisible();
  // Record what the popup asks the browser for (the prompt itself can't be clicked headless).
  await popup.evaluate(() => {
    const calls: unknown[] = [];
    (window as unknown as { __calls: unknown[] }).__calls = calls;
    chrome.permissions.request = async (p) => (calls.push(["request", p]), true);
    chrome.permissions.remove = async (p) => (calls.push(["remove", p]), true);
  });
  const toggle = popup.getByRole("switch");
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(popup.getByText("Today: 0 of 10 applications.")).toBeVisible();
  await expect(popup.getByRole("button", { name: "Pause" })).toBeVisible();
  expect(await popup.evaluate(() => chrome.storage.local.get(["autoApply"]))).toEqual({ autoApply: { enabled: true, paused: false } });
  await popup.getByRole("switch").click();
  await expect(popup.getByRole("button", { name: "Pause" })).toHaveCount(0);
  expect(await popup.evaluate(() => (window as unknown as { __calls: unknown[] }).__calls)).toEqual([
    ["request", { origins: sites }],
    ["remove", { origins: sites }],
  ]);
  expect((await popup.evaluate(() => chrome.storage.local.get(["autoApply"]))).autoApply).toMatchObject({ enabled: false });
  await popup.reload();
});

test("Greenhouse: fills, uploads, answers EEO with decline, submits, sees the confirmation, reports with proof", async () => {
  const url = "https://job-boards.greenhouse.io/gitlab/jobs/8860302002";
  let sawBadge = false;
  let sawGroup = false;
  const result = await applyOnce(packet(url, "greenhouse", GITLAB_ANSWERS, "GitLab"), async () => {
    const s = await popup.evaluate(async () => ({ badge: await chrome.action.getBadgeText({}), groups: await chrome.tabGroups.query({ title: "Orbit Apply" }) })).catch(() => null);
    if (s?.badge === "▶") sawBadge = true;
    if (s?.groups.length) sawGroup = true;
  });
  expect(result, JSON.stringify({ ...result, screenshot_png_b64: null })).toMatchObject({ status: "submitted", reason: null, final_url: `${url}/confirmation` });
  expect(result.confirmation_text).toContain("Thank you for applying");
  expect(result.submitted.fields).toMatchObject({ first_name: "Asha", last_name: "Rao", email: "asha@example.com", phone: "+91 98765 43210", country: "India" });
  const answer = (id: string) => result.submitted.answers.find((a) => a.question_id === id)?.value;
  expect(answer("question_38624168002")).toBeUndefined(); // LinkedIn is a profile field, reported under fields
  expect(result.submitted.fields.linkedin).toBe("https://linkedin.com/in/asha");
  expect(answer("question_38624174002")).toBe("India");
  expect(answer("gender")).toBe("Decline To Self Identify");
  expect(answer("veteran_status")).toBe("I don't wish to answer");
  const sent = submissions.at(-1)!;
  expect(sent.ats).toBe("greenhouse");
  expect(sent.data).toMatchObject({ first_name: "Asha", email: "asha@example.com", question_38624173002: "No", gender: "Decline To Self Identify" });
  expect(String(sent.data.resume)).toMatch(/^file:Asha Rao Resume\.pdf:\d+$/);
  expect(String(sent.data.cover_letter)).toMatch(/^file:Asha Rao - cover letter\.txt:/);
  expect(api.resumeAuth.at(-1)).toBe("Bearer e2e-token");
  if (result.screenshot_png_b64) {
    const png = Buffer.from(result.screenshot_png_b64, "base64");
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(result.screenshot_png_b64.length).toBeLessThanOrEqual(1_500_000);
  }
  test.info().annotations.push({ type: "screenshot", description: result.screenshot_png_b64 ? `captured (${result.screenshot_png_b64.length} b64 chars)` : "not captured: confirmation text only" });
  expect(sawBadge, "the toolbar badge showed it was applying").toBe(true);
  expect(sawGroup, 'the tab was in the "Orbit Apply" group').toBe(true);
  await expect.poll(atsPagesOpen).toBe(0); // its window is closed afterwards
  await popup.reload();
  await expect(popup.locator("li.result.submitted")).toContainText("Software Engineer at GitLab");
});

test("Lever: question cards, radios, the university list, resume, submit, thanks page", async () => {
  const url = "https://jobs.lever.co/palantir/6ed76ce8-4156-4b60-b120-403538bd66cd/apply";
  const result = await applyOnce(packet(url, "lever", PALANTIR_ANSWERS, "Palantir"));
  expect(result, JSON.stringify({ ...result, screenshot_png_b64: null })).toMatchObject({ status: "submitted", final_url: url.replace(/apply$/, "thanks") });
  expect(result.confirmation_text).toContain("Application submitted");
  const sent = submissions.at(-1)!.data;
  expect(sent).toMatchObject({ name: "Asha Rao", email: "asha@example.com", org: "Acme Robotics", "cards[1c719ca9-5069-4afe-9e82-39ca420e0edb][field0]": "Yes", "cards[73796cde-fc01-4758-9002-c85155f3503d][field0]": "No, I do not consent" });
  expect(sent["cards[a69a985a-eae9-4c14-90fb-b5a4b891523e][field0]"]).toEqual(["English (ENG)", "Hindi (HIN)"]);
  expect(String(sent.resume)).toContain("Asha Rao Resume.pdf");
});

test("Ashby: location autocomplete, Yes/No buttons, EEO radios declined, in-place success", async () => {
  const url = "https://jobs.ashbyhq.com/notion/1fc309c8-da20-4ff2-84c7-8b863ece2b0a/application";
  const answers = [ans("Anchor days", true, "e01a85db-feaa-42b3-a9ad-69b1dcbbab3f"), ans("Sponsorship", false, "790b5934-74f5-46f5-897a-675b7f37f2f3")];
  const result = await applyOnce(packet(url, "ashby", answers, "Notion"));
  expect(result, JSON.stringify({ ...result, screenshot_png_b64: null })).toMatchObject({ status: "submitted" });
  expect(result.confirmation_text).toContain("successfully submitted");
  const sent = submissions.at(-1)!.data;
  expect(sent).toMatchObject({ _systemfield_name: "Asha Rao", _systemfield_email: "asha@example.com", "e01a85db-feaa-42b3-a9ad-69b1dcbbab3f": "Yes", "790b5934-74f5-46f5-897a-675b7f37f2f3": "No" });
  expect(Object.entries(sent).find(([k]) => k.endsWith("_systemfield_eeoc_gender"))?.[1]).toBe("on"); // the decline radio
  expect(result.submitted.answers.find((a) => a.question_id === "_systemfield_eeoc_gender")?.value).toBe("Decline to self-identify");
  expect(result.submitted.fields.location).toBe("Bengaluru, Karnataka, India");
});

test("a captcha on the page: needs you (captcha), nothing typed or submitted", async () => {
  const before = submissions.length;
  const result = await applyOnce(packet("https://job-boards.greenhouse.io/gitlab/jobs/1000000001", "greenhouse", GITLAB_ANSWERS));
  expect(result).toMatchObject({ status: "needs_you", reason: "captcha", confirmation_text: null, screenshot_png_b64: null });
  expect(result.submitted.fields).toEqual({});
  expect(submissions.length).toBe(before);
});

test("a captcha challenge after pressing submit: needs you (captcha), never solved, no submission", async () => {
  const before = submissions.length;
  const result = await applyOnce(packet("https://jobs.lever.co/palantir/00000000-captcha-on-submit/apply", "lever", PALANTIR_ANSWERS));
  expect(result).toMatchObject({ status: "needs_you", reason: "captcha", confirmation_text: null });
  expect(result.submitted.fields.email).toBe("asha@example.com"); // it had filled the form
  expect(submissions.length).toBe(before);
});

test("an unanswerable required question: needs you with the question; Finish it opens the job filled for the candidate", async () => {
  const before = submissions.length;
  const url = "https://job-boards.greenhouse.io/discord/jobs/8806482002";
  const answers = [ans("Authorized", "Yes", "question_38318892002"), ans("In the US", "No", "question_38318893002"), ans("Bay Area", "Yes", "question_38318894002")];
  const result = await applyOnce(packet(url, "greenhouse", answers, "Discord"));
  expect(result).toMatchObject({ status: "needs_you", reason: "unknown_question" });
  expect(result.unknown_questions).toEqual([{ label: "Why do you want to work at Discord?", kind: "textarea" }]);
  expect(submissions.length).toBe(before);
  await expect.poll(atsPagesOpen).toBe(0);

  await popup.reload();
  const item = popup.locator("li.result.needs_you", { hasText: "Discord" });
  await expect(item).toContainText("Software Engineer at Discord");
  await expect(item).toContainText("To answer: Why do you want to work at Discord?");
  const opened = context.waitForEvent("page");
  await item.getByRole("button", { name: "Finish it" }).click();
  const tab = await opened;
  await tab.waitForURL(url);
  const panel = tab.locator("#orbit-apply-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText("Orbit had no approved answer for these questions");
  await expect(panel).toContainText("Why do you want to work at Discord?");
  await expect(panel).toContainText("Orbit won't press Submit on this tab");
  await expect(tab.locator("#first_name")).toHaveValue("Asha");
  await expect(tab.locator("#question_38318888002")).toHaveValue("");
  await expect(tab.locator("#first_name")).toHaveAttribute("data-orbit-filled", "auto-apply");
  await tab.waitForTimeout(500);
  expect(submissions.length).toBe(before); // the candidate presses Submit, not Orbit
  await tab.close();
  await popup.reload();
  await expect(popup.locator("li.result.needs_you", { hasText: "Discord" }).getByRole("button", { name: "Finish it" })).toHaveCount(0);
});
