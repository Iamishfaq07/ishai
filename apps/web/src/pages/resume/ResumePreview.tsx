import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { ResumeData, ResumeDesign, ResumeSectionKey } from "@orbit/types";
import { FONTS, LINE_HEIGHTS, SERIF_FONTS, dateRange, extraOf, sectionLabel, shownSections } from "./model";

const SPACE = {
  compact: { section: "9pt", item: "5pt", pad: "12mm" },
  normal: { section: "13pt", item: "7pt", pad: "16mm" },
  relaxed: { section: "17pt", item: "10pt", pad: "20mm" },
} as const;
// Campus is tighter between sections and entries. The page padding stays, so pages break where pageLayout says.
const CAMPUS_GAPS = {
  compact: { section: "6pt", item: "4pt" },
  normal: { section: "8pt", item: "5pt" },
  relaxed: { section: "11pt", item: "6pt" },
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
 * Campus and Harvard entries: the school or company in bold with the dates flush right, and the degree or role in
 * italics below, with the grade or location flush right.
 */
function Stacked({ title, dates, sub, side }: { title: string; dates: string; sub: string; side: string }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-x-3">
        <p className="min-w-0 font-bold">{title}</p>
        {dates && <p className="shrink-0 whitespace-nowrap">{dates}</p>}
      </div>
      {(sub || side) && (
        <div className="flex items-baseline justify-between gap-x-3 italic">
          <p className="min-w-0">{sub}</p>
          {side && <p className="shrink-0 whitespace-nowrap">{side}</p>}
        </div>
      )}
    </>
  );
}

/**
 * One resume page (or more, when it runs long), drawn at real size in mm. Always dark text on white paper, whatever
 * the app theme, because it's what gets printed to PDF. Headings use the standard section names ATS software
 * looks for.
 */
/**
 * `decorative`: the resume is an illustration inside another page (the public Resume AI page's sample), so its name
 * isn't that page's heading: a paragraph instead of an `<h1>`, which stays for the editor's preview and the PDF.
 */
export function ResumePreview({ data, design, decorative = false }: { data: ResumeData; design: ResumeDesign; decorative?: boolean }) {
  const NameTag = decorative ? "p" : "h1";
  const space = design.template === "campus" ? { ...SPACE[design.spacing], ...CAMPUS_GAPS[design.spacing] } : SPACE[design.spacing];
  const font = FONTS.find((f) => f.id === design.font)?.stack ?? FONTS[0]!.stack;
  const page = PAGE_MM[design.page];
  const accent = design.accent;
  const t = design.template;
  const photo = design.show_photo && design.photo ? design.photo : null;
  const sidebar = t === "sidebar";
  const stacked = t === "campus" || t === "harvard";

  const lineHeight = LINE_HEIGHTS.find((l) => l.id === (design.line_height ?? "normal"))?.value ?? 1.4;
  const serif = "Georgia, 'Times New Roman', serif";
  // Harvard's name and headings: the chosen font if it's a serif, else Georgia.
  const titleFont = SERIF_FONTS.has(design.font) ? font : serif;
  const style: CSSProperties = {
    width: `${page.w}mm`,
    minHeight: `${page.h}mm`,
    fontFamily: font,
    fontSize: `${design.font_size}pt`,
    lineHeight: t === "compact" || t === "campus" ? lineHeight - 0.1 : lineHeight,
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
    if (t === "elegant") {
      return (
        <h2
          style={{ color: accent, fontFamily: serif, fontSize: "1.05em", letterSpacing: "0.14em", borderBottom: `3px double ${accent}`, marginBottom: space.item, paddingBottom: "2pt" }}
          className="text-center font-semibold uppercase"
        >
          {label}
        </h2>
      );
    }
    if (t === "minimal") {
      return (
        <h2 style={{ color: "#71717a", fontSize: "0.85em", letterSpacing: "0.18em", marginBottom: space.item }} className="font-semibold uppercase">
          {label}
        </h2>
      );
    }
    if (t === "bold") {
      return (
        <h2 style={{ color: accent, fontSize: "1.1em", marginBottom: space.item }} className="font-extrabold uppercase tracking-wide">
          {label}
        </h2>
      );
    }
    if (t === "executive") {
      return (
        <h2
          style={{ background: tint(accent, 0.9), borderLeft: `3px solid ${accent}`, color: "#18181b", fontSize: "1em", marginBottom: space.item, padding: "1.5pt 5pt" }}
          className="font-bold uppercase tracking-wider"
        >
          {label}
        </h2>
      );
    }
    if (t === "campus") {
      // Small capitals over a hairline, as in the LaTeX resumes recruiters know ("Jake's resume"), in the body's font
      // (the app's own h1/h2 style would set them in Space Grotesk).
      return (
        <h2
          style={{ color: accent, fontFamily: font, fontVariant: "small-caps", fontSize: "1.2em", letterSpacing: "0.03em", lineHeight: 1.2, borderBottom: `0.75pt solid ${accent}`, marginBottom: "3pt", paddingBottom: "0.5pt" }}
          className="font-semibold"
        >
          {label}
        </h2>
      );
    }
    if (t === "harvard") {
      return (
        <h2
          style={{ color: accent, fontFamily: titleFont, fontSize: "1em", letterSpacing: "0.08em", borderBottom: `0.75pt solid ${accent}`, marginBottom: space.item, paddingBottom: "1.5pt" }}
          className="text-center font-bold uppercase"
        >
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
      <ul className={`mt-[2pt] list-disc pl-[1.2em] ${t === "campus" ? "space-y-[0.5pt]" : "space-y-[1.5pt]"}`}>
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
          {stacked ? (
            <Stacked title={e.company || e.title} dates={dateRange(e.start, e.end, e.current)} sub={e.company ? e.title : ""} side={e.location} />
          ) : (
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p>
                <span className="font-bold">{e.title}</span>
                {e.company && <span>{e.title ? ", " : ""}{e.company}</span>}
                {e.location && <span className="text-zinc-600"> · {e.location}</span>}
              </p>
              <p className="whitespace-nowrap text-zinc-600">{dateRange(e.start, e.end, e.current)}</p>
            </div>
          )}
          {bullets(e.bullets, `experience.${e.id}`)}
        </div>
      ));
    }
    if (id === "education") {
      body = data.education.map((e) => {
        const degree = [e.degree, e.field].filter(Boolean).join(", ");
        const grade = e.grade?.trim() ?? "";
        return (
          <div key={e.id} data-rpath={`education.${e.id}`} style={{ marginBottom: space.item }} className="break-inside-avoid">
            {stacked ? (
              <>
                <Stacked title={e.school || degree} dates={dateRange(e.start, e.end)} sub={e.school ? degree : ""} side={grade} />
                {e.details && <p><Fill text={e.details} /></p>}
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p>
                    <span className="font-bold">{degree || e.school}</span>
                    {degree && e.school && <span>, {e.school}</span>}
                  </p>
                  <p className="whitespace-nowrap text-zinc-600">{dateRange(e.start, e.end)}</p>
                </div>
                {/* The grade leads the line under the degree: campus filters and recruiters look for it first. */}
                {(grade || e.details) && (
                  <p className="text-zinc-700">
                    {grade && <span className="font-medium text-zinc-900">{grade}</span>}
                    {grade && e.details && " · "}
                    {e.details && <Fill text={e.details} />}
                  </p>
                )}
              </>
            )}
          </div>
        );
      });
    }
    if (id === "skills") {
      body = (
        <div data-rpath="skills" className="space-y-[2pt]">
          {data.skills
            .filter((s) => s.items.some((i) => i.trim()))
            .map((s) => (
              <p key={s.id}>
                {s.name && <span className="font-bold">{s.name}: </span>}
                {design.skills_style === "tags"
                  ? s.items.filter((i) => i.trim()).map((item, i) => (
                      <span key={i} style={{ borderColor: tint(accent, 0.55), background: tint(accent, 0.94) }} className="mb-[2pt] mr-[3pt] inline-block rounded border px-[4pt]">
                        {item}
                      </span>
                    ))
                  : s.items.filter((i) => i.trim()).join(", ")}
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
    const main = shownSections(data).filter((s) => !inSide(s));
    return (
      <div style={style} className="resume-page flex">
        <aside style={{ background: tint(accent, 0.9), padding: space.pad, width: "34%" }} className="shrink-0">
          {photo && <div className="mb-[10pt]">{photoEl("30mm")}</div>}
          <NameTag data-rpath="basics.name" style={{ color: accent, fontSize: "1.9em", lineHeight: 1.1 }} className="font-bold">
            {name}
          </NameTag>
          {data.basics.headline && <p data-rpath="basics.headline" className="mt-[3pt] font-medium">{data.basics.headline}</p>}
          <div data-rpath="basics" className="mt-[8pt] space-y-[2pt] break-words text-[0.92em]">
            {contacts.map((c, i) => (
              <p key={`${i}-${c.text}`}>
                <ContactLine items={[c]} sep="" />
              </p>
            ))}
          </div>
          {shownSections(data).filter(inSide).map(section)}
        </aside>
        <main style={{ padding: space.pad, paddingLeft: "7mm" }} className="min-w-0 flex-1">
          {main.map(section)}
        </main>
      </div>
    );
  }

  const header =
    t === "campus" ? (
      <header data-rpath="basics" className="text-center">
        {photo && <div className="absolute" style={{ top: space.pad, right: space.pad }}>{photoEl("22mm")}</div>}
        <NameTag data-rpath="basics.name" style={{ fontFamily: font, fontSize: "2.15em", lineHeight: 1.1, fontVariant: "small-caps", letterSpacing: "0.02em" }} className="font-bold">
          {name}
        </NameTag>
        {data.basics.headline && <p data-rpath="basics.headline" className="mt-[1pt]">{data.basics.headline}</p>}
        <p className="mt-[2pt] text-zinc-700"><ContactLine items={contacts} sep=" | " /></p>
      </header>
    ) : t === "harvard" ? (
      <header data-rpath="basics" className="text-center">
        {photo && <div className="absolute" style={{ top: space.pad, right: space.pad }}>{photoEl("22mm")}</div>}
        <NameTag data-rpath="basics.name" style={{ fontFamily: titleFont, fontSize: "1.9em", lineHeight: 1.15 }} className="font-bold">
          {name}
        </NameTag>
        {data.basics.headline && <p data-rpath="basics.headline" className="mt-[2pt] italic">{data.basics.headline}</p>}
        <p className="mt-[3pt] text-zinc-700"><ContactLine items={contacts} sep="  •  " /></p>
      </header>
    ) : t === "classic" ? (
      // Not positioned itself: a positioned header is painted after the sections, so the PDF's text would list
      // the name and contacts last, which confuses ATS parsers. The photo is placed against the page instead.
      <header data-rpath="basics" className="text-center">
        {photo && <div className="absolute" style={{ top: space.pad, right: space.pad }}>{photoEl("22mm")}</div>}
        <NameTag data-rpath="basics.name" style={{ fontSize: "2em", lineHeight: 1.15 }} className="font-bold tracking-tight">
          {name}
        </NameTag>
        {data.basics.headline && <p data-rpath="basics.headline" style={{ color: accent }} className="mt-[2pt] font-medium">{data.basics.headline}</p>}
        <p className="mt-[4pt] text-zinc-600"><ContactLine items={contacts} sep="  ·  " /></p>
      </header>
    ) : t === "elegant" ? (
      <header data-rpath="basics" className="text-center">
        {photo && <div className="absolute" style={{ top: space.pad, right: space.pad }}>{photoEl("22mm")}</div>}
        <NameTag data-rpath="basics.name" style={{ fontFamily: serif, fontSize: "2.2em", lineHeight: 1.1, letterSpacing: "0.04em" }} className="font-semibold">
          {name}
        </NameTag>
        {data.basics.headline && <p data-rpath="basics.headline" style={{ color: accent, letterSpacing: "0.12em" }} className="mt-[3pt] text-[0.95em] uppercase">{data.basics.headline}</p>}
        <p className="mt-[5pt] text-zinc-600"><ContactLine items={contacts} sep="  ◆  " /></p>
      </header>
    ) : t === "minimal" ? (
      <header data-rpath="basics" className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <NameTag data-rpath="basics.name" style={{ fontSize: "2.1em", lineHeight: 1.1 }} className="font-light tracking-tight">
            {name}
          </NameTag>
          {data.basics.headline && <p data-rpath="basics.headline" className="mt-[2pt] text-zinc-600">{data.basics.headline}</p>}
          <p className="mt-[5pt] text-[0.92em] text-zinc-500"><ContactLine items={contacts} sep="   " /></p>
        </div>
        {photoEl("22mm")}
      </header>
    ) : t === "bold" ? (
      <header
        data-rpath="basics"
        style={{ background: accent, margin: `-${space.pad} -${space.pad} 0`, padding: `${space.pad} ${space.pad} 9pt` }}
        className="flex items-end justify-between gap-4 text-white"
      >
        <div className="min-w-0">
          <NameTag data-rpath="basics.name" style={{ fontSize: "2.3em", lineHeight: 1.05 }} className="font-extrabold tracking-tight">
            {name}
          </NameTag>
          {data.basics.headline && <p data-rpath="basics.headline" className="mt-[3pt] text-[1.1em] font-medium opacity-90">{data.basics.headline}</p>}
          <p className="mt-[5pt] opacity-90"><ContactLine items={contacts} sep="  |  " /></p>
        </div>
        {photoEl("24mm")}
      </header>
    ) : t === "executive" ? (
      <header data-rpath="basics" className="flex items-start justify-between gap-4 pb-[4pt]" style={{ borderBottom: `2px solid ${accent}` }}>
        <div className="min-w-0">
          <NameTag data-rpath="basics.name" style={{ fontFamily: serif, fontSize: "2.2em", lineHeight: 1.05 }} className="font-bold">
            {name}
          </NameTag>
          {data.basics.headline && <p data-rpath="basics.headline" style={{ color: accent }} className="mt-[3pt] text-[1.1em] font-semibold">{data.basics.headline}</p>}
        </div>
        <div className="shrink-0 text-right text-[0.92em] text-zinc-600">
          {contacts.map((c, i) => (
            <p key={`${i}-${c.text}`}><ContactLine items={[c]} sep="" /></p>
          ))}
        </div>
        {photoEl("20mm")}
      </header>
    ) : t === "modern" ? (
      <header data-rpath="basics" className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <NameTag data-rpath="basics.name" style={{ color: accent, fontSize: "2.2em", lineHeight: 1.05 }} className="font-extrabold tracking-tight">
            {name}
          </NameTag>
          {data.basics.headline && <p data-rpath="basics.headline" className="mt-[3pt] text-[1.1em] font-medium">{data.basics.headline}</p>}
          <p className="mt-[5pt] text-zinc-600"><ContactLine items={contacts} sep="  |  " /></p>
        </div>
        {photoEl("24mm")}
      </header>
    ) : (
      <header data-rpath="basics" className="flex items-end justify-between gap-3 border-b pb-[4pt]" style={{ borderColor: accent }}>
        <div className="min-w-0">
          <NameTag data-rpath="basics.name" style={{ fontSize: "1.6em", lineHeight: 1.1 }} className="font-bold">
            {name}
            {data.basics.headline && <span className="font-normal text-zinc-600"> — {data.basics.headline}</span>}
          </NameTag>
          <p className="text-zinc-600"><ContactLine items={contacts} sep=" · " /></p>
        </div>
        {photoEl("16mm")}
      </header>
    );

  return (
    <div style={style} className="resume-page relative">
      {header}
      {shownSections(data).map(section)}
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
