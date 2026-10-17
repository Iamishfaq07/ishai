import { describe, expect, it } from "vitest";
import { boxOnPage, classifyField, type FieldBox, type FieldInfo } from "./fields";

const f = (over: Partial<FieldInfo>): FieldInfo => ({ name: "", id: "", label: "", autocomplete: "", placeholder: "", type: "text", ...over });

describe("which field asks for what", () => {
  it("reads Greenhouse, Lever and Workday style fields", () => {
    expect(classifyField(f({ name: "job_application[first_name]", label: "First Name" }))).toBe("first_name");
    expect(classifyField(f({ id: "last_name", label: "Last Name" }))).toBe("last_name");
    expect(classifyField(f({ name: "name", label: "Full name" }))).toBe("full_name");
    expect(classifyField(f({ name: "email", type: "email" }))).toBe("email");
    expect(classifyField(f({ name: "phone", label: "Phone" }))).toBe("phone");
    expect(classifyField(f({ name: "urls[LinkedIn]", label: "LinkedIn Profile" }))).toBe("linkedin");
    expect(classifyField(f({ name: "urls[GitHub]", label: "GitHub URL" }))).toBe("github");
    expect(classifyField(f({ name: "urls[Portfolio]", label: "Portfolio" }))).toBe("website");
    expect(classifyField(f({ label: "Current location" }))).toBe("location");
    expect(classifyField(f({ autocomplete: "given-name" }))).toBe("first_name");
  });

  it("leaves the person's own answers alone", () => {
    for (const label of ["Expected salary", "Why do you want to join?", "Will you need visa sponsorship?", "Gender", "Cover letter", "Notice period", "Password"]) {
      expect(classifyField(f({ label })), label).toBeNull();
    }
    expect(classifyField(f({ type: "file", label: "Resume" }))).toBeNull();
    expect(classifyField(f({ type: "checkbox", label: "Email me jobs" }))).toBeNull();
    expect(classifyField(f({ label: "Favourite colour" }))).toBeNull();
  });
});

describe("which fields are on show", () => {
  const box = (over: Partial<FieldBox>): FieldBox => ({ width: 200, height: 32, right: 400, bottom: 300, scrollX: 0, scrollY: 0, ...over });

  it("fills an ordinary field, also one below the fold or scrolled past", () => {
    expect(boxOnPage(box({}))).toBe(true);
    expect(boxOnPage(box({ bottom: 5000 }))).toBe(true);
    expect(boxOnPage(box({ bottom: -100, scrollY: 900 }))).toBe(true); // above the viewport, still on the page
  });

  it("skips fields too small to see or parked off the page", () => {
    expect(boxOnPage(box({ width: 1, height: 1 }))).toBe(false);
    expect(boxOnPage(box({ height: 0 }))).toBe(false);
    expect(boxOnPage(box({ right: -9000 }))).toBe(false);
    expect(boxOnPage(box({ bottom: -9000, scrollY: 0 }))).toBe(false);
  });
});
