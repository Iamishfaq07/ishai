import { fileURLToPath } from "node:url";
import { applicationUrl, sameEmployer, sameApplication } from "./sites.mjs";

const script = fileURLToPath(new URL("../dist/page.js", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const empty = (reason = "error") => ({ status: "needs_you", reason, unknown_questions: [], confirmation_text: null,
  final_url: null, screenshot_png_b64: null, submitted: { fields: {}, answers: [] } });

async function call(page, method, ...args) {
  return page.evaluate(({ method, args }) => globalThis.__orbitHosted[method](...args), { method, args });
}

/** One isolated browser context per leased application. No cookies, passwords or Orbit API credentials enter it. */
export async function runLease(browser, lease, api, resume, { pageScript = script, timeoutMs = 8 * 60_000, pollMs = 350 } = {}) {
  const packet = lease.packet, ats = packet.job.ats, url = applicationUrl(packet.job.apply_url, ats);
  if (!url) return empty("blocked");
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, serviceWorkers: "block", bypassCSP: true, acceptDownloads: false });
  let stopped = false, navigationRefused = false, checkBusy = false, checkFailures = 0, armed = false;
  let submitted = { fields: {}, answers: [] }, result = empty();
  const page = await context.newPage();
  const deadline = Math.min(Date.now() + timeoutMs, Date.parse(packet.lease_expires_at) - 5000);
  const stop = () => { stopped = true; void context.close().catch(() => {}); };
  const timeout = setTimeout(stop, Math.max(1, deadline - Date.now()));
  const monitor = setInterval(async () => {
    if (checkBusy || stopped) return;
    checkBusy = true;
    try {
      const response = await api(`/${packet.id}/check`, { token: lease.token });
      if (!response.ok || !(await response.json()).allowed) stop();
      checkFailures = 0;
    } catch { if (++checkFailures >= 2) stop(); }
    finally { checkBusy = false; }
  }, 5000);
  try {
    await context.addInitScript({ path: pageScript });
    await context.route("**/*", async (route) => {
      const request = route.request();
      // All frame navigations stay with this employer. Even a public redirect to a login provider needs the user.
      if (request.isNavigationRequest() && (!sameEmployer(request.url(), url.origin) || !armed && !sameApplication(request.url(), url, ats))) {
        navigationRefused = true; await route.abort();
      } else if (!request.url().startsWith("https://")) await route.abort();
      else await route.continue();
    });
    context.on("page", (popup) => { if (popup !== page) void popup.close(); });
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
    let emailSeen = false, resumeSeen = false;
    for (let step = 0; step < 20 && !stopped && Date.now() < deadline; step++) {
      await page.waitForFunction(() => !!globalThis.__orbitHosted, null, { timeout: 10_000 });
      let info = await call(page, "inspect", ats);
      if (info.stop) { result = empty(info.stop); break; }
      if (info.success) { result = empty("form_changed"); break; } // Never count a pre-existing thank-you page.
      if (info.action === "waiting") {
        await page.waitForFunction((ats) => globalThis.__orbitHosted.inspect(ats).action !== "waiting", ats, { timeout: 15_000 }).catch(() => {});
        info = await call(page, "inspect", ats);
      }
      if (info.action === "entry") {
        await call(page, "entry", ats);
      } else if (info.action === "next" || info.action === "submit") {
        await call(page, "start", packet, resume);
        await page.waitForFunction(() => globalThis.__orbitHosted.poll()?.done, null, { timeout: Math.max(1, deadline - Date.now()) });
        const filled = await call(page, "poll");
        if (!filled?.result) { result = empty(); break; }
        let out = filled.result;
        out.unknown_questions = out.unknown_questions.slice(0, 50).map((q) => ({ ...q, label: q.label.slice(0, 2000) }));
        if (out.reason === "unknown_question" && out.unknown_questions.length) {
          // Workday and other wizards reveal questions only after earlier steps. Ask Orbit's existing truthful
          // answer bank first. When opted in, the API's bounded profile-matching agent can resolve unfamiliar
          // contact text fields. It returns approved values, never browser instructions or a submission decision.
          const response = await api(`/${packet.id}/questions`, { token: lease.token, questions: out.unknown_questions });
          if (response.ok) {
            const resolved = await response.json();
            if (!resolved.missing.length && resolved.answers.length) {
              const labels = new Set(resolved.answers.map((a) => a.label));
              packet.answers = packet.answers.filter((a) => !labels.has(a.label)).concat(resolved.answers);
              await call(page, "start", packet, resume);
              await page.waitForFunction(() => globalThis.__orbitHosted.poll()?.done, null, { timeout: Math.max(1, deadline - Date.now()) });
              out = (await call(page, "poll"))?.result || out;
            }
          }
        }
        Object.assign(submitted.fields, out.submitted.fields);
        // Steps may repeat fields; retain the final value of each question rather than accumulating duplicates.
        for (const answer of out.submitted.answers) {
          submitted.answers = submitted.answers.filter((a) => a.question_id !== answer.question_id || a.label !== answer.label);
          submitted.answers.push(answer);
        }
        if (out.status !== "ready") { result = { ...empty(out.reason), status: out.status, unknown_questions: out.unknown_questions }; break; }
        emailSeen ||= info.email;
        resumeSeen ||= info.resume;
        const current = await call(page, "inspect", ats);
        if (current.action !== info.action || current.stop) { result = empty(current.stop || "form_changed"); break; }
        if (info.action === "submit") {
          if (!emailSeen || !resumeSeen) { result = empty("form_changed"); break; }
          const arm = await api(`/${packet.id}/submit`, { token: lease.token });
          if (!arm.ok || !(await arm.json()).allowed) { result = empty(); break; }
          if (!sameApplication(page.url(), url, ats)) { result = empty("form_changed"); break; }
          armed = true;
          // Never retry this click, even if navigation destroys the JavaScript response.
          await call(page, "press", ats, "submit").catch(() => false);
          const end = Math.min(Date.now() + 60_000, deadline);
          result = empty();
          while (!stopped && Date.now() < end) {
            if (navigationRefused) { result = empty("login"); break; }
            const check = await call(page, "check", ats).catch(() => null);
            if (check?.captcha || check?.emailVerification || check?.blocked) {
              result = empty(check.captcha ? "captcha" : check.emailVerification ? "email_verification" : "blocked"); break;
            }
            if (check?.success) { result = { ...empty(null), status: "submitted", confirmation_text: check.success, final_url: check.url }; break; }
            if (check?.errors.length) { result = empty("form_changed"); break; }
            await sleep(pollMs);
          }
          break;
        }
        if (!(await call(page, "press", ats, "next").catch(() => false))) { result = empty("form_changed"); break; }
      } else { result = empty(info.stop || "form_changed"); break; }
      // A wizard must demonstrably advance. Re-clicking an unchanged Next can create duplicate side effects.
      await page.waitForFunction(({ ats, signature }) => globalThis.__orbitHosted?.inspect(ats).signature !== signature,
        { ats, signature: info.signature }, { timeout: 15_000 });
    }
  } catch { result = empty(navigationRefused ? "login" : "error"); }
  finally {
    clearInterval(monitor); clearTimeout(timeout);
    result.submitted = submitted;
    if (JSON.stringify(submitted).length > 200_000 || submitted.answers.length > 300) result.submitted = null;
    result.unknown_questions = result.unknown_questions.slice(0, 50).map((q) => ({ ...q, label: q.label.slice(0, 2000) }));
    if (!page.isClosed()) {
      const last = page.url();
      if (sameEmployer(last, url.origin)) result.final_url = last;
      const shot = await page.screenshot({ type: "png", timeout: 5000 }).catch(() => null);
      if (shot && shot.length <= 1_500_000) result.screenshot_png_b64 = shot.toString("base64");
    }
    await context.close().catch(() => {});
  }
  return result;
}
