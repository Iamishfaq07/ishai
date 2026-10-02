import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { ResumeData, ResumeDesign, ResumeSectionKey } from "@orbit/types";
import { FONTS, dateRange, extraOf, sectionLabel } from "./model";

const SPACE = {
  compact: { section: "9pt", item: "5pt", pad: "12mm" },
  normal: { section: "13pt", item: "7pt", pad: "16mm" },
  relaxed: { section: "17pt", item: "10pt", pad: "20mm" },
} as const;

export const PAGE_MM = { a4: { w: 210, h: 297 }, letter: { w: 215.9, h: 279.4 } } as const;
export const MM_TO_PX = 96 / 25.4;
const PAD_MM = { compact: 12, normal: 16, relaxed: 20 } as const;

/**
 * Where the printed pages break, for a preview `heightPx` tall (CSS px at real size). Single-column templates print
 * with the page padding repeated on every page, so each page holds `pageHeight - 2 × padding` of content; the
 * Sidebar template has no page padding. `breaks` are the y positions (px) where each new page starts.
 */
export function pageLayout(heightPx: number, design: ResumeDesign): { pages: number; breaks: number[] } {
  const pageH = PAGE_MM[design.page].h * MM_TO_PX;
  const pad = design.template === "sidebar" ? 0 : PAD_MM[design.spacing] * MM_TO_PX;
  const usable = pageH - 2 * pad;
  const pages = Math.max(1, Math.ceil((heightPx - 2 * pad - 2) / usable));
  return { pages, breaks: Array.from({ length: pages - 1 }, (_, k) => pad + (k + 1) * usable) };
}

/** Mix the accent with white: `tint(accent, 0.9)` is a pale background in the same hue. */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

interface Contact {
  text: string;
  href?: string | undefined;
}

/** A web address worth linking: http(s), or a bare domain like "linkedin.com/in/you". Anything else stays text. */
function webHref(url: string): string | undefined {
  if (/^https?:\/\/\S+$/i.test(url)) return url;
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(url) ? `https://${url}` : undefined;
}

function contactItems(data: ResumeData): Contact[] {
  const b = data.basics;
  const email = b.email.trim();
  const phone = b.phone.trim();
  return [
    { text: email, href: email.includes("@") ? `mailto:${email}` : undefined },
    { text: phone, href: phone ? `tel:${phone.replace(/[^\d+]/g, "")}` : undefined },
    { text: b.location.trim() },
    ...b.links.map((l) => ({ text: l.url.trim(), href: webHref(l.url.trim()) })),
  ].filter((c) => c.text);
}

/** The contact line with real links, so the email, LinkedIn and portfolio click in the downloaded PDF. */
function ContactLine({ items, sep }: { items: Contact[]; sep: string }) {
  return (
    <>
      {items.map((c, i) => (
        <Fragment key={`${i}-${c.text}`}>
          {i > 0 && sep}
          {c.href ? (
            <a href={c.href} target={c.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="text-inherit no-underline">
              {c.text}
            </a>
          ) : (
            c.text
          )}
        </Fragment>
      ))}
    </>
  );
}

function hasContent(data: ResumeData, id: ResumeSectionKey): boolean {
  if (id === "summary") return Boolean(data.basics.summary.trim());
  if (id === "skills") return data.skills.some((s) => s.items.some((i) => i.trim()));
  const extra = extraOf(data, id);
  if (extra) return Boolean(extra.title.trim()) && extra.items.some((i) => i.trim());
  if (id === "experience" || id === "education" || id === "projects" || id === "certifications") return data[id].length > 0;
  return false;
}

/** A bracketed cue the AI left to fill in: the same shape the ATS check counts, one-letter "[N]" included. */
const FILL = /(\[[^\][\n]{1,160}\])/;

/** Text with any [placeholder] the AI left marked on screen, so it's hard to miss (printed plainly). */
function Fill({ text }: { text: string }) {
  // split() with a capturing group keeps the placeholders at the odd indexes.
  return (
    <>
      {text.split(FILL).map((part, i) =>
        i % 2 ? (
          <mark key={i} className="resume-fill rounded-sm bg-amber-200 px-px text-inherit">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
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

  // `base` tags each line with the editor path it comes from ("experience.<id>.bullets.2"), so the editor can point at
  // the line a suggestion or an edit is about. The index is the bullet's own, blanks included.
  const bullets = (items: string[], base?: string) => {
    const list = items.map((text, i) => ({ text, i })).filter((b) => b.text.trim());
    return list.length ? (
      <ul className="mt-[2pt] list-disc space-y-[1.5pt] pl-[1.2em]">
        {list.map((b) => (
          <li key={b.i} data-rpath={base ? `${base}.bullets.${b.i}` : undefined}>
            <Fill text={b.text} />
          </li>
        ))}
      </ul>
    ) : null;
  };

  const section = (id: ResumeSectionKey): ReactNode => {
    if (!hasContent(data, id)) return null;
    let body: ReactNode = null;
    const extra = extraOf(data, id);
    if (extra) {
      const items = extra.items.filter((i) => i.trim());
      body = <div data-rpath={`extras.${extra.id}`}>{extra.style === "inline" ? <p><Fill text={items.join(" · ")} /></p> : bullets(items)}</div>;
    }
    if (id === "summary") body = <p data-rpath="basics.summary"><Fill text={data.basics.summary} /></p>;
    if (id === "experience") {
      body = data.experience.map((e) => (
        <div key={e.id} data-rpath={`experience.${e.id}`} style={{ marginBottom: space.item }} className="break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p>
              <span className="font-bold">{e.title}</span>
              {e.company && <span>{e.title ? ", " : ""}{e.company}</span>}
              {e.location && <span className="text-zinc-600"> · {e.location}</span>}
            </p>
            <p className="whitespace-nowrap text-zinc-600">{dateRange(e.start, e.end, e.current)}</p>
          </div>
          {bullets(e.bullets, `experience.${e.id}`)}
        </div>
      ));
    }
    if (id === "education") {
      body = data.education.map((e) => (
        <div key={e.id} data-rpath={`education.${e.id}`} style={{ marginBottom: space.item }} className="break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p>
              <span className="font-bold">{[e.degree, e.field].filter(Boolean).join(", ") || e.school}</span>
              {(e.degree || e.field) && e.school && <span>, {e.school}</span>}
            </p>
            <p className="whitespace-nowrap text-zinc-600">{dateRange(e.start, e.end)}</p>
          </div>
          {e.details && <p className="text-zinc-700"><Fill text={e.details} /></p>}
        </div>
      ));
    }
    if (id === "skills") {
      body = (
        <div data-rpath="skills" className="space-y-[2pt]">
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
        <div key={p.id} data-rpath={`projects.${p.id}`} style={{ marginBottom: space.item }} className="break-inside-avoid">
          <p>
            <span className="font-bold">{p.name}</span>
            {p.link && <span className="text-zinc-600"> · {p.link}</span>}
          </p>
          {p.description && <p data-rpath={`projects.${p.id}.description`}><Fill text={p.description} /></p>}
          {bullets(p.bullets, `projects.${p.id}`)}
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
        {heading(sectionLabel(data, id))}
        {body}
      </section>
    );
  };

  const photoEl = (size: string, round = true) =>
    photo ? <img src={photo} alt="" style={{ width: size, height: size }} className={round ? "rounded-full object-cover" : "rounded object-cover"} /> : null;

  const name = data.basics.name || "Your name";
  const contacts = contactItems(data);

  if (sidebar) {
    // Short, list-like sections go in the side column: skills, education, certifications, one-line extras.
    const inSide = (s: ResumeSectionKey) => ["skills", "education", "certifications"].includes(s) || extraOf(data, s)?.style === "inline";
    const main = data.section_order.filter((s) => !inSide(s));
    return (
      <div style={style} className="resume-page flex">
        <aside style={{ background: tint(accent, 0.9), padding: space.pad, width: "34%" }} className="shrink-0">
          {photo && <div className="mb-[10pt]">{photoEl("30mm")}</div>}
          <h1 data-rpath="basics.name" style={{ color: accent, fontSize: "1.9em", lineHeight: 1.1 }} className="font-bold">
            {name}
          </h1>
          {data.basics.headline && <p data-rpath="basics.headline" className="mt-[3pt] font-medium">{data.basics.headline}</p>}
          <div data-rpath="basics" className="mt-[8pt] space-y-[2pt] break-words text-[0.92em]">
            {contacts.map((c, i) => (
              <p key={`${i}-${c.text}`}>
                <ContactLine items={[c]} sep="" />
              </p>
            ))}
          </div>
          {data.section_order.filter(inSide).map(section)}
        </aside>
        <main style={{ padding: space.pad, paddingLeft: "7mm" }} className="min-w-0 flex-1">
          {main.map(section)}
        </main>
      </div>
    );
  }

  const header =
    t === "classic" ? (
      // Not positioned itself: a positioned header is painted after the sections, so the PDF's text would list
      // the name and contacts last, which confuses ATS parsers. The photo is placed against the page instead.
      <header data-rpath="basics" className="text-center">
        {photo && <div className="absolute" style={{ top: space.pad, right: space.pad }}>{photoEl("22mm")}</div>}
        <h1 data-rpath="basics.name" style={{ fontSize: "2em", lineHeight: 1.15 }} className="font-bold tracking-tight">
          {name}
        </h1>
        {data.basics.headline && <p data-rpath="basics.headline" style={{ color: accent }} className="mt-[2pt] font-medium">{data.basics.headline}</p>}
        <p className="mt-[4pt] text-zinc-600"><ContactLine items={contacts} sep="  ·  " /></p>
      </header>
    ) : t === "modern" ? (
      <header data-rpath="basics" className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 data-rpath="basics.name" style={{ color: accent, fontSize: "2.2em", lineHeight: 1.05 }} className="font-extrabold tracking-tight">
            {name}
          </h1>
          {data.basics.headline && <p data-rpath="basics.headline" className="mt-[3pt] text-[1.1em] font-medium">{data.basics.headline}</p>}
          <p className="mt-[5pt] text-zinc-600"><ContactLine items={contacts} sep="  |  " /></p>
        </div>
        {photoEl("24mm")}
      </header>
    ) : (
      <header data-rpath="basics" className="flex items-end justify-between gap-3 border-b pb-[4pt]" style={{ borderColor: accent }}>
        <div className="min-w-0">
          <h1 data-rpath="basics.name" style={{ fontSize: "1.6em", lineHeight: 1.1 }} className="font-bold">
            {name}
            {data.basics.headline && <span className="font-normal text-zinc-600"> — {data.basics.headline}</span>}
          </h1>
          <p className="text-zinc-600"><ContactLine items={contacts} sep=" · " /></p>
        </div>
        {photoEl("16mm")}
      </header>
    );

  return (
    <div style={style} className="resume-page relative">
      {header}
      {data.section_order.map(section)}
    </div>
  );
}

/** The cover letter on a page that matches the resume: same font, colour and contact line. */
export function LetterPreview({ data, design, text }: { data: ResumeData; design: ResumeDesign; text: string }) {
  const space = SPACE[design.spacing];
  const page = PAGE_MM[design.page];
  const font = FONTS.find((f) => f.id === design.font)?.stack ?? FONTS[0]!.stack;
  const contacts = contactItems(data);
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <div
      className="resume-page"
      style={{ width: `${page.w}mm`, minHeight: `${page.h}mm`, padding: space.pad, fontFamily: font, fontSize: `${design.font_size}pt`, lineHeight: 1.5, color: "#18181b", background: "#ffffff" }}
    >
      <header style={{ borderColor: design.accent, paddingBottom: "4pt" }} className="border-b">
        <h1 style={{ color: design.accent, fontSize: "1.6em", lineHeight: 1.15 }} className="font-bold">
          {data.basics.name || "Your name"}
        </h1>
        {contacts.length > 0 && <p className="text-zinc-600"><ContactLine items={contacts} sep="  ·  " /></p>}
      </header>
      <p style={{ marginTop: space.section }}>{today}</p>
      {blocks.length ? (
        blocks.map((b, i) => (
          <p key={i} style={{ marginTop: space.section }}>
            {b.split("\n").map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                <Fill text={line} />
              </span>
            ))}
          </p>
        ))
      ) : (
        <p style={{ marginTop: space.section }} className="text-zinc-400">
          Your cover letter appears here.
        </p>
      )}
    </div>
  );
}
