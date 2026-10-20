// Real Chromium with intercepted employer pages. Every network request is fulfilled locally or rejected by the
// worker's own navigation rules. No real employer receives an application and no Orbit browser extension is loaded.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { build } from "vite";
import { fileURLToPath } from "node:url";
import { runLease } from "./worker.mjs";
import { browserEnvironment } from "./sites.mjs";

let browser;
const pageScript = fileURLToPath(new URL("../dist/test-page.js", import.meta.url));
before(async () => {
  await build({ configFile: false, logLevel: "silent", define: { __ORBIT_APPLY_PACE__: "0" },
    build: { outDir: fileURLToPath(new URL("../dist", import.meta.url)), emptyOutDir: false, minify: false,
      lib: { entry: fileURLToPath(new URL("./page.ts", import.meta.url)), formats: ["iife"], name: "orbitTest", fileName: () => "test-page.js" } } });
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, env: browserEnvironment(process.env) });
});
after(async () => { await browser?.close(); });

function lease(ats, url) {
  return { token: "test-attempt-token", packet: { id: randomUUID(), job: { ats, apply_url: url, url, title: "Engineer", company: "Example" },
    fields: { first_name: "Asha", last_name: "Rao", full_name: "Asha Rao", email: "asha@example.test", phone: "", location: "Bengaluru", country: "India", linkedin: "", website: "", github: "" },
    answers: [], eeo: "decline", cover_letter: "From approved facts.", lease_expires_at: new Date(Date.now() + 120_000).toISOString() } };
}
const resume = { b64: Buffer.from("%PDF-1.4\nfixture").toString("base64"), filename: "Asha - Resume.pdf", type: "application/pdf" };

function form({ wizard = false, unknown = false, noConfirmation = false, captcha = false } = {}) {
  return `<!doctype html><html><body><main><h1>My information</h1><form data-automation-id="applicationForm" id="application-form" data-test="application-form" data-ui="application-form">
    <div class="form-field"><label for="first_name">First name *</label><input id="first_name" name="first_name" required></div>
    <div class="form-field"><label for="email">Email *</label><input id="email" name="email" type="email" required></div>
    <div class="form-field"><label for="resume">Resume *</label><input id="resume" name="resume" type="file" required><p id="attached"></p></div>
    ${unknown ? '<div class="form-field"><label for="cert">Describe your security clearance *</label><input id="cert" name="cert" required></div>' : ""}
    <button type="button" id="next">${wizard ? "Save and Continue" : "Submit application"}</button></form></main>
    <script>
      document.querySelector('#resume').addEventListener('change', e => document.querySelector('#attached').textContent=e.target.files[0].name);
      document.querySelector('#next').onclick=()=>{
        if (${wizard}) {
          document.querySelector('main').innerHTML='<h1>Review your application</h1><form data-automation-id="applicationForm"><button type="button" id="submit">Submit</button></form>';
          document.querySelector('#submit').onclick=finish;
        } else finish();
      };
      function finish() { document.querySelector('main').innerHTML=${JSON.stringify(captcha ? '<h1>Verify you are human</h1><iframe title="captcha" src="https://captcha.example.test/challenge"></iframe>' : noConfirmation ? '<h1>Processing application</h1>' : '<h1>Your application has been submitted</h1>')}; }
    </script></body></html>`;
}

function fixtureBrowser(html, origin) {
  return { async newContext(options) {
    const context = await browser.newContext(options);
    const register = context.route.bind(context);
    // Install the fixture route after the worker registers its network guard. Unmatched URLs fall through to that
    // guard; a navigation to another origin therefore still exercises the real refusal logic.
    context.route = async (pattern, handler) => {
      await register(pattern, handler);
      await register("**/*", async (route) => {
        if (new URL(route.request().url()).origin === origin) await route.fulfill({ contentType: "text/html", body: html });
        else await route.fallback();
      });
    };
    return context;
  } };
}

function protocol({ allowed = true, answer = null } = {}) {
  const calls = [];
  return { calls, async api(path, body) {
    calls.push({ path, body });
    if (path.endsWith("/questions")) return Response.json(answer || { answers: [], missing: body.questions });
    return Response.json({ allowed });
  } };
}

for (const [ats, url] of [
  ["greenhouse", "https://job-boards.greenhouse.io/example/jobs/123"],
  ["lever", "https://jobs.lever.co/example/11111111-1111-1111-1111-111111111111/apply"],
  ["ashby", "https://jobs.ashbyhq.com/example/11111111-1111-1111-1111-111111111111/application"],
]) test(`${ats}: existing adapter runs in the hosted worker without an extension`, async () => {
  const fields = [["name", "Full name", "text"], ["email", "Email", "email"], ["resume", "Resume", "file"]];
  const body = fields.map(([id, label, type]) => {
    const controls = `<input id="${id}" name="${id}" type="${type}" required>${type === "file" ? '<p id="attached"></p>' : ""}`;
    if (ats === "lever") return `<li class="application-question"><div class="application-label"><span class="text">${label}</span></div>${controls}</li>`;
    return `<div class="form-field" data-field-path="_systemfield_${id}"><label for="${id}">${label}</label>${controls}</div>`;
  }).join("");
  const html = `<main><form id="application-form">${body}<button type="button" id="btn-submit" class="ashby-application-form-submit-button">Submit application</button></form></main><script>
    document.querySelector('#resume').addEventListener('change',e=>document.querySelector('#attached').textContent=e.target.files[0].name);
    document.querySelector('#btn-submit').onclick=()=>document.querySelector('main').innerHTML='<h1>Your application has been submitted</h1>';
  </script>`;
  const p = protocol();
  const result = await runLease(fixtureBrowser(html, new URL(url).origin), lease(ats, url), p.api, resume, { pageScript, pollMs: 20 });
  assert.equal(result.status, "submitted", JSON.stringify(result));
  assert.equal(p.calls.filter((c) => c.path.endsWith("/submit")).length, 1);
});

for (const [ats, url] of [
  ["workday", "https://example.wd5.myworkdayjobs.com/en-US/Careers/job/Engineer_R1/apply"],
  ["smartrecruiters", "https://jobs.smartrecruiters.com/Example/744000123456789-engineer?oga=true"],
  ["workable", "https://apply.workable.com/example/j/ABC123/apply/"],
  ["recruitee", "https://example.recruitee.com/o/engineer/c/new"],
]) test(`${ats}: fills resume and approved fields, fences final submission and keeps employer confirmation`, async () => {
  const item = lease(ats, url), p = protocol();
  const result = await runLease(fixtureBrowser(form({ wizard: ats === "workday" }), new URL(url).origin), item, p.api, resume, { pageScript, pollMs: 20 });
  assert.equal(result.status, "submitted", JSON.stringify(result));
  assert.match(result.confirmation_text, /submitted/);
  assert.equal(result.submitted.fields.email, "asha@example.test");
  assert.equal(p.calls.filter((c) => c.path.endsWith("/submit")).length, 1);
  assert.ok(result.screenshot_png_b64);
});

test("unknown required questions are handed off without clicking submit", async () => {
  const url = "https://example.wd5.myworkdayjobs.com/en-US/Careers/job/Engineer_R1/apply";
  const p = protocol(), item = lease("workday", url);
  const result = await runLease(fixtureBrowser(form({ unknown: true }), new URL(url).origin), item, p.api, resume, { pageScript, pollMs: 20 });
  assert.equal(result.status, "needs_you"); assert.equal(result.reason, "unknown_question");
  assert.equal(result.unknown_questions[0].label, "Describe your security clearance");
  assert.equal(p.calls.filter((c) => c.path.endsWith("/submit")).length, 0);
});

test("hosted agent field match is filled before a single fenced submission and employer confirmation", async () => {
  const url = "https://example.wd5.myworkdayjobs.com/en-US/Careers/job/Engineer_R1/apply";
  const label = "Share a link to your professional network";
  const html = form({ unknown: true }).replace("Describe your security clearance", label);
  const item = lease("workday", url);
  const p = protocol({ answer: { missing: [], answers: [{ question_id: null, label, kind: "text",
    value: "https://linkedin.com/in/asha", source: "profile", required: true }] } });
  const result = await runLease(fixtureBrowser(html, new URL(url).origin), item, p.api, resume, { pageScript, pollMs: 20 });
  assert.equal(result.status, "submitted", JSON.stringify(result));
  assert.equal(result.submitted.answers.find((a) => a.label === label)?.value, "https://linkedin.com/in/asha");
  assert.match(result.confirmation_text, /submitted/);
  assert.equal(p.calls.filter((c) => c.path.endsWith("/questions")).length, 1);
  assert.equal(p.calls.filter((c) => c.path.endsWith("/submit")).length, 1);
});

test("a paused attempt cannot click submit", async () => {
  const url = "https://apply.workable.com/example/j/ABC123/apply/", p = protocol({ allowed: false });
  const result = await runLease(fixtureBrowser(form(), new URL(url).origin), lease("workable", url), p.api, resume, { pageScript, pollMs: 20 });
  assert.equal(result.status, "needs_you"); assert.equal(result.confirmation_text, null);
});

test("password gates need the candidate; the worker never submits login credentials", async () => {
  const url = "https://example.wd5.myworkdayjobs.com/en-US/Careers/job/Engineer_R1/apply", p = protocol();
  const result = await runLease(fixtureBrowser('<main><h1>Sign in to apply</h1><input type="password"></main>', new URL(url).origin), lease("workday", url), p.api, resume, { pageScript });
  assert.equal(result.reason, "login"); assert.equal(p.calls.filter((c) => c.path.endsWith("/submit")).length, 0);
});

test("an absent confirmation never becomes submitted or billable", async () => {
  const url = "https://apply.workable.com/example/j/ABC123/apply/", p = protocol();
  const result = await runLease(fixtureBrowser(form({ noConfirmation: true }), new URL(url).origin), lease("workable", url), p.api, resume, { pageScript, pollMs: 20, timeoutMs: 2500 });
  assert.equal(result.status, "needs_you"); assert.equal(result.confirmation_text, null);
  assert.equal(p.calls.filter((c) => c.path.endsWith("/submit")).length, 1);
});
