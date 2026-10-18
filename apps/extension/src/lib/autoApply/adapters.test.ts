// The ATS adapters and the fill engine against saved copies of real, public Greenhouse, Lever and Ashby application
// pages (tools/e2e/ats-fixtures). No network. The pages' own scripts aren't there, so where a test needs the page to
// react (showing an attached file's name) it does what the ATS would.
import type { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { ADAPTERS, onAtsHost } from "./adapters";
import type { ApplicationPacket, PacketAnswer } from "./contract";
import { blocker, captchaShown } from "./detect";
import { checkPage, fillApplication, plan, pressSubmit, verdict, type PageCheck, type ResumeFile } from "./engine";
import { loadFixture, URLS, type FixtureName } from "./test/fixtures";

const ans = (label: string, value: PacketAnswer["value"], question_id?: string): PacketAnswer => ({ label, value, question_id, kind: "text", source: "bank" });

function packet(answers: PacketAnswer[] = [], over: Partial<ApplicationPacket> = {}): ApplicationPacket {
  return {
    id: "pkt_1",
    job: { url: "https://example.test/job", apply_url: "https://jobs.lever.co/x/y/apply", ats: "lever", company: "Acme", title: "Engineer" },
    resume: { filename: "Asha Rao Resume.pdf", download_url: "/v1/apply/pkt_1/resume" },
    cover_letter: "Dear team, I would like to apply.",
    fields: {
      first_name: "Asha", last_name: "Rao", email: "asha@example.com", phone: "+91 98765 43210", location: "Bengaluru",
      linkedin: "https://linkedin.com/in/asha", website: "", github: "https://github.com/asha", current_company: "Acme Robotics", country: "India",
    },
    answers,
    eeo: "decline",
    not_before: "2026-10-19T00:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
    ...over,
  };
}

const RESUME: ResumeFile = { b64: btoa("%PDF-1.4 fake"), filename: "Asha Rao Resume.pdf", type: "application/pdf" };

/** jsdom has no DataTransfer and a read-only FileList: give it the minimum a browser has. */
function withFiles(dom: JSDOM): JSDOM {
  const win = dom.window as unknown as Record<string, unknown> & { HTMLInputElement: { prototype: object } };
  class DT {
    private list: File[] = [];
    items = { add: (f: File) => void this.list.push(f) };
    get files() {
      const l = this.list;
      return Object.assign([...l], { item: (i: number) => l[i] ?? null });
    }
  }
  win.DataTransfer = DT;
  Object.defineProperty(win.HTMLInputElement.prototype, "files", {
    configurable: true,
    get(this: { _files?: unknown }) {
      return this._files ?? Object.assign([], { item: () => null });
    },
    set(this: { _files?: unknown }, v: unknown) {
      this._files = v;
    },
  });
  return dom;
}

const doc = (name: FixtureName) => loadFixture(name).window.document;
const questionsOf = (name: FixtureName) => {
  const ats = name.split("-")[0] as "greenhouse" | "lever" | "ashby";
  const d = doc(name);
  const form = ADAPTERS[ats].form(d);
  expect(form, `${name}: form found`).not.toBeNull();
  return { d, qs: ADAPTERS[ats].questions(form!) };
};

describe("reading real application forms", () => {
  it("Greenhouse: standard fields, files, custom questions by id, dropdowns, the EEO section", () => {
    const { qs } = questionsOf("greenhouse-discord");
    const by = (id: string) => qs.find((q) => q.questionId === id)!;
    expect(by("first_name")).toMatchObject({ label: "First Name", required: true });
    expect(by("resume")).toMatchObject({ role: "resume", required: true });
    expect(by("cover_letter")).toMatchObject({ role: "cover_letter", required: false });
    expect(by("question_38318888002")).toMatchObject({ label: "Why do you want to work at Discord?", required: true });
    expect(by("question_38318892002").widget.type).toBe("combobox");
    expect(by("4033064002")).toMatchObject({ label: "Gender", required: true });
    expect(by("4033068002")).toMatchObject({ label: "Gender Identity (optional)", required: false });
    // react-select's hidden "required" copies, the phone flag search and the captcha response aren't questions.
    expect(qs.some((q) => /recaptcha|iti/.test(q.questionId ?? ""))).toBe(false);
    expect(qs).toHaveLength(25);
  });

  it("Lever: resume, standard fields, question cards, required marks, hidden EEO surveys", () => {
    const { qs } = questionsOf("lever-palantir");
    expect(qs.map((q) => q.questionId)).toEqual(expect.arrayContaining(["resume", "name", "email", "phone", "location", "org", "urls[LinkedIn]", "comments"]));
    const languages = qs.find((q) => q.label.startsWith("Language Skill"))!;
    expect(languages).toMatchObject({ required: true, questionId: "cards[a69a985a-eae9-4c14-90fb-b5a4b891523e][field0]" });
    expect(languages.widget.type).toBe("checkboxes");
    const spotify = questionsOf("lever-spotify").qs;
    const surveys = spotify.filter((q) => q.questionId?.startsWith("surveysResponses"));
    expect(surveys.length).toBeGreaterThan(3);
    const p = plan(spotify, packet());
    expect(p.steps.some((s) => surveys.includes(s.q))).toBe(false); // hidden until a location is picked: not touched
  });

  it("Ashby: data-field-path entries, Yes/No buttons, the location autocomplete, EEO radios", () => {
    const { qs } = questionsOf("ashby-notion");
    const by = (id: string) => qs.find((q) => q.questionId === id)!;
    expect(by("_systemfield_email")).toMatchObject({ label: "Email", required: true });
    expect(by("_systemfield_resume")).toMatchObject({ role: "resume", required: true });
    expect(by("_systemfield_location").widget.type).toBe("combobox");
    expect(by("790b5934-74f5-46f5-897a-675b7f37f2f3").widget.type).toBe("yesno");
    expect(by("_systemfield_eeoc_gender")).toMatchObject({ label: "Gender", required: false });
    expect(questionsOf("ashby-linear").qs.find((q) => q.label === "Cover letter")).toMatchObject({ role: "cover_letter", required: true });
  });
});

describe("planning: what Orbit answers and what it hands back", () => {
  it("answers standard fields from the profile, EEO with decline, and lists required questions it has no answer for", () => {
    const { qs } = questionsOf("greenhouse-discord");
    const p = plan(qs, packet([ans("Are you legally authorized to work in the United States for our Company?", "Yes")]));
    const sources = new Map(p.steps.map((s) => [s.q.questionId, s.source]));
    expect(sources.get("first_name")).toBe("field");
    expect(sources.get("candidate-location")).toBe("field");
    expect(sources.get("country")).toBe("field");
    expect(sources.get("resume")).toBe("resume");
    expect(sources.get("cover_letter")).toBe("cover_letter");
    expect(sources.get("question_38318892002")).toBe("answer");
    expect(sources.get("4033064002")).toBe("eeo");
    expect(sources.get("veteran_status")).toBe("eeo");
    expect(sources.has("preferred_name")).toBe(false); // optional and not a profile field: left alone
    expect(p.unknown.map((q) => q.label)).toEqual([
      "Why do you want to work at Discord?",
      "Are you currently located in the US?",
      "Are you currently based in or willing to relocate to the Bay Area for this position?",
    ]);
  });

  it("only ticks a consent box from an explicit answer", () => {
    const { qs } = questionsOf("lever-spotify");
    const consent = qs.find((q) => q.questionId === "consent[marketing]")!;
    expect(plan([consent], packet()).steps).toHaveLength(0); // optional, no answer: left unticked
    consent.required = true;
    expect(plan([consent], packet()).unknown).toEqual([consent]);
    const agreed = plan([consent], packet([ans(consent.label, true)]));
    expect(agreed.steps).toHaveLength(1);
  });

  it("a value that isn't one of the options is unknown, not a near match", () => {
    const { qs } = questionsOf("lever-palantir");
    const uni = qs.find((q) => q.label.startsWith("Which university"))!;
    expect(plan([uni], packet([ans(uni.label, "IIT Bombay (Mumbai)")])).unknown).toEqual([uni]);
    expect(plan([uni], packet([ans(uni.label, "Other - School Not Listed")])).steps).toHaveLength(1);
  });
});

describe("filling a real form, and never submitting on its own", () => {
  const palantirAnswers = [
    ans("Language Skill(s) (Check all that apply)", ["English (ENG)", "Hindi (HIN)"]),
    ans("Are you legally authorized to work in the country for which you are applying?", true),
    ans("Will you now or in the future require sponsorship for employment visa status (e.g., H-1B, etc.)?", false),
    ans("Which university are you currently attending or did you last attend? Please select \"Other (School Not Listed)\" if your school is not listed.", "Other - School Not Listed"),
    ans("Please tell us how you heard about this opportunity.", "LinkedIn"),
    ans("Are you a Singapore citizen?", "No"),
    ans("Are you a Singapore permanent resident?", "No"),
  ];

  function leverPage(): { d: Document; submitted: () => boolean } {
    const dom = withFiles(loadFixture("lever-palantir"));
    const d = dom.window.document;
    // What Lever's script does when a resume is chosen: show its name.
    d.querySelector("input[name=resume]")!.addEventListener("change", (e) => {
      const f = (e.target as HTMLInputElement).files?.[0];
      d.querySelector(".resume .filename")!.textContent = f?.name ?? "";
    });
    let clicked = false;
    d.querySelector("#btn-submit")!.addEventListener("click", () => (clicked = true));
    return { d, submitted: () => clicked };
  }

  it("stops at the AI-notetaker consent question it has no answer for, without pressing submit", async () => {
    const { d, submitted } = leverPage();
    const out = await fillApplication(d, { adapter: ADAPTERS.lever, packet: packet(palantirAnswers), resume: RESUME });
    expect(out).toMatchObject({ kind: "stop", status: "needs_you", reason: "unknown_question" });
    if (out.kind !== "stop") throw new Error();
    expect(out.unknown).toEqual([expect.objectContaining({ label: expect.stringContaining("AI notetakers"), kind: "radio", options: ["Yes, I consent", "No, I do not consent"] })]);
    expect((d.querySelector("input[name=name]") as HTMLInputElement).value).toBe(""); // stopped before typing anything
    expect(submitted()).toBe(false);
  });

  it("fills everything, attaches the resume, and is ready; submit is a separate, explicit step", async () => {
    const { d, submitted } = leverPage();
    const notetaker = "As part of our interview process, we may use AI notetakers to transcribe conversations for accuracy and efficiency. Please see our candidate privacy policy for more information on how we process your data. Your decision to opt in or out of this tooling will not impact your candidacy.";
    const p = packet([...palantirAnswers, ans(notetaker, "No, I do not consent")]);
    const out = await fillApplication(d, { adapter: ADAPTERS.lever, packet: p, resume: RESUME });
    expect(out.kind, JSON.stringify(out)).toBe("ready");
    const val = (sel: string) => (d.querySelector(sel) as HTMLInputElement).value;
    expect(val("input[name=name]")).toBe("Asha Rao");
    expect(val("input[name=email]")).toBe("asha@example.com");
    expect(val("input[name=org]")).toBe("Acme Robotics");
    expect(val("input[name='urls[GitHub]']")).toBe("https://github.com/asha");
    expect(val("input[name='urls[Portfolio]']")).toBe(""); // no website in the profile
    expect(val("textarea[name=comments]")).toBe("Dear team, I would like to apply.");
    expect((d.querySelector("input[name=resume]") as HTMLInputElement).files![0]!.name).toBe("Asha Rao Resume.pdf");
    const checked = [...d.querySelectorAll<HTMLInputElement>("input:checked")].map((i) => i.value);
    expect(checked).toEqual(expect.arrayContaining(["English (ENG)", "Hindi (HIN)", "Yes", "No, I do not consent"]));
    expect(val("select[name='cards[3da58b41-acf5-40a1-945e-c7f047ef8050][field0]']")).toBe("Other - School Not Listed");
    expect(submitted()).toBe(false);
    if (out.kind !== "ready") throw new Error();
    expect(out.submitted.fields).toMatchObject({ full_name: "Asha Rao", email: "asha@example.com", location: "Bengaluru" });
    expect(out.submitted.answers.find((x) => x.question_id === "comments")?.value).toBe("Dear team, I would like to apply.");
    expect(pressSubmit(d, ADAPTERS.lever)).toBe(true);
    expect(submitted()).toBe(true);
  });

  it("a resume the page doesn't take is a stop (needs you), not a submission", async () => {
    const dom = withFiles(loadFixture("lever-palantir"));
    const d = dom.window.document;
    d.querySelector("input[name=resume]")!.addEventListener("change", () => {
      (d.querySelector(".resume-upload-oversize") as HTMLElement).style.display = "block";
      (d.querySelector(".resume-upload-oversize .error-message") as HTMLElement).style.display = "block";
    });
    const notetaker = d.querySelector("[name='cards[73796cde-fc01-4758-9002-c85155f3503d][field0]']")!.closest("li.application-question")!.querySelector(".text")!.textContent!.replace("✱", "");
    const out = await fillApplication(d, { adapter: ADAPTERS.lever, packet: packet([...palantirAnswers, ans(notetaker, "No, I do not consent")]), resume: RESUME });
    expect(out).toMatchObject({ kind: "stop", status: "needs_you", reason: "error" });
    const none = await fillApplication(withFiles(loadFixture("lever-palantir")).window.document, { adapter: ADAPTERS.lever, packet: packet([...palantirAnswers, ans(notetaker, "No, I do not consent")]), resume: null });
    expect(none).toMatchObject({ kind: "stop", status: "needs_you", reason: "error" });
  });
});

describe("stop conditions", () => {
  const withHtml = (name: FixtureName, extra: string) => loadFixture({ html: loadFixture(name).serialize().replace("</body>", `${extra}</body>`), url: URLS[name] }).window.document;

  it("the invisible reCAPTCHA badge alone is not a captcha; a challenge on show is", () => {
    expect(captchaShown(doc("greenhouse-gitlab"))).toBe(false);
    expect(captchaShown(doc("ashby-linear"))).toBe(false);
    expect(captchaShown(doc("lever-spotify"))).toBe(false);
    const challenged = withHtml("greenhouse-gitlab", '<div><iframe title="recaptcha challenge expires in two minutes" src="https://www.google.com/recaptcha/api2/bframe?k=x"></iframe></div>');
    expect(captchaShown(challenged)).toBe(true);
    const hcaptcha = withHtml("lever-spotify", '<iframe src="https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=challenge"></iframe>');
    expect(blocker(hcaptcha, true)).toBe("captcha");
  });

  it("a captcha on the page stops the run before anything is typed", async () => {
    const d = withHtml("greenhouse-gitlab", '<iframe src="https://www.google.com/recaptcha/api2/bframe?k=x"></iframe>');
    const out = await fillApplication(d, { adapter: ADAPTERS.greenhouse, packet: packet(), resume: RESUME });
    expect(out).toMatchObject({ kind: "stop", status: "needs_you", reason: "captcha" });
    expect((d.getElementById("first_name") as HTMLInputElement).value).toBe("");
  });

  const page = (body: string, url = "https://jobs.lever.co/acme/123/apply") => loadFixture({ html: `<!doctype html><html><body>${body}</body></html>`, url }).window.document;

  it("a sign-in wall, an email code, a closed posting and an unknown form each stop with their reason", async () => {
    const run = (d: Document, ats: "lever" | "greenhouse" = "lever") => fillApplication(d, { adapter: ADAPTERS[ats], packet: packet(), resume: RESUME });
    expect(await run(page('<h1>Sign in to apply</h1><form><input type="email"><input type="password"><button>Sign in</button></form>'))).toMatchObject({ status: "needs_you", reason: "login" });
    expect(await run(page('<h2>Check your email</h2><p>Enter the verification code we sent to a***@example.com</p><input id="security-input-0" maxlength="1">'))).toMatchObject({ status: "needs_you", reason: "email_verification" });
    expect(await run(page("<h1>Sorry, this job is no longer accepting applications.</h1>"))).toMatchObject({ status: "skipped" });
    expect(await run(page('<form id="application-form"><input name="favourite_colour"></form>'))).toMatchObject({ status: "needs_you", reason: "form_changed" });
    expect(await run(page("<h1>Access denied</h1>"), "greenhouse")).toMatchObject({ status: "needs_you", reason: "blocked" });
  });
});

describe("success only from the ATS's own success state", () => {
  const confirm = (html: string, url: string) => loadFixture({ html: `<!doctype html><html><body>${html}</body></html>`, url }).window.document;

  it("recognises each ATS's confirmation and nothing else", () => {
    expect(ADAPTERS.greenhouse.success(confirm('<main><h1>Thank you for applying.</h1><p>Your application has been received.</p></main>', "https://job-boards.greenhouse.io/gitlab/jobs/8860302002/confirmation"))).toContain("Thank you for applying");
    expect(ADAPTERS.lever.success(confirm('<div class="template-content"><h3>Application submitted!</h3></div>', "https://jobs.lever.co/palantir/6ed76ce8/thanks"))).toContain("Application submitted");
    expect(ADAPTERS.ashby.success(confirm('<div class="ashby-application-form-success-container"><h2>Thank you for applying</h2><p>Your application was successfully submitted.</p></div>', URLS["ashby-linear"]))).toContain("successfully submitted");
    // The application pages themselves (form on show), and a page with neither form nor confirmation.
    for (const name of ["greenhouse-gitlab", "lever-palantir", "ashby-notion"] as FixtureName[]) {
      expect(ADAPTERS[name.split("-")[0] as "lever"].success(doc(name))).toBeNull();
    }
    expect(ADAPTERS.ashby.success(confirm("<h1>Something went wrong</h1>", URLS["ashby-linear"]))).toBeNull();
  });

  const check = (over: Partial<PageCheck>): PageCheck => ({ success: null, captcha: false, emailVerification: false, blocked: false, errors: [], formPresent: true, url: "", ...over });

  it("never reports a submission without a success state", () => {
    expect(verdict(check({}), 5_000, 60_000, null)).toEqual({ done: false });
    expect(verdict(check({ formPresent: false }), 30_000, 60_000, null)).toEqual({ done: false });
    expect(verdict(check({}), 60_000, 60_000, null)).toMatchObject({ done: true, status: "failed", reason: "form_changed" });
    // The form went away but no confirmation appeared (Ashby can reject silently): failed, unsure, no confirmation text.
    expect(verdict(check({ formPresent: false }), 60_000, 60_000, null)).toEqual({ done: true, status: "failed", reason: "error", confirmation: null });
    expect(verdict(null, 60_000, 60_000, null)).toMatchObject({ done: true, status: "failed" });
    expect(verdict(check({ captcha: true }), 2_000, 60_000, null)).toMatchObject({ status: "needs_you", reason: "captcha" });
    expect(verdict(check({ emailVerification: true, formPresent: false }), 2_000, 60_000, null)).toMatchObject({ status: "needs_you", reason: "email_verification" });
    expect(verdict(check({ errors: ["Required"] }), 3_000, 60_000, 1_000)).toEqual({ done: false });
    expect(verdict(check({ errors: ["Required"] }), 9_000, 60_000, 1_000)).toMatchObject({ status: "needs_you", reason: "error" });
    expect(verdict(check({ success: "Thank you for applying" }), 2_000, 60_000, null)).toEqual({ done: true, status: "submitted", reason: null, confirmation: "Thank you for applying" });
  });

  it("checks a page: a confirmation reads as success, the form as not yet", () => {
    expect(checkPage(doc("greenhouse-gitlab"), ADAPTERS.greenhouse)).toMatchObject({ success: null, captcha: false, formPresent: true });
  });
});

describe("where auto-apply goes", () => {
  it("only the ATS's own https hosts", () => {
    expect(onAtsHost("https://job-boards.greenhouse.io/gitlab/jobs/1", "greenhouse")).toBe(true);
    expect(onAtsHost("https://boards.greenhouse.io/gitlab/jobs/1", "greenhouse")).toBe(true);
    expect(onAtsHost("https://jobs.lever.co/x/y/apply", "lever")).toBe(true);
    expect(onAtsHost("https://jobs.ashbyhq.com/x/y/application", "ashby")).toBe(true);
    expect(onAtsHost("http://jobs.lever.co/x", "lever")).toBe(false);
    expect(onAtsHost("https://jobs.lever.co.evil.test/x", "lever")).toBe(false);
    expect(onAtsHost("https://jobs.lever.co/x", "greenhouse")).toBe(false);
    expect(onAtsHost("https://careers.example.com/apply?gh_jid=1", "greenhouse")).toBe(false);
  });
});
