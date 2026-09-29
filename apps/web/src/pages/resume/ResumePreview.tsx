import type { CSSProperties, ReactNode } from "react";
import type { ResumeData, ResumeDesign, ResumeSectionId } from "@orbit/types";
import { FONTS, SECTION_LABEL, dateRange } from "./model";

const SPACE = {
  compact: { section: "9pt", item: "5pt", pad: "12mm" },
  normal: { section: "13pt", item: "7pt", pad: "16mm" },
  relaxed: { section: "17pt", item: "10pt", pad: "20mm" },
} as const;

export const PAGE_MM = { a4: { w: 210, h: 297 }, letter: { w: 215.9, h: 279.4 } } as const;

/** Mix the accent with white: `tint(accent, 0.9)` is a pale background in the same hue. */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

function contactItems(data: ResumeData): string[] {
  const b = data.basics;
  return [b.email, b.phone, b.location, ...b.links.map((l) => l.url)].map((s) => s.trim()).filter(Boolean);
}

function hasContent(data: ResumeData, id: ResumeSectionId): boolean {
  if (id === "summary") return Boolean(data.basics.summary.trim());
  if (id === "skills") return data.skills.some((s) => s.items.some((i) => i.trim()));
  return data[id].length > 0;
}

/**
 * One resume page (or more, when it runs long), drawn at real size in mm. Always dark text on white paper, whatever
 * the app theme, because it's what gets printed to PDF. Headings use the standard section names ATS software
 * looks for.
 */
export function ResumePreview({ data, design }: { data: ResumeData; design: ResumeDesign }) {
  const space = SPACE[design.spacing];
  const font = FONTS.find((f) => f.id === design.font)?.stack ?? FONTS[0]!.stack;
  const page = PAGE_MM[design.page];
  const accent = design.accent;
  const t = design.template;
  const photo = design.show_photo && design.photo ? design.photo : null;
  const sidebar = t === "sidebar";

  const style: CSSProperties = {
    width: `${page.w}mm`,
    minHeight: `${page.h}mm`,
    fontFamily: font,
    fontSize: `${design.font_size}pt`,
    lineHeight: t === "compact" ? 1.3 : 1.4,
    padding: sidebar ? 0 : space.pad,
    color: "#18181b",
    background: "#ffffff",
  };

  const heading = (label: string): ReactNode => {
    if (t === "modern") {
      return (
        <h2 style={{ color: accent, fontSize: "1.05em", marginBottom: space.item }} className="flex items-center gap-2 font-bold uppercase tracking-wide">
          <span style={{ background: accent }} className="inline-block h-[1.1em] w-[3px] rounded" />
          {label}
        </h2>
      );
    }
    if (t === "compact") {
      return (
        <h2 style={{ color: accent, fontSize: "0.95em", marginBottom: "3pt" }} className="font-bold uppercase tracking-wider">
          {label}
        </h2>
      );
    }
    return (
      <h2
        style={{ color: accent, borderColor: accent, fontSize: "1em", marginBottom: space.item, paddingBottom: "2pt" }}
        className="border-b font-bold uppercase tracking-wider"
      >
        {label}
      </h2>
    );
  };

  const bullets = (items: string[]) => {
    const list = items.filter((b) => b.trim());
    return list.length ? (
      <ul className="mt-[2pt] list-disc space-y-[1.5pt] pl-[1.2em]">
        {list.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    ) : null;
  };

  const section = (id: ResumeSectionId): ReactNode => {
    if (!hasContent(data, id)) return null;
    let body: ReactNode = null;
    if (id === "summary") body = <p>{data.basics.summary}</p>;
    if (id === "experience") {
      body = data.experience.map((e) => (
        <div key={e.id} style={{ marginBottom: space.item }} className="break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p>
              <span className="font-bold">{e.title}</span>
              {e.company && <span>{e.title ? ", " : ""}{e.company}</span>}
              {e.location && <span className="text-zinc-600"> · {e.location}</span>}
            </p>
            <p className="whitespace-nowrap text-zinc-600">{dateRange(e.start, e.end, e.current)}</p>
          </div>
          {bullets(e.bullets)}
        </div>
      ));
    }
    if (id === "education") {
      body = data.education.map((e) => (
        <div key={e.id} style={{ marginBottom: space.item }} className="break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p>
              <span className="font-bold">{[e.degree, e.field].filter(Boolean).join(", ") || e.school}</span>
              {(e.degree || e.field) && e.school && <span>, {e.school}</span>}
            </p>
            <p className="whitespace-nowrap text-zinc-600">{dateRange(e.start, e.end)}</p>
          </div>
          {e.details && <p className="text-zinc-700">{e.details}</p>}
        </div>
      ));
    }
    if (id === "skills") {
      body = (
        <div className="space-y-[2pt]">
          {data.skills
            .filter((s) => s.items.some((i) => i.trim()))
            .map((s) => (
              <p key={s.id}>
                {s.name && <span className="font-bold">{s.name}: </span>}
                {s.items.filter((i) => i.trim()).join(", ")}
              </p>
            ))}
        </div>
      );
    }
    if (id === "projects") {
      body = data.projects.map((p) => (
        <div key={p.id} style={{ marginBottom: space.item }} className="break-inside-avoid">
          <p>
            <span className="font-bold">{p.name}</span>
            {p.link && <span className="text-zinc-600"> · {p.link}</span>}
          </p>
          {p.description && <p>{p.description}</p>}
          {bullets(p.bullets)}
        </div>
      ));
    }
    if (id === "certifications") {
      body = data.certifications.map((c) => (
        <p key={c.id}>
          <span className="font-bold">{c.name}</span>
          {[c.issuer, c.date].filter(Boolean).length > 0 && <span className="text-zinc-600"> · {[c.issuer, c.date].filter(Boolean).join(", ")}</span>}
        </p>
      ));
    }
    return (
      <section key={id} style={{ marginTop: space.section }}>
        {heading(SECTION_LABEL[id])}
        {body}
      </section>
    );
  };

  const photoEl = (size: string, round = true) =>
    photo ? <img src={photo} alt="" style={{ width: size, height: size }} className={round ? "rounded-full object-cover" : "rounded object-cover"} /> : null;

  const name = data.basics.name || "Your name";
  const contacts = contactItems(data);

  if (sidebar) {
    const side: ResumeSectionId[] = ["skills", "education", "certifications"];
    const main = data.section_order.filter((s) => !side.includes(s));
    return (
      <div style={style} className="resume-page flex">
        <aside style={{ background: tint(accent, 0.9), padding: space.pad, width: "34%" }} className="shrink-0">
          {photo && <div className="mb-[10pt]">{photoEl("30mm")}</div>}
          <h1 style={{ color: accent, fontSize: "1.9em", lineHeight: 1.1 }} className="font-bold">
            {name}
          </h1>
          {data.basics.headline && <p className="mt-[3pt] font-medium">{data.basics.headline}</p>}
          <div className="mt-[8pt] space-y-[2pt] break-words text-[0.92em]">
            {contacts.map((c) => (
              <p key={c}>{c}</p>
            ))}
          </div>
          {data.section_order.filter((s) => side.includes(s)).map(section)}
        </aside>
        <main style={{ padding: space.pad, paddingLeft: "7mm" }} className="min-w-0 flex-1">
          {main.map(section)}
        </main>
      </div>
    );
  }

  const header =
    t === "classic" ? (
      <header className="relative text-center">
        {photo && <div className="absolute right-0 top-0">{photoEl("22mm")}</div>}
        <h1 style={{ fontSize: "2em", lineHeight: 1.15 }} className="font-bold tracking-tight">
          {name}
        </h1>
        {data.basics.headline && <p style={{ color: accent }} className="mt-[2pt] font-medium">{data.basics.headline}</p>}
        <p className="mt-[4pt] text-zinc-600">{contacts.join("  ·  ")}</p>
      </header>
    ) : t === "modern" ? (
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 style={{ color: accent, fontSize: "2.2em", lineHeight: 1.05 }} className="font-extrabold tracking-tight">
            {name}
          </h1>
          {data.basics.headline && <p className="mt-[3pt] text-[1.1em] font-medium">{data.basics.headline}</p>}
          <p className="mt-[5pt] text-zinc-600">{contacts.join("  |  ")}</p>
        </div>
        {photoEl("24mm")}
      </header>
    ) : (
      <header className="flex items-end justify-between gap-3 border-b pb-[4pt]" style={{ borderColor: accent }}>
        <div className="min-w-0">
          <h1 style={{ fontSize: "1.6em", lineHeight: 1.1 }} className="font-bold">
            {name}
            {data.basics.headline && <span className="font-normal text-zinc-600"> — {data.basics.headline}</span>}
          </h1>
          <p className="text-zinc-600">{contacts.join(" · ")}</p>
        </div>
        {photoEl("16mm")}
      </header>
    );

  return (
    <div style={style} className="resume-page">
      {header}
      {data.section_order.map(section)}
    </div>
  );
}
