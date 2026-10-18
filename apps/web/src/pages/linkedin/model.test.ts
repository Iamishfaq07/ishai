import { describe, expect, it } from "vitest";
import type { LinkedInCheck, LinkedInRead, LinkedInState, LinkedInSuggestion, ResumeAiAllowance } from "@orbit/types";
import { aboutPreview, charState, chosenText, copyAll, fixCost, initials, placeholders, profileUrl, progressText, scoreWord, searchPreview, sections, topFixes, wideBars } from "./model";

const c = (id: string, section: LinkedInCheck["section"], ok: boolean, points: number, max: number, more: Partial<LinkedInCheck> = {}): LinkedInCheck =>
  ({ id, section, ok, points, max, title: id, tip: "", ...more });

const profile: LinkedInRead = {
  name: "Asha Rao",
  headline: "Backend Engineer | Go, Kafka, PostgreSQL | Payments and ledger systems at PayNest, Bengaluru",
  location: "Bengaluru, India",
  about: "Backend engineer building payment systems.\n\nAt PayNest I built the payouts service.",
  url: "",
  experience: [
    { title: "Backend Engineer", company: "PayNest", dates: "2021 - Present", current: true, description: "" },
    { title: "Software Engineer", company: "Acme", dates: "2018 - 2020", current: false, description: "" },
  ],
  education: [],
  skills: ["Go", "Kafka"],
  certifications: [],
};

const suggestion = (part: LinkedInSuggestion["part"], more: Partial<LinkedInSuggestion> = {}): LinkedInSuggestion => ({
  id: part, part, role_key: "", label: part, before: "", after: `${part} text`, options: [], choice: 0, items: [], checked: [], limit: 0, shown: 0,
  where: [], help_url: "", note: "", placeholders: 0, source: "profile", ai: true, done: false, created_at: "", applies: true, applied: false, ...more,
});

const allowance = (more: Partial<ResumeAiAllowance>): ResumeAiAllowance => ({ unlimited: false, credits_left: 1, upgrade: null, fixes_left: 0, fixes_per_credit: 5, ...more });

describe("LinkedIn AI model", () => {
  it("adds up sections when an older server sends only checks, unknown ones left out", () => {
    const state = { audit: { score: 50, checks: [c("h1", "headline", true, 4, 4), c("h2", "headline", false, 0, 5), c("p", "photo", false, 0, 2, { known: false })], keywords: [], found: [], missing: [], mismatches: [], posts: 0 } } as unknown as LinkedInState;
    expect(sections(state).map((s) => [s.id, s.points, s.max, s.known])).toEqual([["headline", 4, 9, true], ["photo", 0, 0, false]]);
  });

  it("puts the fixes worth most first, by what they add to the score", () => {
    const checks = [c("a", "about", false, 2, 5, { gain: 2 }), c("s", "skills", false, 0, 9, { gain: 6 }), c("x", "photo", false, 0, 9, { known: false, gain: 9 }), c("h", "headline", false, 0, 5, { gain: 4 })];
    expect(topFixes(checks).map((x) => x.id)).toEqual(["s", "h", "a"]);
  });

  it("lays the section bars out in two columns with no empty cell", () => {
    const bars = (spec: string) => wideBars([...spec].map((ch) => ({ roles: ch === "R" ? [{ index: 0, label: "Role", points: 1, max: 2 }] : [] })));
    const shape = (spec: string) => bars(spec).map((w) => (w ? "W" : ".")).join("");
    // The public page's sample: seven sections, the last one alone on its row.
    expect(shape(".......")).toBe("......W");
    expect(shape("......")).toBe("......");
    // Experience with its roles takes the row; a lone bar before it or at the end takes its row too.
    expect(shape("..R....")).toBe("..W....");
    expect(shape("..R...")).toBe("..W..W");
    expect(shape(".R..")).toBe("WW..");
    expect(shape("R")).toBe("W");
    expect(shape("")).toBe("");
    // Every row is full: a wide bar never starts mid-row, and the last row isn't half empty.
    for (const spec of [".......", "..R...", ".R.R.", "R.R", ".........R."]) {
      let col = 0;
      for (const w of bars(spec)) {
        expect(w && col === 1).toBe(false);
        col = w ? 0 : 1 - col;
      }
      expect(col).toBe(0);
    }
  });

  it("names the score", () => {
    expect(scoreWord(90)).toBe("Strong");
    expect(scoreWord(70)).toBe("Good");
    expect(scoreWord(30)).toBe("Thin");
  });

  it("shows the profile the way a recruiter's search does", () => {
    const p = searchPreview(profile);
    expect(p.initials).toBe("AR");
    expect(p.cut).toBe(true);
    expect(p.headline.length).toBeLessThanOrEqual(60);
    expect(profile.headline.startsWith(p.headline)).toBe(true);
    expect(p.current).toBe("Backend Engineer at PayNest");
    expect(searchPreview({ ...profile, headline: "Backend Engineer" }).cut).toBe(false);
    expect(initials("")).toBe("?");
    const about = aboutPreview("A ".repeat(200));
    expect(about.cut && about.shown.length <= 265).toBe(true);
    expect(aboutPreview(profile.about)).toEqual({ shown: "Backend engineer building payment systems. At PayNest I built the payouts service.", cut: false });
  });

  it("copies the newest headline option, About and skills together", () => {
    const state = {
      profile,
      suggestions: [suggestion("headline", { options: [{ label: "A", text: "First" }, { label: "B", text: "Second" }], choice: 1 }), suggestion("skills", { items: ["Go", "Kafka", "AWS"] })],
    } as unknown as LinkedInState;
    expect(chosenText(state.suggestions![0]!)).toBe("Second");
    expect(copyAll(state)).toBe(`Headline\nSecond\n\nAbout\n${profile.about}\n\nSkills\nGo, Kafka, AWS`);
  });

  it("counts characters against LinkedIn's limit and says what a fix costs first", () => {
    expect(charState(100, 220)).toBe("ok");
    expect(charState(210, 220)).toBe("near");
    expect(charState(221, 220)).toBe("over");
    expect(charState(5000, 0)).toBe("ok");
    expect(fixCost(allowance({}), "headline")).toBe("Uses 1/5 of a resume credit. You have 5 fixes left.");
    expect(fixCost(allowance({ credits_left: 0, fixes_left: 1 }), "about")).toBe("Uses 1/5 of a resume credit. You have 1 fix left.");
    expect(fixCost(allowance({ credits_left: 0 }), "about")).toMatch(/out of resume credits/);
    expect(fixCost(allowance({}), "skills")).toBe("Free: worked out without AI.");
    expect(fixCost(allowance({ credits_left: 2 }), "rewrite")).toBe("Uses 1 resume credit. You have 2.");
    expect(fixCost(allowance({ unlimited: true }), "headline")).toBe("Included in your plan.");
    expect(placeholders("Cut costs by [X%] for [N users]")).toEqual(["[X%]", "[N users]"]);
    expect(progressText(7, 12)).toBe("7 of 12 fixes done on LinkedIn");
    expect(progressText(0, 0)).toBe("");
  });

  it("reads a profile link however it's pasted", () => {
    expect(profileUrl("https://www.linkedin.com/in/asha-rao/")).toBe("https://www.linkedin.com/in/asha-rao/");
    expect(profileUrl("linkedin.com/in/asha-rao")).toBe("https://www.linkedin.com/in/asha-rao/");
    expect(profileUrl("https://in.linkedin.com/in/asha-rao?utm_source=share")).toBe("https://www.linkedin.com/in/asha-rao/");
    expect(profileUrl("https://www.linkedin.com/company/orbit")).toBeNull();
    expect(profileUrl("https://evil.com/linkedin.com/in/x")).toBeNull();
    expect(profileUrl("")).toBeNull();
  });
});
