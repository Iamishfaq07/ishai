import { describe, expect, it } from "vitest";
import { classifyField, type FieldInfo } from "./fields";

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
