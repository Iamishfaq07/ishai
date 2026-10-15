import type { ResumeData } from "@orbit/types";
import { sectionLabel, shownSections } from "./model";

/**
 * "How an ATS reads it": what a parser gets from the resume, from its plain text in the order the page gives it
 * (a two-column page hands over its sidebar first) and from the headings and dates it uses. Each finding says what a
 * parser would trip on, not a score: the ATS score covers the rest.
 */

export type Reading = {
  /** The text in reading order, as a parser gets it. */
  text: string;
  found: { email: boolean; phone: boolean; links: number };
  /** Each printed section's heading, and whether parsers know it by that name. */
  headings: Array<{ heading: string; recognized: boolean }>;
  /** Roles whose dates a parser can't read as dates. */
  unreadableDates: string[];
  /** The first line isn't the name: a parser takes the first line as the candidate's name. */
  nameFirst: boolean;
  /** Characters parsers drop or garble: emoji, icon glyphs, decorative symbols. */
  oddCharacters: string[];
};

// Section names ATS parsers map to their fields.
const KNOWN = /^(?:(?:professional|work|relevant|career)\s+)?(?:experience|employment(?:\s+history)?|work\s+history|history)$|^(?:education|academics?|academic\s+background|qualifications)$|^(?:(?:technical|key|core)\s+)?(?:skills|competencies|expertise)$|^(?:(?:professional\s+)?summary|profile|about(?:\s+me)?|objective|career\s+objective)$|^(?:(?:academic|personal|key)\s+)?projects$|^(?:certifications?|licen[cs]es(?:\s+(?:and|&)\s+certifications)?|courses|training)$|^(?:awards?|honou?rs|achievements|accomplishments)$|^(?:languages|volunteering|volunteer\s+(?:work|experience)|publications|interests|hobbies|activities|extracurricular\s+activities|positions\s+of\s+responsibility|leadership|references|declaration)$/i;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const LINK = /\b(?:https?:\/\/|www\.|linkedin\.com\/|github\.com\/)\S+/gi;
// Month name + year, MM/YYYY or YYYY, "Present"/"Current": what parsers read as a date.
const DATE = /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{1,2}[/.-]\d{4}|\d{4}(?:-\d{2})?|present|current|now|till\s+date)$/i;
// Emoji, dingbats, arrows, box drawing, private-use icon fonts.
const ODD = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2500}-\u{25FF}\u{E000}-\u{F8FF}★☆✓✔✗✘➤➔►▶•◦▪]/gu;

/** A section prints only with something in it. */
function hasContent(data: ResumeData, key: string): boolean {
  switch (key) {
    case "summary":
      return Boolean(data.basics.summary.trim());
    case "experience":
      return data.experience.some((e) => e.title.trim() || e.company.trim());
    case "education":
      return data.education.some((e) => e.school.trim() || e.degree.trim());
    case "skills":
      return data.skills.some((g) => g.items.some((i) => i.trim()));
    case "projects":
      return data.projects.some((p) => p.name.trim());
    case "certifications":
      return data.certifications.some((c) => c.name.trim());
    default:
      return data.extras.some((x) => `extra:${x.id}` === key && x.items.some((i) => i.trim()));
  }
}

export function readableDate(value: string): boolean {
  const v = value.trim();
  return !v || DATE.test(v);
}

export function atsReading(text: string, data: ResumeData): Reading {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const name = data.basics.name.trim().toLowerCase();
  const headings = shownSections(data)
    .filter((key) => hasContent(data, key))
    .map((key) => {
      const heading = sectionLabel(data, key).trim();
      return { heading, recognized: KNOWN.test(heading) };
    });
  const odd = [...new Set((text.replace(/^[ \t]*•/gm, "").match(ODD) ?? []).filter((c) => c !== "•"))];
  return {
    text: lines.join("\n"),
    found: { email: EMAIL.test(text), phone: PHONE.test(text), links: (text.match(LINK) ?? []).length },
    headings,
    unreadableDates: data.experience
      .filter((e) => (e.title.trim() || e.company.trim()) && !(readableDate(e.start) && (e.current || readableDate(e.end))))
      .map((e) => [e.title, e.company].filter(Boolean).join(" at ")),
    nameFirst: !name || (lines[0] ?? "").toLowerCase().includes(name),
    oddCharacters: odd.slice(0, 8),
  };
}
