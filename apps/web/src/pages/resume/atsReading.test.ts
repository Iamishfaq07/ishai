import { describe, expect, it } from "vitest";
import type { ResumeData } from "@orbit/types";
import { atsReading, readableDate } from "./atsReading";
import { emptyData } from "./model";

function data(): ResumeData {
  const d = emptyData();
  d.basics = { ...d.basics, name: "Asha Rao", email: "asha@example.com", phone: "+91 98765 43210", summary: "Backend engineer." };
  d.experience = [
    { id: "e1", title: "Engineer", company: "Acme", location: "", start: "Jan 2021", end: "", current: true, bullets: ["Built X"] },
    { id: "e2", title: "Intern", company: "Globex", location: "", start: "Summer 2019", end: "'19", current: false, bullets: ["Did Y"] },
  ];
  d.skills = [{ id: "s", name: "Skills", items: ["Go"] }];
  return d;
}

const TEXT = "Asha Rao\nasha@example.com · +91 98765 43210 · linkedin.com/in/asha\nSummary\nBackend engineer.\nExperience\nEngineer, Acme\nBuilt X ★\nSkills\nGo";

describe("atsReading", () => {
  it("finds the contact details, the headings and the dates a parser can read", () => {
    const r = atsReading(TEXT, data());
    expect(r.found).toEqual({ email: true, phone: true, links: 1 });
    expect(r.headings).toEqual([{ heading: "Summary", recognized: true }, { heading: "Experience", recognized: true }, { heading: "Skills", recognized: true }]);
    expect(r.unreadableDates).toEqual(["Intern at Globex"]);
    expect(r.nameFirst).toBe(true);
    expect(r.oddCharacters).toEqual(["★"]);
  });

  it("flags a heading parsers don't know, and a page that doesn't start with the name", () => {
    const d = data();
    d.titles = { experience: "Where I've worked" };
    const r = atsReading("Skills\nGo\nAsha Rao", d);
    expect(r.headings.find((h) => h.heading === "Where I've worked")?.recognized).toBe(false);
    expect(r.nameFirst).toBe(false);
    expect(r.found.email).toBe(false);
  });

  it("knows the usual ways of writing a date", () => {
    for (const ok of ["Jan 2021", "September 2019", "06/2018", "2018", "Present", ""]) expect(readableDate(ok), ok).toBe(true);
    for (const bad of ["Summer 2019", "'19", "Q3 2020", "2019 Spring"]) expect(readableDate(bad), bad).toBe(false);
  });
});
