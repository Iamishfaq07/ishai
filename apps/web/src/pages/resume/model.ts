import type {
  ResumeData,
  ResumeDesign,
  ResumeEducation,
  ResumeExtraSection,
  ResumeFont,
  ResumeInput,
  ResumeLineHeight,
  ResumeSectionId,
  ResumeSectionKey,
  ResumeSpacing,
  ResumeSuggestion,
  ResumeTemplate,
} from "@orbit/types";

export const SECTION_LABEL: Record<ResumeSectionId, string> = {
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  projects: "Projects",
  certifications: "Certifications",
};

export const DEFAULT_ORDER: ResumeSectionId[] = ["summary", "experience", "skills", "projects", "education", "certifications"];

export const MAX_EXTRAS = 5;

export const DECLARATION = "I hereby declare that the information above is true to the best of my knowledge.";

/**
 * Ready-made extra sections: the usual ones, each shown the way it reads best. `note` is advice shown with the
 * section; `fill` is the line it starts with.
 */
export const EXTRA_PRESETS: Array<{ title: string; style: ResumeExtraSection["style"]; placeholder: string; note?: string; fill?: string }> = [
  { title: "Languages", style: "inline", placeholder: "Spanish (fluent)" },
  { title: "Awards", style: "bullets", placeholder: "Engineering Excellence Award, Acme, 2023" },
  { title: "Achievements", style: "bullets", placeholder: "Winner, Smart India Hackathon 2023, out of 120 teams" },
  { title: "Positions of Responsibility", style: "bullets", placeholder: "General Secretary, Coding Club: ran a 300-student hackathon" },
  { title: "Relevant coursework", style: "inline", placeholder: "Data Structures and Algorithms" },
  { title: "Extracurricular activities", style: "bullets", placeholder: "NSS volunteer: taught maths to 30 children every weekend" },
  { title: "Volunteering", style: "bullets", placeholder: "Mentor, Code Club: taught 12 students Python weekly" },
  { title: "Publications", style: "bullets", placeholder: "“Scaling ledgers”, PyCon talk, 2022" },
  { title: "Interests", style: "inline", placeholder: "Trail running" },
  {
    title: "Personal details",
    style: "bullets",
    placeholder: "Date of birth: 14 Aug 2003",
    note: "Date of birth, nationality, languages known. MNC, startup and tech recruiters usually prefer this left out; some government and traditional employers expect it.",
  },
  {
    title: "Declaration",
    style: "inline",
    placeholder: DECLARATION,
    note: "One line, last on the page. Some government and traditional employers expect it; most private ones don't.",
    fill: DECLARATION,
  },
];

/** The extra section a `section_order` entry ("extra:<id>") names. */
export function extraOf(data: ResumeData, key: ResumeSectionKey): ResumeExtraSection | undefined {
  return key.startsWith("extra:") ? data.extras.find((x) => `extra:${x.id}` === key) : undefined;
}

/** A section's heading: the standard name, or the title the user gave an extra section. */
export function sectionLabel(data: ResumeData, key: ResumeSectionKey): string {
  const extra = extraOf(data, key);
  if (extra) return extra.title.trim() || "Untitled section";
  return data.titles?.[key as ResumeSectionId]?.trim() || (SECTION_LABEL[key as ResumeSectionId] ?? key);
}

/** The sections that print, in order: hidden ones stay in the editor only. */
export function shownSections(data: ResumeData): ResumeSectionKey[] {
  const hidden = new Set(data.hidden ?? []);
  return data.section_order.filter((s) => !hidden.has(s));
}

export const TEMPLATES: Array<{ id: ResumeTemplate; label: string; note: string }> = [
  { id: "classic", label: "Classic", note: "Centred header, ruled sections. Reads well everywhere." },
  { id: "modern", label: "Modern", note: "Bold name in your colour, clean sections." },
  { id: "compact", label: "Compact", note: "Tighter spacing to fit more on a page." },
  { id: "elegant", label: "Elegant", note: "Serif name, fine double rules. Classic and calm." },
  { id: "minimal", label: "Minimal", note: "No colour blocks, lots of white space, small grey headings." },
  { id: "bold", label: "Bold", note: "A band of your colour behind the name. Stands out, still one column." },
  { id: "executive", label: "Executive", note: "Name left, headline in your colour, tinted section bars." },
  { id: "campus", label: "Campus", note: "Small-caps headings, tight lines, dates on the right. Fits a fresher's page." },
  { id: "harvard", label: "Harvard", note: "Serif, centred headings, generous space. The classic US style." },
  { id: "sidebar", label: "Sidebar", note: "Two columns. Looks great; some ATS read it out of order." },
];

/** Fonts with serifs: Harvard's name and headings use the chosen one, or a serif next to a sans-serif body. */
export const SERIF_FONTS: ReadonlySet<ResumeFont> = new Set<ResumeFont>(["georgia", "garamond", "cambria", "times"]);

export const FONTS: Array<{ id: ResumeFont; label: string; stack: string }> = [
  { id: "inter", label: "Inter", stack: "'Inter Variable', Inter, Arial, sans-serif" },
  { id: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "garamond", label: "Garamond", stack: "Garamond, 'EB Garamond', 'Times New Roman', serif" },
  { id: "grotesk", label: "Space Grotesk", stack: "'Space Grotesk Variable', 'Inter Variable', Arial, sans-serif" },
  { id: "calibri", label: "Calibri", stack: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif" },
  { id: "cambria", label: "Cambria", stack: "Cambria, Caladea, Georgia, serif" },
  { id: "helvetica", label: "Helvetica", stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { id: "times", label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { id: "trebuchet", label: "Trebuchet", stack: "'Trebuchet MS', 'Segoe UI', Arial, sans-serif" },
];

export const LINE_HEIGHTS: Array<{ id: ResumeLineHeight; label: string; value: number }> = [
  { id: "tight", label: "Tight", value: 1.25 },
  { id: "normal", label: "Normal", value: 1.4 },
  { id: "airy", label: "Airy", value: 1.55 },
];

export const SPACING: Array<{ id: ResumeSpacing; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "normal", label: "Normal" },
  { id: "relaxed", label: "Relaxed" },
];

/** Ready-made combinations of template, colour and font: one click, then fine-tune. */
export const LOOKS: Array<{ label: string; design: Pick<ResumeDesign, "template" | "accent" | "font"> }> = [
  { label: "Corporate", design: { template: "executive", accent: "#1d4ed8", font: "cambria" } },
  { label: "Tech", design: { template: "modern", accent: "#4f46e5", font: "inter" } },
  { label: "Creative", design: { template: "bold", accent: "#be185d", font: "grotesk" } },
  { label: "Academic", design: { template: "elegant", accent: "#7c2d12", font: "garamond" } },
  { label: "Simple", design: { template: "minimal", accent: "#334155", font: "helvetica" } },
  { label: "Finance", design: { template: "classic", accent: "#0f766e", font: "georgia" } },
  { label: "Campus", design: { template: "campus", accent: "#111827", font: "cambria" } },
  { label: "Harvard", design: { template: "harvard", accent: "#111827", font: "times" } },
];

export const ACCENTS = [
  "#4f46e5", "#0f766e", "#1d4ed8", "#b91c1c", "#9333ea", "#c2410c", "#334155", "#111827",
  "#0369a1", "#15803d", "#a16207", "#be185d", "#7c2d12", "#4338ca",
];

export function newId(): string {
  return Math.random().toString(16).slice(2, 14).padEnd(12, "0");
}

export function emptyData(): ResumeData {
  return {
    basics: { name: "", headline: "", email: "", phone: "", location: "", links: [], summary: "" },
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    extras: [],
    section_order: [...DEFAULT_ORDER],
  };
}

export function defaultDesign(): ResumeDesign {
  return {
    template: "classic",
    accent: ACCENTS[0]!,
    font: "inter",
    font_size: 10.5,
    spacing: "normal",
    page: "a4",
    photo: null,
    show_photo: false,
  };
}

export function newResume(title = "My resume", data: ResumeData = emptyData()): ResumeInput {
  return { title, data, design: defaultDesign(), job_text: "" };
}

/**
 * "Student / fresher": a one-page Campus resume laid out for placements. Education leads, then projects, skills,
 * internships, positions of responsibility and achievements, the last two ready to fill in.
 */
export function fresherResume(makeId: () => string = newId): ResumeInput {
  const roles = makeId();
  const wins = makeId();
  const data: ResumeData = {
    ...emptyData(),
    education: [{ id: makeId(), school: "", degree: "", field: "", start: "", end: "", grade: "", details: "" }],
    projects: [{ id: makeId(), name: "", link: "", description: "", bullets: [""] }],
    extras: [
      { id: roles, title: "Positions of Responsibility", items: [""], style: "bullets" },
      { id: wins, title: "Achievements", items: [""], style: "bullets" },
    ],
    // An empty summary doesn't print, so Education leads; a summary written later goes on top, where recruiters look.
    section_order: ["summary", "education", "projects", "skills", "experience", `extra:${roles}`, `extra:${wins}`, "certifications"],
  };
  return { title: "My resume", data, design: { ...defaultDesign(), template: "campus", accent: "#111827", font: "cambria" }, job_text: "" };
}

/**
 * Suggestion and ATS paths: "basics.summary", "experience.<id>.bullets.<i>", "projects.<id>.description". List items
 * are addressed by id, so a path stays right when items are reordered.
 */
export function getAt(data: ResumeData, path: string): string | undefined {
  const [section, a, b, c] = path.split(".");
  if (section === "basics") {
    const v = (data.basics as unknown as Record<string, unknown>)[a ?? ""];
    return typeof v === "string" ? v : undefined;
  }
  if (section === "experience" || section === "projects") {
    const item = (data[section] as Array<{ id: string; bullets: string[]; description?: string }>).find((x) => x.id === a);
    if (!item) return undefined;
    if (b === "bullets") return item.bullets[Number(c)];
    if (b === "description") return item.description;
  }
  if (section === "experience" && (b === "start" || b === "end")) return data.experience.find((x) => x.id === a)?.[b];
  return undefined;
}

/** A copy of `data` with the text at `path` replaced (unknown paths leave it unchanged). */
export function setAt(data: ResumeData, path: string, value: string): ResumeData {
  const [section, a, b, c] = path.split(".");
  if (section === "basics" && a) return { ...data, basics: { ...data.basics, [a]: value } };
  if (section === "experience") {
    return {
      ...data,
      experience: data.experience.map((e) =>
        e.id !== a
          ? e
          : b === "start" || b === "end"
            ? { ...e, [b]: value }
            : b === "bullets"
              ? { ...e, bullets: e.bullets.map((t, i) => (i === Number(c) ? value : t)) }
              : e,
      ),
    };
  }
  if (section === "projects") {
    return {
      ...data,
      projects: data.projects.map((p) =>
        p.id !== a
          ? p
          : b === "description"
            ? { ...p, description: value }
            : { ...p, bullets: p.bullets.map((t, i) => (i === Number(c) ? value : t)) },
      ),
    };
  }
  return data;
}

export const MAX_SKILLS_PER_GROUP = 40;
/** The server's limit (resumes/schema.py): an 11th group used to fail every save and AI request with a 422. */
export const MAX_SKILL_GROUPS = 10;
const MAX_BULLETS = 12;

/** The skills a suggestion adds, trimmed and without repeats. */
export function suggestedSkills(s: ResumeSuggestion): string[] {
  const seen = new Set<string>();
  return s.after
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
}

/** Add skills to the Skills section without repeating any it has: into a group called "Skills" or the only group,
 *  else a new "Additional skills" group, so Kafka never lands under "Languages". With no room for another group, into
 *  the groups that have room (as the server does, resumes/apply.py). */
export function addSkills(data: ResumeData, skills: string[], makeId: () => string): ResumeData {
  const have = new Set(data.skills.flatMap((g) => g.items.map((i) => i.trim().toLowerCase())));
  const fresh = skills.filter((x) => !have.has(x.toLowerCase()));
  if (!fresh.length) return data;
  const home = data.skills.find((g) => g.name.trim().toLowerCase() === "skills") ?? (data.skills.length === 1 ? data.skills[0] : undefined);
  if (home && home.items.length + fresh.length <= MAX_SKILLS_PER_GROUP) {
    return { ...data, skills: data.skills.map((g) => (g === home ? { ...g, items: [...g.items, ...fresh] } : g)) };
  }
  const name = data.skills.length ? "Additional skills" : "Skills";
  const extra = data.skills.find((g) => g.name === name && g.items.length + fresh.length <= MAX_SKILLS_PER_GROUP);
  if (extra) return { ...data, skills: data.skills.map((g) => (g === extra ? { ...g, items: [...g.items, ...fresh] } : g)) };
  if (data.skills.length < MAX_SKILL_GROUPS) {
    return { ...data, skills: [...data.skills, { id: makeId(), name, items: fresh.slice(0, MAX_SKILLS_PER_GROUP) }] };
  }
  const groups = data.skills.map((g) => ({ ...g, items: [...g.items] }));
  for (const skill of fresh) {
    const roomiest = groups.reduce((a, b) => (b.items.length < a.items.length ? b : a));
    if (roomiest.items.length >= MAX_SKILLS_PER_GROUP) break;
    roomiest.items.push(skill);
  }
  return { ...data, skills: groups };
}

/** Whether a suggestion still fits the resume: the text it replaces hasn't been edited since. */
export function canApply(data: ResumeData, s: ResumeSuggestion): boolean {
  if (s.kind === "add_skill") return true;
  if (s.kind === "add_bullet") return data.experience.some((e) => e.id === s.path.split(".")[1] && e.bullets.length < MAX_BULLETS);
  return getAt(data, s.path) === s.before;
}

/** `data` with the suggestion applied (unchanged if it no longer fits). */
export function applySuggestion(data: ResumeData, s: ResumeSuggestion, makeId: () => string): ResumeData {
  if (!canApply(data, s)) return data;
  if (s.kind === "add_skill") return addSkills(data, suggestedSkills(s), makeId);
  if (s.kind === "add_bullet") {
    const id = s.path.split(".")[1];
    return {
      ...data,
      experience: data.experience.map((e) => (e.id !== id || e.bullets.includes(s.after) ? e : { ...e, bullets: [...e.bullets.filter((b) => b.trim()), s.after] })),
    };
  }
  return setAt(data, s.path, s.after);
}

/** A change that's still in the resume as it was made: a line still reading what it was set to, or an added bullet
 *  still there. Skills added aren't tracked one by one (Undo takes them back). */
export function isStillApplied(data: ResumeData, s: ResumeSuggestion): boolean {
  if (s.kind === "add_bullet") return data.experience.some((e) => e.id === s.path.split(".")[1] && e.bullets.includes(s.after));
  if (s.kind === "add_skill") return false;
  return getAt(data, s.path) === s.after && s.after !== s.before;
}

/** `data` with one change taken back, if it's still there (see isStillApplied): the line reads as it did, or the
 *  added bullet goes. Anything edited since is left alone. */
export function revertSuggestion(data: ResumeData, s: ResumeSuggestion): ResumeData {
  if (!isStillApplied(data, s)) return data;
  if (s.kind === "add_bullet") {
    const id = s.path.split(".")[1];
    return { ...data, experience: data.experience.map((e) => (e.id !== id ? e : { ...e, bullets: e.bullets.filter((b) => b !== s.after) })) };
  }
  return setAt(data, s.path, s.before ?? "");
}

/** Safe to apply in bulk: mechanical, and nothing the candidate needs to confirm or fill in. */
export function isSafeFix(s: ResumeSuggestion): boolean {
  return (s.kind === "add_skill" || s.kind === "set") && !s.confirm && !/\[[^\]]+\]/.test(s.after);
}

export function dateRange(start: string, end: string, current = false): string {
  const to = current ? "Present" : end.trim();
  return [start.trim(), to].filter(Boolean).join(" – ");
}

/** The line under a degree: its grade, then the details ("8.6 / 10 CGPA · Dean's list"). */
export function gradeLine(e: Pick<ResumeEducation, "grade" | "details">): string {
  return [e.grade?.trim(), e.details.trim()].filter(Boolean).join(" · ");
}

/** The resume as plain text: what "Save to Documents" gives live sessions to answer from. */
export function resumeToText(data: ResumeData): string {
  const b = data.basics;
  const out: string[] = [b.name, b.headline, [b.email, b.phone, b.location, ...b.links.map((l) => l.url)].filter(Boolean).join(" | ")];
  for (const section of shownSections(data)) {
    if (section === "summary" && b.summary.trim()) out.push("", "SUMMARY", b.summary);
    if (section === "experience" && data.experience.length) {
      out.push("", "EXPERIENCE");
      for (const e of data.experience) {
        out.push(`${[e.title, e.company].filter(Boolean).join(", ")}${e.location ? ` — ${e.location}` : ""} (${dateRange(e.start, e.end, e.current)})`);
        out.push(...e.bullets.filter((t) => t.trim()).map((t) => `- ${t}`));
      }
    }
    if (section === "skills" && data.skills.length) {
      out.push("", "SKILLS", ...data.skills.map((s) => `${s.name ? `${s.name}: ` : ""}${s.items.join(", ")}`));
    }
    if (section === "projects" && data.projects.length) {
      out.push("", "PROJECTS");
      for (const p of data.projects) {
        out.push(`${p.name}${p.link ? ` (${p.link})` : ""}`, p.description, ...p.bullets.filter((t) => t.trim()).map((t) => `- ${t}`));
      }
    }
    if (section === "education" && data.education.length) {
      out.push("", "EDUCATION");
      for (const e of data.education) {
        out.push(`${[e.degree, e.field].filter(Boolean).join(", ")} — ${e.school} (${dateRange(e.start, e.end)})`, gradeLine(e));
      }
    }
    if (section === "certifications" && data.certifications.length) {
      out.push("", "CERTIFICATIONS", ...data.certifications.map((c) => [c.name, c.issuer, c.date].filter(Boolean).join(", ")));
    }
    const extra = extraOf(data, section);
    const items = extra?.items.filter((t) => t.trim()) ?? [];
    if (extra && extra.title.trim() && items.length) {
      out.push("", extra.title.trim().toUpperCase(), ...(extra.style === "inline" ? [items.join(" · ")] : items.map((t) => `- ${t}`)));
    }
  }
  return out.filter((line, i, all) => line.trim() || (i > 0 && all[i - 1]?.trim())).join("\n").trim();
}

/** Shrink a photo to a 256 px square JPEG data URL (small enough to store with the resume). */
export async function photoToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That image couldn't be read. Try a JPEG or PNG."));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser couldn't process the image.");
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 256, 256);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    URL.revokeObjectURL(url);
  }
}
