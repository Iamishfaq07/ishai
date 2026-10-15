import type { ResumeData, ResumeExtraSection, ResumeSectionKey } from "@orbit/types";
import { emptyData, newId } from "./model";

/**
 * JSON Resume (jsonresume.org), the open standard many resume tools read and write: export a resume to it, and
 * import one from it, free and exact (no AI). What the standard has no place for (Orbit's own sections, their order
 * and headings) rides along under `meta.orbit`, so a file exported here comes back unchanged; other tools ignore it.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jan 2021" / "January 2021" / "01/2021" / "2021" → "2021-01" / "2021"; anything else is kept as written. */
export function toIsoDate(value: string): string {
  const v = value.trim();
  if (!v) return "";
  let m = v.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i);
  if (m) {
    const i = MONTHS.indexOf(m[1]!.toLowerCase());
    if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, "0")}`;
  }
  m = v.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m && +m[1]! >= 1 && +m[1]! <= 12) return `${m[2]}-${m[1]!.padStart(2, "0")}`;
  if (/^\d{4}(-\d{2}(-\d{2})?)?$/.test(v)) return v;
  return v;
}

/** "2021-01" / "2021-01-15" → "Jan 2021"; "2021" stays; anything else is kept as written. */
export function fromIsoDate(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  const m = v.match(/^(\d{4})-(\d{2})(?:-\d{2})?/);
  if (m && +m[2]! >= 1 && +m[2]! <= 12) return `${MONTH_NAMES[+m[2]! - 1]} ${m[1]}`;
  return v;
}

const isLanguages = (t: string) => /\blanguages?\b/i.test(t);
const isAwards = (t: string) => /\b(awards?|achievements?|honou?rs?)\b/i.test(t);
const isVolunteering = (t: string) => /\bvolunteer/i.test(t);
const isInterests = (t: string) => /\b(interests?|hobbies)\b/i.test(t);

/** The resume as a JSON Resume document. */
export function toJsonResume(data: ResumeData): Record<string, unknown> {
  const b = data.basics;
  const extras = (pick: (t: string) => boolean) => data.extras.filter((x) => pick(x.title)).flatMap((x) => x.items.filter((i) => i.trim()));
  const drop = <T extends Record<string, unknown>>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v !== undefined && !(Array.isArray(v) && !v.length))) as T;
  return {
    $schema: "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json",
    basics: drop({
      name: b.name,
      label: b.headline,
      email: b.email,
      phone: b.phone,
      summary: b.summary,
      location: b.location ? { address: b.location } : undefined,
      profiles: b.links.filter((l) => l.url.trim()).map((l) => drop({ network: l.label, url: l.url })),
    }),
    work: data.experience.map((e) =>
      drop({
        name: e.company,
        position: e.title,
        location: e.location,
        startDate: toIsoDate(e.start),
        endDate: e.current ? undefined : toIsoDate(e.end),
        highlights: e.bullets.filter((x) => x.trim()),
      }),
    ),
    education: data.education.map((e) =>
      drop({
        institution: e.school,
        studyType: e.degree,
        area: e.field,
        startDate: toIsoDate(e.start),
        endDate: toIsoDate(e.end),
        score: e.grade ?? "",
        courses: e.details.trim() ? [e.details.trim()] : [],
      }),
    ),
    skills: data.skills.map((s) => drop({ name: s.name, keywords: s.items.filter((x) => x.trim()) })),
    projects: data.projects.map((p) =>
      drop({ name: p.name, description: p.description, url: p.link, highlights: p.bullets.filter((x) => x.trim()) }),
    ),
    certificates: data.certifications.map((c) => drop({ name: c.name, issuer: c.issuer, date: toIsoDate(c.date) })),
    languages: extras(isLanguages).map((language) => ({ language })),
    awards: extras(isAwards).map((title) => ({ title })),
    volunteer: extras(isVolunteering).map((summary) => ({ summary })),
    interests: extras(isInterests).map((name) => ({ name })),
    meta: {
      // Orbit's own: its extra sections as they are, their order, hidden ones and headings. Read back on import here.
      orbit: { version: 1, extras: data.extras, section_order: data.section_order, hidden: data.hidden ?? [], titles: data.titles ?? {} },
    },
  };
}

const str = (v: unknown, max = 2000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x)) : [];
const strings = (v: unknown, max = 400): string[] => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean) : []);

/** A JSON Resume document (from Orbit or any other tool) as a resume; throws on something that isn't one. */
export function fromJsonResume(doc: unknown): { title: string; data: ResumeData } {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) throw new Error("not a JSON Resume file");
  const d = doc as Record<string, unknown>;
  const basics = (typeof d.basics === "object" && d.basics) ? (d.basics as Record<string, unknown>) : {};
  if (!d.basics && !d.work && !d.education && !d.skills) throw new Error("not a JSON Resume file");
  const location = basics.location as Record<string, unknown> | undefined;
  const data = emptyData();
  data.basics = {
    name: str(basics.name, 120),
    headline: str(basics.label, 160),
    email: str(basics.email, 160),
    phone: str(basics.phone, 60),
    location: location ? [str(location.address), str(location.city), str(location.region), str(location.countryCode)].filter(Boolean).join(", ").slice(0, 160) : "",
    links: [
      ...(str(basics.url) ? [{ label: "Website", url: str(basics.url, 300) }] : []),
      ...arr(basics.profiles).map((p) => ({ label: str(p.network, 60) || "Profile", url: str(p.url, 300) })).filter((l) => l.url),
    ].slice(0, 6),
    summary: str(basics.summary, 1500),
  };
  data.experience = arr(d.work ?? d.volunteerWork).slice(0, 20).map((w) => ({
    id: newId(),
    title: str(w.position, 120),
    company: str(w.name ?? w.company, 120),
    location: str(w.location, 120),
    start: fromIsoDate(w.startDate),
    end: fromIsoDate(w.endDate),
    current: !str(w.endDate),
    bullets: [...(str(w.summary) ? [str(w.summary, 400)] : []), ...strings(w.highlights)].slice(0, 12),
  }));
  data.education = arr(d.education).slice(0, 10).map((e) => ({
    id: newId(),
    school: str(e.institution, 160),
    degree: str(e.studyType, 120),
    field: str(e.area, 120),
    start: fromIsoDate(e.startDate),
    end: fromIsoDate(e.endDate),
    details: strings(e.courses).join(" · ").slice(0, 400),
    grade: str(e.score, 60),
  }));
  data.skills = arr(d.skills).slice(0, 12).map((s) => ({ id: newId(), name: str(s.name, 80), items: strings(s.keywords, 80).slice(0, 40) }));
  data.projects = arr(d.projects).slice(0, 10).map((p) => ({
    id: newId(),
    name: str(p.name, 120),
    link: str(p.url, 300),
    description: str(p.description, 600),
    bullets: strings(p.highlights).slice(0, 8),
  }));
  data.certifications = arr(d.certificates).slice(0, 20).map((c) => ({ id: newId(), name: str(c.name, 160), issuer: str(c.issuer, 120), date: fromIsoDate(c.date) }));

  const orbit = ((d.meta as Record<string, unknown> | undefined)?.orbit ?? null) as Record<string, unknown> | null;
  if (orbit && Array.isArray(orbit.extras)) {
    // Exported by Orbit: its own sections come back exactly, in their order.
    data.extras = arr(orbit.extras).slice(0, 8).map((x) => ({
      id: str(x.id, 40) || newId(),
      title: str(x.title, 60),
      items: strings(x.items).slice(0, 30),
      style: x.style === "inline" ? "inline" : "bullets",
    }));
    const order = strings(orbit.section_order, 60) as ResumeSectionKey[];
    if (order.length) data.section_order = order;
    data.hidden = strings(orbit.hidden, 60) as ResumeSectionKey[];
    if (orbit.titles && typeof orbit.titles === "object") data.titles = orbit.titles as ResumeData["titles"];
  } else {
    const extra = (title: string, items: string[], style: ResumeExtraSection["style"]): void => {
      if (!items.length) return;
      const x = { id: newId(), title, items: items.slice(0, 30), style };
      data.extras.push(x);
      data.section_order.push(`extra:${x.id}`);
    };
    extra("Languages", arr(d.languages).map((l) => [str(l.language, 60), str(l.fluency, 40)].filter(Boolean).join(" (") + (str(l.fluency) ? ")" : "")).filter(Boolean), "inline");
    extra("Awards", arr(d.awards).map((a) => [str(a.title, 160), str(a.awarder, 120), fromIsoDate(a.date)].filter(Boolean).join(", ")).filter(Boolean), "bullets");
    extra("Volunteering", arr(d.volunteer).map((v) => [str(v.position, 120), str(v.organization, 120), str(v.summary, 300)].filter(Boolean).join(", ")).filter(Boolean), "bullets");
    extra("Interests", arr(d.interests).map((i) => str(i.name, 80)).filter(Boolean), "inline");
  }
  const title = data.basics.name ? `${data.basics.name}'s resume` : "Imported resume";
  return { title, data };
}
