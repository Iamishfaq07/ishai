// Orbit Apply end to end (D84), headless only: the setup wizard → the planner on fixture jobs → a needs_answer packet
// answered → a fake executor (apps/api/scripts/fake_executor.py) leases and reports (submitted with a screenshot,
// then needs_you on a captcha) → the Applications view and the tracker show them. Axe runs on both pages.
//
// Start first (nothing here touches the network or a real site):
//   API:  cd apps/api && uv run python scripts/e2e_auto_apply.py --port 8039 --web http://127.0.0.1:5202
//   Web:  VITE_API_URL=http://127.0.0.1:8039 pnpm --filter @orbit/web dev --host 127.0.0.1 --port 5202
// Then: node tools/e2e/auto-apply.mjs   (screenshots in %TEMP%\orbit-autoapply-e2e\)
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const API = process.env.API ?? "http://127.0.0.1:8039";
const WEB = process.env.WEB ?? "http://127.0.0.1:5202";
const OUT = join(tmpdir(), "orbit-autoapply-e2e");
mkdirSync(OUT, { recursive: true });
const checks = [];
const check = (ok, what) => {
  checks.push(`${ok ? "PASS" : "FAIL"} ${what}`);
  console.log(`${ok ? "PASS" : "FAIL"} ${what}`);
};

const RESUME = {
  basics: { name: "Asha Rao", headline: "Backend Engineer", email: "asha@example.com", phone: "+91 98765 43210",
    location: "Bengaluru, Karnataka", summary: "Backend engineer building Python services and APIs on AWS." },
  experience: [{ title: "Backend Engineer", company: "PayNest", location: "Bengaluru", start: "Jan 2021", current: true,
    bullets: ["Mentored two junior engineers through their first year",
      "Built Python services on PostgreSQL handling 2M payments a day", "Designed REST APIs used by 40 partner banks"] }],
  education: [{ school: "RV College of Engineering", degree: "B.E.", field: "Computer Science" }],
  skills: [{ name: "Skills", items: ["Communication", "Python", "PostgreSQL", "AWS", "REST APIs", "Docker"] }],
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(() => localStorage.setItem("orbit.cookies.v1", "1"));
const page = await context.newPage();
await page.emulateMedia({ reducedMotion: "reduce" });
const shot = async (name) => { await page.waitForTimeout(400); await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true }); };
const axe = async (label) => {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  check(violations.length === 0, `axe ${label}: ${violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(" ")).slice(0, 2)}`).join("; ") || "clean"}`);
};
try {
  // A candidate with a resume and a Jobs AI profile.
  const email = `apply-${crypto.randomUUID().slice(0, 8)}@example.com`;
  let r = await context.request.post(`${API}/v1/auth/register`, { data: { email, password: "correct horse battery", name: "Asha Rao", country: "IN" } });
  check(r.status() === 201, "registered");
  r = await context.request.post(`${API}/v1/resumes`, { data: { title: "Master CV", data: RESUME } });
  const rid = (await r.json()).id;
  await context.request.put(`${API}/v1/jobs/profile`, { data: { prefs: { titles: ["Backend Engineer"], skills: ["Python", "PostgreSQL", "AWS"], locations: ["Bengaluru"], posted_within: 30 }, resume_id: rid } });

  // The wizard.
  await page.goto(`${WEB}/jobs/auto-apply`);
  await page.getByRole("heading", { name: "Set up Orbit Apply" }).waitFor();
  await shot("01-setup-resume");
  await axe("setup (resume step)");
  await page.getByRole("button", { name: "Approve this resume" }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByLabel("Notice period (days)").fill("30");
  await page.getByRole("button", { name: "Add a country" }).click();
  await page.getByLabel("Country code").last().fill("IN");
  await page.getByLabel("Authorised to work there?").last().selectOption("yes");
  await page.getByLabel("Need visa sponsorship?").last().selectOption("no");
  await shot("02-setup-facts");
  await axe("setup (facts step)");
  await page.getByRole("button", { name: /^Next/ }).click();
  await shot("03-setup-answers");
  await axe("setup (answer bank)");
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByRole("button", { name: /^Next/ }).click();
  await shot("04-setup-mode");
  await page.getByRole("button", { name: /^Next/ }).click();
  await page.getByLabel("I agree").check();
  await shot("05-setup-consent");
  await page.getByRole("button", { name: "Save and turn on" }).click();
  await page.getByText("Orbit Apply is on").waitFor();
  check(true, "setup saved and turned on");
  await page.getByRole("button", { name: "Find jobs now" }).click();
  await page.getByText(/Prepared \d+ new application/).waitFor({ timeout: 30_000 });
  const prepared = await page.getByText(/Prepared \d+ new application/).textContent();
  check(/Prepared [3-9]/.test(prepared ?? ""), `planner: ${prepared}`);
  await shot("06-setup-planned");

  // Applications: needs_answer → answered.
  await page.goto(`${WEB}/jobs/applications`);
  await page.getByRole("button", { name: /^Needs you/ }).waitFor();
  await shot("07-applications-prepared");
  await axe("applications");
  await page.getByRole("button", { name: /^Needs you/ }).click();
  await shot("08-applications-needs-you");
  await page.getByRole("button", { name: /Backend Engineer at Meesho/ }).click();
  const form = page.locator("form", { hasText: "Only you can answer" });
  await form.waitFor();
  await shot("09-needs-answer");
  await axe("application detail (needs an answer)");
  const fields = form.locator("input, select, textarea");
  const n = await fields.count();
  for (let i = 0; i < n; i++) {
    const f = fields.nth(i);
    const tag = await f.evaluate((el) => el.tagName);
    if (tag === "SELECT") await f.selectOption({ index: 1 });
    else await f.fill("18 LPA");
  }
  await page.getByRole("button", { name: "Save my answers" }).click();
  await page.getByText("Ready to send").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
  const meesho = await (await context.request.get(`${API}/v1/apply/packets`)).json();
  const m = meesho.find((p) => p.company === "Meesho");
  check(m?.status === "ready", `Meesho answered once → ${m?.status}`);
  await shot("10-answered");
  await page.keyboard.press("Escape");

  // The fake executor, with an extension-scoped token.
  r = await context.request.post(`${API}/v1/extension/connect`, { headers: { Origin: WEB } });
  const token = (await r.json()).token;
  check(Boolean(token), "extension token");
  const scoped = await context.request.get(`${API}/v1/apply/setup`, { headers: { Authorization: `Bearer ${token}` } });
  check(scoped.status() === 403, `the extension token can't read the setup (${scoped.status()})`);
  const api = resolve("apps/api");
  const run = (scenario) => JSON.parse(execFileSync("uv", ["run", "python", "scripts/fake_executor.py", "--api", API, "--token", token, "--scenario", scenario], { cwd: api, encoding: "utf8" }));
  const first = run("submitted,submitted");
  check(first[0].result?.status === "submitted" && first[0].pdf_is_pdf, `executor: submitted ${first[0].company} (${first[0].ats}), resume PDF ok`);
  check(first[1].next === 204 && first[1].why === "pacing", `executor: the next ask waits (${first[1].why})`);
  console.log("waiting 62 s for the server's pacing…");
  await page.waitForTimeout(62_000);
  const second = run("needs_you:captcha");
  check(second[0].result?.status === "needs_you", `executor: ${second[0].company} needs you (captcha)`);
  check(second[1].status.today === 1, `status: today ${second[1].status.today}, needs you ${second[1].status.needs_you}`);

  // What the candidate sees.
  await page.goto(`${WEB}/jobs/applications`);
  await page.getByRole("button", { name: /^Applied/ }).click();
  await page.getByRole("button", { name: new RegExp(`at ${first[0].company}`) }).click();
  await page.getByRole("heading", { name: "Proof" }).waitFor();
  await page.locator("img").last().waitFor();
  await shot("11-applied-proof");
  await axe("application detail (applied, with proof)");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Needs you/ }).click();
  await page.getByRole("button", { name: new RegExp(`at ${second[0].company}`) }).click();
  await page.getByText(/captcha/i).first().waitFor();
  await shot("12-needs-you-captcha");
  check(await page.getByRole("link", { name: /Finish in one click/ }).isVisible(), "Finish in one click is offered");
  await page.keyboard.press("Escape");

  await page.goto(`${WEB}/jobs/tracker`);
  await page.getByText(first[0].company).first().waitFor();
  await shot("13-tracker");
  const tracker = await (await context.request.get(`${API}/v1/jobs/tracker`)).json();
  const t = tracker.find((e) => e.company === first[0].company);
  check(t?.status === "applied" && t?.applied_via === "orbit_apply", `tracker: ${first[0].company} ${t?.status} via ${t?.applied_via}`);
} catch (e) {
  check(false, `run stopped: ${e.message}`);
  await shot("99-failure").catch(() => undefined);
} finally {
  await browser.close();
}
const failed = checks.filter((c) => c.startsWith("FAIL"));
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed. Screenshots: ${OUT}`);
process.exit(failed.length ? 1 : 0);
