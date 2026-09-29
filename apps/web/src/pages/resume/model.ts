import type {
  ResumeData,
  ResumeDesign,
  ResumeFont,
  ResumeInput,
  ResumeSectionId,
  ResumeSpacing,
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

export const TEMPLATES: Array<{ id: ResumeTemplate; label: string; note: string }> = [
  { id: "classic", label: "Classic", note: "Centred header, ruled sections. Reads well everywhere." },
  { id: "modern", label: "Modern", note: "Bold name in your colour, clean sections." },
  { id: "compact", label: "Compact", note: "Tighter spacing to fit more on a page." },
  { id: "sidebar", label: "Sidebar", note: "Two columns. Looks great; some ATS read it out of order." },
];

export const FONTS: Array<{ id: ResumeFont; label: string; stack: string }> = [
  { id: "inter", label: "Inter", stack: "'Inter Variable', Inter, Arial, sans-serif" },
  { id: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { id: "garamond", label: "Garamond", stack: "Garamond, 'EB Garamond', 'Times New Roman', serif" },
  { id: "grotesk", label: "Space Grotesk", stack: "'Space Grotesk Variable', 'Inter Variable', Arial, sans-serif" },
];

export const SPACING: Array<{ id: ResumeSpacing; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "normal", label: "Normal" },
  { id: "relaxed", label: "Relaxed" },
];

export const ACCENTS = ["#4f46e5", "#0f766e", "#1d4ed8", "#b91c1c", "#9333ea", "#c2410c", "#334155", "#111827"];

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
        e.id !== a || b !== "bullets" ? e : { ...e, bullets: e.bullets.map((t, i) => (i === Number(c) ? value : t)) },
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

export function dateRange(start: string, end: string, current = false): string {
  const to = current ? "Present" : end.trim();
  return [start.trim(), to].filter(Boolean).join(" – ");
}

/** The resume as plain text: what "Save to Documents" gives live sessions to answer from. */
export function resumeToText(data: ResumeData): string {
  const b = data.basics;
  const out: string[] = [b.name, b.headline, [b.email, b.phone, b.location, ...b.links.map((l) => l.url)].filter(Boolean).join(" | ")];
  for (const section of data.section_order) {
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
        out.push(`${[e.degree, e.field].filter(Boolean).join(", ")} — ${e.school} (${dateRange(e.start, e.end)})`, e.details);
      }
    }
    if (section === "certifications" && data.certifications.length) {
      out.push("", "CERTIFICATIONS", ...data.certifications.map((c) => [c.name, c.issuer, c.date].filter(Boolean).join(", ")));
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
