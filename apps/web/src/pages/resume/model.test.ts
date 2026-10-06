import { describe, expect, it } from "vitest";
import type { ResumeData } from "@orbit/types";
import { DECLARATION, EXTRA_PRESETS, LOOKS, SERIF_FONTS, TEMPLATES, emptyData, fresherResume, gradeLine, resumeToText, sectionLabel, shownSections } from "./model";

function ids(): () => string {
  let n = 0;
  return () => `id${++n}`;
}

describe("fresherResume", () => {
  it("lays out education first, then projects, skills, internships, responsibility and achievements", () => {
    const { data, design } = fresherResume(ids());
    const printed = shownSections(data).map((s) => sectionLabel(data, s));
    // The empty summary is first but doesn't print, so Education leads the page.
    expect(printed).toEqual(["Summary", "Education", "Projects", "Skills", "Experience", "Positions of Responsibility", "Achievements", "Certifications"]);
    expect(data.basics.summary).toBe("");
    expect(design.template).toBe("campus");
  });

  it("starts the fresher sections empty, so nothing prints until it's filled in", () => {
    const { data } = fresherResume(ids());
    expect(data.extras.map((x) => x.items)).toEqual([[""], [""]]);
    expect(data.education).toHaveLength(1);
    expect(data.education[0]!.grade).toBe("");
    expect(data.experience).toEqual([]);
    expect(data.projects.map((p) => p.bullets)).toEqual([[""]]);
  });

  it("names every section the order points at", () => {
    const { data } = fresherResume(ids());
    const keys = new Set(data.section_order);
    for (const x of data.extras) expect(keys.has(`extra:${x.id}`)).toBe(true);
    expect(keys.size).toBe(data.section_order.length);
  });
});

describe("the education grade", () => {
  const data: ResumeData = {
    ...emptyData(),
    section_order: ["education"],
    education: [
      { id: "a", school: "IIT Delhi", degree: "B.Tech", field: "Computer Science", start: "2021", end: "2025", grade: "8.6 / 10 CGPA", details: "Dean's list" },
      { id: "b", school: "Delhi Public School (CBSE)", degree: "Class 12 (PCM)", field: "", start: "", end: "2021", grade: "94.2%", details: "" },
      // Saved before grades existed.
      { id: "c", school: "Delhi Public School (CBSE)", degree: "Class 10", field: "", start: "", end: "2019", details: "" },
    ],
  };

  it("leads the line under the degree, before the details", () => {
    expect(gradeLine(data.education[0]!)).toBe("8.6 / 10 CGPA · Dean's list");
    expect(gradeLine(data.education[1]!)).toBe("94.2%");
    expect(gradeLine(data.education[2]!)).toBe("");
  });

  it("is in the plain-text resume, Class 12 and Class 10 included", () => {
    expect(resumeToText(data).split("\n")).toEqual([
      "EDUCATION",
      "B.Tech, Computer Science — IIT Delhi (2021 – 2025)",
      "8.6 / 10 CGPA · Dean's list",
      "Class 12 (PCM) — Delhi Public School (CBSE) (2021)",
      "94.2%",
      "Class 10 — Delhi Public School (CBSE) (2019)",
    ]);
  });
});

describe("presets and templates", () => {
  it("offers the Indian resume sections, Personal details with its advice and a one-line Declaration", () => {
    const titles = EXTRA_PRESETS.map((p) => p.title);
    for (const t of ["Positions of Responsibility", "Achievements", "Relevant coursework", "Extracurricular activities", "Personal details", "Declaration"]) {
      expect(titles).toContain(t);
    }
    expect(new Set(titles.map((t) => t.toLowerCase())).size).toBe(titles.length);
    const personal = EXTRA_PRESETS.find((p) => p.title === "Personal details")!;
    expect(personal.note).toMatch(/MNC, startup and tech recruiters usually prefer this left out/);
    expect(personal.note).toMatch(/government/);
    const declaration = EXTRA_PRESETS.find((p) => p.title === "Declaration")!;
    expect(declaration.fill).toBe(DECLARATION);
    expect(declaration.style).toBe("inline");
  });

  it("has Campus and Harvard as single-column templates, with quick looks in a serif", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(ids).toContain("campus");
    expect(ids).toContain("harvard");
    expect(ids.at(-1)).toBe("sidebar"); // the one two-column template stays last
    for (const template of ["campus", "harvard"] as const) {
      const look = LOOKS.find((l) => l.design.template === template);
      expect(look && SERIF_FONTS.has(look.design.font)).toBe(true);
    }
  });
});
