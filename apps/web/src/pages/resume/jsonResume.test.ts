import { describe, expect, it } from "vitest";
import type { ResumeData } from "@orbit/types";
import { fromIsoDate, fromJsonResume, toIsoDate, toJsonResume } from "./jsonResume";
import { emptyData } from "./model";

function sample(): ResumeData {
  const d = emptyData();
  d.basics = { name: "Asha Rao", headline: "Backend engineer", email: "asha@example.com", phone: "+91 98765 43210", location: "Bengaluru",
    links: [{ label: "LinkedIn", url: "https://linkedin.com/in/asha" }], summary: "Builds payment systems." };
  d.experience = [
    { id: "e1", title: "Backend Engineer", company: "PayNest", location: "Bengaluru", start: "Jan 2021", end: "", current: true, bullets: ["Cut latency by 40%", ""] },
    { id: "e2", title: "Engineer", company: "Acme", location: "", start: "06/2018", end: "Dec 2020", current: false, bullets: ["Built the ledger"] },
  ];
  d.education = [{ id: "ed", school: "IIT Delhi", degree: "B.Tech", field: "CS", start: "2014", end: "2018", details: "Dean's list", grade: "8.6 / 10 CGPA" }];
  d.skills = [{ id: "s", name: "Languages", items: ["Go", "Python"] }];
  d.certifications = [{ id: "c", name: "AWS SA", issuer: "Amazon", date: "Mar 2022" }];
  d.extras = [{ id: "x1", title: "Languages", items: ["English", "Hindi"], style: "inline" }];
  d.section_order = [...d.section_order, "extra:x1"];
  return d;
}

describe("JSON Resume", () => {
  it("writes and reads dates the standard's way", () => {
    expect(toIsoDate("Jan 2021")).toBe("2021-01");
    expect(toIsoDate("September 2019")).toBe("2019-09");
    expect(toIsoDate("06/2018")).toBe("2018-06");
    expect(toIsoDate("2018")).toBe("2018");
    expect(toIsoDate("Summer 2019")).toBe("Summer 2019"); // kept as written
    expect(fromIsoDate("2021-01-15")).toBe("Jan 2021");
    expect(fromIsoDate("2018")).toBe("2018");
    expect(fromIsoDate(undefined)).toBe("");
  });

  it("exports to the standard's fields", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reading a JSON document field by field
    const doc = toJsonResume(sample()) as Record<string, any>;
    expect(doc.basics).toMatchObject({ name: "Asha Rao", label: "Backend engineer", location: { address: "Bengaluru" },
      profiles: [{ network: "LinkedIn", url: "https://linkedin.com/in/asha" }] });
    expect(doc.work[0]).toEqual({ name: "PayNest", position: "Backend Engineer", location: "Bengaluru", startDate: "2021-01", highlights: ["Cut latency by 40%"] });
    expect(doc.work[1].endDate).toBe("2020-12");
    expect(doc.education[0]).toMatchObject({ institution: "IIT Delhi", studyType: "B.Tech", area: "CS", score: "8.6 / 10 CGPA", courses: ["Dean's list"] });
    expect(doc.skills).toEqual([{ name: "Languages", keywords: ["Go", "Python"] }]);
    expect(doc.certificates).toEqual([{ name: "AWS SA", issuer: "Amazon", date: "2022-03" }]);
    expect(doc.languages).toEqual([{ language: "English" }, { language: "Hindi" }]);
  });

  it("comes back from an Orbit export exactly as it went", () => {
    const original = sample();
    const { data, title } = fromJsonResume(JSON.parse(JSON.stringify(toJsonResume(original))));
    expect(title).toBe("Asha Rao's resume");
    expect(data.basics).toEqual(original.basics);
    expect(data.experience.map(({ id: _, ...e }) => e)).toEqual(original.experience.map(({ id: _, ...e }) => ({ ...e, bullets: e.bullets.filter(Boolean),
      start: e.start === "06/2018" ? "Jun 2018" : e.start })));
    expect(data.extras).toEqual(original.extras);
    expect(data.section_order).toEqual(original.section_order);
  });

  it("reads another tool's file, its extra sections included", () => {
    const { data } = fromJsonResume({
      basics: { name: "Sam Lee", url: "https://sam.dev", location: { city: "Pune", countryCode: "IN" } },
      work: [{ name: "Globex", position: "SRE", startDate: "2019-04-01", endDate: "2023-02", summary: "Ran on-call.", highlights: ["Halved paging"] }],
      awards: [{ title: "Hackathon winner", awarder: "Globex", date: "2021-05" }],
      languages: [{ language: "English", fluency: "Native" }],
    });
    expect(data.basics.location).toBe("Pune, IN");
    expect(data.basics.links).toEqual([{ label: "Website", url: "https://sam.dev" }]);
    expect(data.experience[0]).toMatchObject({ company: "Globex", title: "SRE", start: "Apr 2019", end: "Feb 2023", current: false,
      bullets: ["Ran on-call.", "Halved paging"] });
    expect(data.extras.map((x) => [x.title, x.items])).toEqual([["Languages", ["English (Native)"]], ["Awards", ["Hackathon winner, Globex, May 2021"]]]);
    expect(data.section_order.filter((s) => s.startsWith("extra:"))).toHaveLength(2);
  });

  it("refuses what isn't a resume", () => {
    expect(() => fromJsonResume([])).toThrow();
    expect(() => fromJsonResume({ hello: "world" })).toThrow();
    expect(() => fromJsonResume("text")).toThrow();
  });
});
