import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { HOSTED_ADAPTERS, readQuestions } from "./adapters";
import { plan } from "../../extension/src/lib/autoApply/engine";
import type { ApplicationPacket } from "../../extension/src/lib/autoApply/contract";

const packet = { fields: { first_name: "Asha", last_name: "Rao", email: "asha@example.test", country: "India" }, answers: [], cover_letter: "From approved facts" } as unknown as ApplicationPacket<string>;
describe("hosted employer forms", () => {
  it("reads required labels, grouped radio answers and a Workday country picker", () => {
    const doc = new JSDOM(`<main><form>
      <div data-automation-id="formField-firstName"><label for="name">First name *</label><input id="name" name="firstName" required></div>
      <div class="form-field"><label id="country-label">Country *</label><button role="combobox" aria-labelledby="country-label" aria-required="true">Select</button></div>
      <fieldset><legend>Are you authorised to work in India? *</legend><label><input type="radio" name="auth" value="Yes">Yes</label><label><input type="radio" name="auth" value="No">No</label></fieldset>
      <div class="form-field"><label for="resume">Resume *</label><input id="resume" type="file" required></div>
    </form></main>`).window.document;
    const questions = readQuestions(doc.querySelector("form")!);
    expect(questions).toHaveLength(4);
    expect(questions.map((q) => q.widget.type)).toEqual(["text", "radio", "file", "selectbutton"]);
    const p = plan(questions, packet);
    expect(p.unknown.map((q) => q.label)).toEqual(["Are you authorised to work in India?"]);
    expect(p.steps.some((s) => s.source === "field" && s.key === "country")).toBe(true);
  });
  it("does not treat an empty form or marketing copy as submission confirmation", () => {
    const doc = new JSDOM(`<main><p>Thanks for applying your skills to our mission.</p><form></form></main>`).window.document;
    for (const ats of ["workday", "smartrecruiters", "workable", "recruitee"] as const) expect(HOSTED_ADAPTERS[ats].success(doc)).toBeNull();
  });
  it("requires an actual employer confirmation heading", () => {
    const doc = new JSDOM(`<main><h1>Your application has been submitted</h1></main>`).window.document;
    expect(HOSTED_ADAPTERS.workday.success(doc)).toBe("Your application has been submitted");
  });
  it("recognises the recorded public Workable form's resume and legal radio group", () => {
    const html = readFileSync(new URL("../test/fixtures/workable.html", import.meta.url), "utf8");
    const doc = new JSDOM(`<main>${html}</main>`).window.document;
    const adapter = HOSTED_ADAPTERS.workable, form = adapter.form(doc)!;
    expect(form).not.toBeNull();
    const qs = adapter.questions(form);
    expect(qs.some((q) => q.role === "resume")).toBe(true);
    const auth = qs.find((q) => q.questionId === "CA_4024");
    expect(auth?.label).toBe("Are you authorised to work in the UK");
    expect(auth?.required).toBe(true);
    expect(adapter.submitButton(form)?.textContent).toContain("Submit application");
    expect(qs.some((q) => q.label.includes("SVGs not supported"))).toBe(false);
  });
  it("recognises the recorded public Recruitee form and its Send button", () => {
    const html = readFileSync(new URL("../test/fixtures/recruitee.html", import.meta.url), "utf8");
    const doc = new JSDOM(`<main>${html}</main>`).window.document;
    const adapter = HOSTED_ADAPTERS.recruitee, form = adapter.form(doc)!;
    expect(form).not.toBeNull();
    const qs = adapter.questions(form);
    expect(qs.some((q) => q.role === "resume")).toBe(true);
    expect(qs.some((q) => q.attrs.type === "email")).toBe(true);
    expect(adapter.submitButton(form)?.textContent?.trim()).toBe("Send");
  });
});
