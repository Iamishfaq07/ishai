import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  AtsCheck,
  EvidenceItem,
  ResumeCertification,
  ResumeData,
  ResumeEducation,
  ResumeExperience,
  ResumeExtraSection,
  ResumeLineIssue,
  ResumeProject,
  ResumeSectionId,
  ResumeSectionKey,
  ResumeSkillGroup,
} from "@orbit/types";
import { ChevronDown, Copy, Eye, EyeOff, PenLine, Plus, ShieldCheck, Sparkles, Trash2, X, cx, focusRing, gradeCopy, isIndia, regionExamples } from "@orbit/ui";
import { useCountry } from "../../lib/country";
import { evidenceFor, sourceLabel } from "../../lib/evidence";
import { Button, Field, Input, Textarea } from "../../components/ui";
import { MAX_EXTRAS, SECTION_LABEL, bulletStrength, extraPresets, getAt, newId, presetForTitle, sectionLabel, type BulletStrength } from "./model";

type Update = (fn: (d: ResumeData) => ResumeData) => void;

const MAX_BULLETS = 12;

/** A copy of item `i` right after it, with its own id (and bullets), to edit into a similar role. */
function duplicateAt<T extends { id: string }>(list: T[], i: number): T[] {
  const item = list[i];
  if (!item) return list;
  return [...list.slice(0, i + 1), { ...structuredClone(item), id: newId() }, ...list.slice(i + 1)];
}

function move<T>(list: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cx("rounded-md p-1 text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900 disabled:opacity-30 dark:hover:bg-white/10 dark:hover:text-white", focusRing)}
    >
      {children}
    </button>
  );
}

function ItemTools({ i, n, label, onMove, onRemove, onDuplicate }: {
  i: number;
  n: number;
  label: string;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  /** Absent when the list is full. */
  onDuplicate?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton label={`Move ${label} up`} onClick={() => onMove(-1)} disabled={i === 0}>
        <ChevronDown className="h-4 w-4 rotate-180" />
      </IconButton>
      <IconButton label={`Move ${label} down`} onClick={() => onMove(1)} disabled={i === n - 1}>
        <ChevronDown className="h-4 w-4" />
      </IconButton>
      {onDuplicate && (
        <IconButton label={`Duplicate ${label}`} onClick={onDuplicate}>
          <Copy className="h-4 w-4" />
        </IconButton>
      )}
      <IconButton label={`Remove ${label}`} onClick={onRemove}>
        <Trash2 className="h-4 w-4" />
      </IconButton>
    </div>
  );
}

/**
 * One part of the form. Its title folds it away (the form is long, above all on a phone), but folded fields stay in the
 * page, just hidden: a fix or "Show me" that points into a folded section opens it first (`data-collapse-toggle`,
 * ResumeEditor), and the preview and score keep reading every field.
 */
// The sections folded away, kept while the app is open so switching to Score and back (which rebuilds this form)
// doesn't unfold them.
const folded = new Set<string>();

function Section({ id, title, children, action }: { id: string; title: string; children: ReactNode; action?: ReactNode }) {
  const [open, setOpenState] = useState(() => !folded.has(id));
  const setOpen = (next: (o: boolean) => boolean) =>
    setOpenState((o) => {
      const v = next(o);
      if (v) folded.delete(id);
      else folded.add(id);
      return v;
    });
  const body = `section-body-${id}`;
  return (
    <section
      data-path={id}
      data-collapsed={open ? undefined : ""}
      tabIndex={-1}
      className="scroll-mt-24 rounded-2xl border border-zinc-200 bg-white/70 p-4 outline-none dark:border-white/10 dark:bg-white/[0.03]"
    >
      <div className={cx("flex items-center justify-between gap-2", open && "mb-3")}>
        <h3 className="min-w-0 font-display text-base font-semibold">
          <button
            type="button"
            data-collapse-toggle=""
            aria-expanded={open}
            aria-controls={body}
            onClick={() => setOpen((o) => !o)}
            className={cx("-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 text-left hover:text-indigo-700 dark:hover:text-indigo-300", focusRing)}
          >
            <ChevronDown
              aria-hidden="true"
              className={cx("h-4 w-4 shrink-0 text-zinc-400 motion-ok:transition-transform", !open && "-rotate-90")}
            />
            {title}
          </button>
        </h3>
        {action}
      </div>
      <div id={body} hidden={!open} className="space-y-3">
        {children}
      </div>
    </section>
  );
}

function TwoCol({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

/** "Rewrite this one with AI", for the field at a path (a bullet, the summary). Absent when the editor has no AI. */
type Rewrite = ((path: string) => void) | undefined;

/** The latest score's line-by-line writing issues, and the resume it scored (to tell which lines changed since). */
type LineChecks = { issues: ResumeLineIssue[]; scored: ResumeData | null; evidence?: EvidenceItem[]; checks?: AtsCheck[] };

const STRENGTH: Record<BulletStrength["level"], { label: string; tone: string }> = {
  strong: { label: "Strong", tone: "text-emerald-700 dark:text-emerald-300" },
  fair: { label: "Fair", tone: "text-amber-700 dark:text-amber-300" },
  weak: { label: "Weak", tone: "text-rose-700 dark:text-rose-300" },
};

/** How strong the bullet reads to a recruiter, by the latest score, and what would make it stronger. */
function StrengthMark({ path, text, checks }: { path: string; text: string; checks: LineChecks }) {
  const s = bulletStrength(path, text, checks.checks ? { checks: checks.checks, issues: checks.issues } : null, checks.scored);
  if (!s) return null;
  const { label, tone } = STRENGTH[s.level];
  return (
    <p className={cx("ml-3 mr-7 flex items-center gap-1.5 text-xs", tone)} aria-label={`Bullet strength: ${label}${s.needs.length ? `, ${s.needs.join(", ")}` : ""}`}>
      <span aria-hidden="true" className="flex gap-[2px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className={cx("h-1.5 w-3 rounded-full bg-current", i >= { weak: 1, fair: 2, strong: 3 }[s.level] && "opacity-20")} />
        ))}
      </span>
      <span className="font-medium">{label}</span>
      {s.needs.length > 0 && <span className="text-zinc-500 dark:text-zinc-400">· {s.needs.join(", ")}</span>}
    </p>
  );
}

const NO_CHECKS: LineChecks = { issues: [], scored: null };

/** A bullet a confirmed evidence vault claim backs (lib/evidence.ts evidenceFor): the claim and where it's from. */
function EvidenceMark({ text, items }: { text: string; items: EvidenceItem[] }) {
  const backing = items.length ? evidenceFor(text, items) : null;
  if (!backing) return null;
  const source = sourceLabel(backing);
  return (
    <p className="ml-3 mr-7 flex items-start gap-1.5 text-xs text-emerald-800 dark:text-emerald-300"
       title={backing.quote ? `“${backing.quote}” (${source})` : source}>
      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Backed by your evidence: <span className="font-medium">{backing.claim}</span>
        <span className="text-zinc-500 dark:text-zinc-400"> · {source}</span>
      </span>
    </p>
  );
}

const linkButton = cx("inline-flex items-center gap-1 rounded font-medium text-indigo-700 hover:underline dark:text-indigo-300", focusRing);

/**
 * What a recruiter would flag on this line, under it, with the fix: tech names are fixed on the spot, a repeated
 * bullet can go, and the rest is the line's AI rewrite. Hidden once the line is edited, until the next score.
 */
function LineNotes({ path, text, checks, onRewrite, onSet, onRemove, className }: {
  path: string;
  text: string;
  checks: LineChecks;
  onRewrite?: Rewrite;
  onSet: (value: string) => void;
  onRemove?: () => void;
  className?: string;
}) {
  const mine = checks.scored && getAt(checks.scored, path) === text ? checks.issues.filter((i) => i.path === path) : [];
  if (!mine.length) return null;
  const spelled = mine.find((i) => i.kind === "casing")?.fixed ?? null;
  const rewritable = mine.some((i) => i.kind !== "casing" && i.kind !== "duplicate");
  return (
    <div className={cx("space-y-1 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-900 dark:text-amber-100", className)}>
      <ul className="space-y-0.5">
        {mine.map((i) => (
          <li key={i.kind}>{i.message}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        {spelled !== null && (
          <button type="button" className={linkButton} onClick={() => onSet(spelled)}>
            Fix the spelling
          </button>
        )}
        {onRemove && mine.some((i) => i.kind === "duplicate") && (
          <button type="button" className={linkButton} onClick={onRemove}>
            Remove this one
          </button>
        )}
        {onRewrite && rewritable && (
          <button type="button" className={linkButton} onClick={() => onRewrite(path)}>
            <Sparkles className="h-3 w-3" /> Fix with AI
          </button>
        )}
      </div>
    </div>
  );
}

function Bullets({ path, bullets, onChange, onRewrite, checks = NO_CHECKS }: {
  path: string;
  bullets: string[];
  onChange: (b: string[]) => void;
  onRewrite?: Rewrite;
  checks?: LineChecks;
}) {
  const setBullet = (i: number, value: string) => onChange(bullets.map((x, j) => (j === i ? value : x)));
  const focusBullet = (i: number, atEnd = false) =>
    window.setTimeout(() => {
      const el = document.querySelector<HTMLTextAreaElement>(`[data-path="${CSS.escape(`${path}.bullets.${i}`)}"]`);
      el?.focus();
      if (el && atEnd) el.setSelectionRange(el.value.length, el.value.length);
    });
  // Enter starts the next bullet (Shift+Enter is a line break); Backspace in an empty bullet removes it.
  const onKey = (i: number, e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (bullets.length >= MAX_BULLETS) return;
      const caret = e.currentTarget.selectionStart;
      const text = bullets[i] ?? "";
      const next = [...bullets];
      next.splice(i, 1, text.slice(0, caret).trimEnd(), text.slice(caret).trimStart());
      onChange(next);
      focusBullet(i + 1);
    } else if (e.key === "Backspace" && !(bullets[i] ?? "") && bullets.length > 1) {
      e.preventDefault();
      onChange(bullets.filter((_, j) => j !== i));
      focusBullet(Math.max(0, i - 1), true);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Bullets: start with a verb, end with the result (a number if you have one). Enter adds the next one.
      </p>
      {bullets.map((b, i) => (
        <div key={i} className="space-y-1">
          <div className="flex items-start gap-1">
            <span aria-hidden className="mt-2.5 text-zinc-400">•</span>
            <Textarea
              aria-label={`Bullet ${i + 1}`}
              maxLength={400}
              data-path={`${path}.bullets.${i}`}
              rows={2}
              spellCheck
              value={b}
              onChange={(e) => setBullet(i, e.target.value)}
              onKeyDown={(e) => onKey(i, e)}
              className="min-h-0 flex-1 scroll-mt-24"
            />
            <div className="flex flex-col">
              <IconButton label={`Move bullet ${i + 1} up`} onClick={() => onChange(move(bullets, i, -1))} disabled={i === 0}>
                <ChevronDown className="h-3.5 w-3.5 rotate-180" />
              </IconButton>
              <IconButton label={`Move bullet ${i + 1} down`} onClick={() => onChange(move(bullets, i, 1))} disabled={i === bullets.length - 1}>
                <ChevronDown className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton label={`Remove bullet ${i + 1}`} onClick={() => onChange(bullets.filter((_, j) => j !== i))}>
                <X className="h-3.5 w-3.5" />
              </IconButton>
              {onRewrite && b.trim() && (
                <IconButton label={`Rewrite bullet ${i + 1} with AI`} onClick={() => onRewrite(`${path}.bullets.${i}`)}>
                  <Sparkles className="h-3.5 w-3.5" />
                </IconButton>
              )}
            </div>
          </div>
          <LineNotes
            path={`${path}.bullets.${i}`}
            text={b}
            checks={checks}
            onRewrite={onRewrite}
            onSet={(value) => setBullet(i, value)}
            onRemove={() => onChange(bullets.filter((_, j) => j !== i))}
            className="ml-3 mr-7"
          />
          <StrengthMark path={`${path}.bullets.${i}`} text={b} checks={checks} />
          <EvidenceMark text={b} items={checks.evidence ?? []} />
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          onChange([...bullets, ""]);
          focusBullet(bullets.length);
        }}
        disabled={bullets.length >= MAX_BULLETS}
      >
        <Plus className="h-3.5 w-3.5" /> Add bullet
      </Button>
    </div>
  );
}

/** One extra section: its title, list or one-line style, and its items. */
function ExtraEditor({ x, i, n, onPatch, onMove, onRemove }: {
  x: ResumeExtraSection;
  i: number;
  n: number;
  onPatch: (patch: Partial<ResumeExtraSection>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const preset = presetForTitle(x.title, useCountry());
  const placeholder = preset?.placeholder ?? "One item per line";
  const items = x.items.length ? x.items : [""];
  const setItems = (next: string[]) => onPatch({ items: next });
  return (
    <div data-path={`extras.${x.id}`} tabIndex={-1} className="scroll-mt-24 space-y-3 rounded-xl border border-zinc-200 p-3 outline-none dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Section title" maxLength={60} value={x.title} placeholder="Section title" className="min-w-0 flex-1 font-medium" onChange={(e) => onPatch({ title: e.target.value })} />
        <div role="group" aria-label="Show as" className="inline-flex gap-1 rounded-lg bg-zinc-500/10 p-0.5">
          {(["bullets", "inline"] as const).map((style) => (
            <button
              key={style}
              type="button"
              aria-pressed={x.style === style}
              onClick={() => onPatch({ style })}
              className={cx("rounded-md px-2 py-0.5 text-xs", x.style === style ? "bg-white font-medium shadow-sm dark:bg-white/10" : "text-zinc-500", focusRing)}
            >
              {style === "bullets" ? "List" : "One line"}
            </button>
          ))}
        </div>
        <ItemTools i={i} n={n} label={x.title || "section"} onMove={onMove} onRemove={onRemove} />
      </div>
      {preset?.note && <p className="-mt-1 text-xs text-zinc-500 dark:text-zinc-400">{preset.note}</p>}
      <div className="space-y-2">
        {items.map((item, j) => (
          <div key={j} className="flex items-center gap-1">
            <span aria-hidden className="text-zinc-400">{x.style === "inline" ? "·" : "•"}</span>
            <Input
              aria-label={`${x.title || "Section"} item ${j + 1}`}
              maxLength={300}
              data-path={`extras.${x.id}.items.${j}`}
              value={item}
              placeholder={j === 0 ? placeholder : undefined}
              className="flex-1 scroll-mt-24"
              onChange={(e) => setItems(items.map((t, k) => (k === j ? e.target.value : t)))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && items.length < 20) {
                  e.preventDefault();
                  setItems([...items.slice(0, j + 1), "", ...items.slice(j + 1)]);
                  window.setTimeout(() => document.querySelector<HTMLInputElement>(`[data-path="extras.${x.id}.items.${j + 1}"]`)?.focus());
                }
              }}
            />
            <IconButton label={`Remove item ${j + 1}`} onClick={() => setItems(items.filter((_, k) => k !== j))}>
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setItems([...items, ""])} disabled={items.length >= 20}>
          <Plus className="h-3.5 w-3.5" /> Add item
        </Button>
      </div>
    </div>
  );
}

/** Comma-separated skills, kept as typed while the field has focus (so "React, " doesn't lose its comma). */
function SkillItems({ id, items, onChange }: { id: string; items: string[]; onChange: (items: string[]) => void }) {
  const [text, setText] = useState(items.join(", "));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(items.join(", "));
  }, [items, focused]);
  return (
    <Input
      id={id}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 40));
      }}
      placeholder="Python, SQL, Figma, Stakeholder management"
    />
  );
}

export function ContentForm({ data, update, onRewrite, issues = [], scored = null, evidence = [], checks: atsChecks = [] }: {
  data: ResumeData;
  update: Update;
  onRewrite?: Rewrite;
  issues?: ResumeLineIssue[];
  scored?: ResumeData | null;
  /** Confirmed evidence vault claims: a bullet one backs says so. */
  evidence?: EvidenceItem[];
  /** The latest score's checks: each bullet's strength (bulletStrength). */
  checks?: AtsCheck[];
}) {
  const b = data.basics;
  // Education is written the way it's read where the user applies: Class 10 and 12, CGPA and marksheets in India.
  const country = useCountry();
  const india = isIndia(country);
  const example = regionExamples(country);
  const grade = gradeCopy(country);
  const checks: LineChecks = { issues, scored, evidence, checks: atsChecks };
  const [renaming, setRenaming] = useState<ResumeSectionKey | null>(null);
  const summaryWords = b.summary.trim() ? b.summary.trim().split(/\s+/).length : 0;
  const setBasics = (patch: Partial<ResumeData["basics"]>) => update((d) => ({ ...d, basics: { ...d.basics, ...patch } }));
  const list = <K extends "experience" | "education" | "skills" | "projects" | "certifications" | "extras">(key: K) => ({
    set: (items: ResumeData[K]) => update((d) => ({ ...d, [key]: items })),
    patch: (id: string, patch: Partial<ResumeData[K][number]>) =>
      update((d) => ({ ...d, [key]: (d[key] as Array<{ id: string }>).map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
  });
  const exp = list("experience");
  const edu = list("education");
  const skills = list("skills");
  const projects = list("projects");
  const certs = list("certifications");
  const extras = list("extras");
  const usedTitles = new Set(data.extras.map((x) => x.title.trim().toLowerCase()));
  const addExtra = (title: string, style: ResumeExtraSection["style"], fill = "") => {
    const id = newId();
    update((d) => ({
      ...d,
      extras: [...d.extras, { id, title, items: [fill], style }],
      section_order: [...d.section_order, `extra:${id}` as ResumeSectionKey],
    }));
    window.setTimeout(() => {
      const sel = title ? `[data-path="extras.${id}.items.0"]` : `[data-path="extras.${id}"] input`;
      document.querySelector<HTMLElement>(sel)?.focus();
    });
  };
  const removeExtra = (id: string) =>
    update((d) => ({ ...d, extras: d.extras.filter((x) => x.id !== id), section_order: d.section_order.filter((k) => k !== `extra:${id}`) }));

  const hidden = new Set(data.hidden ?? []);
  const toggleHidden = (s: ResumeSectionKey) =>
    update((d) => {
      const now = new Set(d.hidden ?? []);
      if (!now.delete(s)) now.add(s);
      return { ...d, hidden: d.section_order.filter((k) => now.has(k)) };
    });
  const setTitle = (s: ResumeSectionId, title: string) =>
    update((d) => ({ ...d, titles: { ...d.titles, [s]: title.slice(0, 40) } }));
  const order = (
    <Section id="section_order" title="Sections: order, names and what shows">
      <p className="-mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Hidden sections stay here but are left off the resume. Standard names (Experience, Education, Skills) are what
        ATS software looks for.
      </p>
      <ol className="space-y-1">
        {data.section_order.map((s, i) => (
          <li key={s} className={cx("flex items-center justify-between gap-2 rounded-lg bg-zinc-500/5 px-3 py-1.5 text-sm", hidden.has(s) && "opacity-60")}>
            {renaming === s && !s.startsWith("extra:") ? (
              <Input
                aria-label={`Heading for ${SECTION_LABEL[s as ResumeSectionId]}`}
                autoFocus
                maxLength={40}
                value={data.titles?.[s as ResumeSectionId] ?? ""}
                placeholder={SECTION_LABEL[s as ResumeSectionId]}
                onChange={(e) => setTitle(s as ResumeSectionId, e.target.value)}
                onBlur={() => setRenaming(null)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && setRenaming(null)}
                className="h-8 min-w-0 flex-1 py-1"
              />
            ) : (
              <span className={cx("min-w-0 flex-1 truncate", hidden.has(s) && "line-through")}>
                {sectionLabel(data, s)}
                {hidden.has(s) && <span className="ml-2 text-xs no-underline">(hidden)</span>}
              </span>
            )}
            <span className="flex">
              {!s.startsWith("extra:") && (
                <IconButton label={`Rename ${sectionLabel(data, s)}`} onClick={() => setRenaming(s)}>
                  <PenLine className="h-4 w-4" />
                </IconButton>
              )}
              <IconButton label={hidden.has(s) ? `Show ${sectionLabel(data, s)}` : `Hide ${sectionLabel(data, s)}`} onClick={() => toggleHidden(s)}>
                {hidden.has(s) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </IconButton>
              <IconButton label={`Move ${sectionLabel(data, s)} up`} onClick={() => update((d) => ({ ...d, section_order: move<ResumeSectionKey>(d.section_order, i, -1) }))} disabled={i === 0}>
                <ChevronDown className="h-4 w-4 rotate-180" />
              </IconButton>
              <IconButton label={`Move ${sectionLabel(data, s)} down`} onClick={() => update((d) => ({ ...d, section_order: move<ResumeSectionKey>(d.section_order, i, 1) }))} disabled={i === data.section_order.length - 1}>
                <ChevronDown className="h-4 w-4" />
              </IconButton>
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );

  return (
    <div className="space-y-4">
      <Section id="basics" title="Contact & headline">
        <TwoCol>
          <Field label="Full name" htmlFor="r-name">
            <Input id="r-name" maxLength={120} data-path="basics.name" value={b.name} onChange={(e) => setBasics({ name: e.target.value })} autoComplete="name" />
          </Field>
          <Field label="Headline" htmlFor="r-headline" hint="Your title, e.g. Senior Backend Engineer.">
            <Input id="r-headline" maxLength={160} data-path="basics.headline" value={b.headline} onChange={(e) => setBasics({ headline: e.target.value })} />
          </Field>
          <Field label="Email" htmlFor="r-email">
            <Input id="r-email" maxLength={200} type="email" data-path="basics.email" value={b.email} onChange={(e) => setBasics({ email: e.target.value })} autoComplete="email" />
          </Field>
          <Field label="Phone" htmlFor="r-phone">
            <Input id="r-phone" maxLength={60} type="tel" data-path="basics.phone" value={b.phone} onChange={(e) => setBasics({ phone: e.target.value })} autoComplete="tel" />
          </Field>
          <Field label="Location" htmlFor="r-location" hint="City, country (or Remote).">
            <Input id="r-location" maxLength={120} data-path="basics.location" value={b.location} onChange={(e) => setBasics({ location: e.target.value })} />
          </Field>
        </TwoCol>
        <div data-path="basics.links" tabIndex={-1} className="space-y-2 outline-none">
          <p className="text-sm font-medium">Links</p>
          {b.links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <Input aria-label={`Link ${i + 1} label`} maxLength={40} value={l.label} placeholder="LinkedIn" className="!w-32 shrink-0" onChange={(e) => setBasics({ links: b.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Input aria-label={`Link ${i + 1} URL`} maxLength={300} value={l.url} placeholder="linkedin.com/in/you" className="flex-1" onChange={(e) => setBasics({ links: b.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
              <IconButton label={`Remove link ${i + 1}`} onClick={() => setBasics({ links: b.links.filter((_, j) => j !== i) })}>
                <X className="h-4 w-4" />
              </IconButton>
            </div>
          ))}
          {b.links.length < 6 && (
            <Button variant="ghost" size="sm" onClick={() => setBasics({ links: [...b.links, { label: b.links.length ? "" : "LinkedIn", url: "" }] })}>
              <Plus className="h-3.5 w-3.5" /> Add link
            </Button>
          )}
        </div>
      </Section>

      <Section
        id="summary"
        title="Summary"
        action={
          onRewrite && (
            <Button size="sm" variant="ghost" onClick={() => onRewrite("basics.summary")}>
              <Sparkles className="h-3.5 w-3.5" /> {b.summary.trim() ? "Rewrite with AI" : "Write with AI"}
            </Button>
          )
        }
      >
        <Field label="2-3 sentences: who you are, your strongest skills, what you want next" htmlFor="r-summary">
          <Textarea id="r-summary" maxLength={1500} data-path="basics.summary" rows={4} spellCheck value={b.summary} onChange={(e) => setBasics({ summary: e.target.value })} className="scroll-mt-24" />
        </Field>
        <LineNotes path="basics.summary" text={b.summary} checks={checks} onRewrite={onRewrite} onSet={(summary) => setBasics({ summary })} />
        {summaryWords > 0 && (
          <p className={cx("text-xs", summaryWords < 25 || summaryWords > 90 ? "text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400")}>
            {summaryWords} words · aim for 25-90
          </p>
        )}
      </Section>

      <Section
        id="experience"
        title="Experience"
        action={
          <Button size="sm" variant="secondary" onClick={() => exp.set([{ id: newId(), title: "", company: "", location: "", start: "", end: "", current: false, bullets: [""] } as ResumeExperience, ...data.experience])} disabled={data.experience.length >= 20}>
            <Plus className="h-3.5 w-3.5" /> Add role
          </Button>
        }
      >
        {!data.experience.length && <p className="text-sm text-zinc-500 dark:text-zinc-400">Add your roles, most recent first. Internships and volunteering count.</p>}
        {data.experience.map((e, i) => (
          <div key={e.id} data-path={`experience.${e.id}`} tabIndex={-1} className="scroll-mt-24 space-y-3 rounded-xl border border-zinc-200 p-3 outline-none dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{[e.title, e.company].filter(Boolean).join(" at ") || "New role"}</p>
              <ItemTools
                i={i}
                n={data.experience.length}
                label="role"
                onMove={(by) => exp.set(move(data.experience, i, by))}
                onRemove={() => exp.set(data.experience.filter((x) => x.id !== e.id))}
                onDuplicate={data.experience.length < 20 ? () => exp.set(duplicateAt(data.experience, i)) : undefined}
              />
            </div>
            <TwoCol>
              <Field label="Job title" htmlFor={`t-${e.id}`}><Input id={`t-${e.id}`} maxLength={160} value={e.title} onChange={(ev) => exp.patch(e.id, { title: ev.target.value })} /></Field>
              <Field label="Company" htmlFor={`c-${e.id}`}><Input id={`c-${e.id}`} maxLength={160} value={e.company} onChange={(ev) => exp.patch(e.id, { company: ev.target.value })} /></Field>
              <Field label="Start" htmlFor={`s-${e.id}`}><Input id={`s-${e.id}`} maxLength={40} value={e.start} placeholder="Jan 2021" onChange={(ev) => exp.patch(e.id, { start: ev.target.value })} /></Field>
              <Field label="End" htmlFor={`e-${e.id}`}>
                <Input id={`e-${e.id}`} maxLength={40} value={e.current ? "" : e.end} placeholder={e.current ? "Present" : "Mar 2024"} disabled={e.current} onChange={(ev) => exp.patch(e.id, { end: ev.target.value })} />
              </Field>
              <Field label="Location" htmlFor={`l-${e.id}`}><Input id={`l-${e.id}`} maxLength={120} value={e.location} onChange={(ev) => exp.patch(e.id, { location: ev.target.value })} /></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <input type="checkbox" checked={e.current} onChange={(ev) => exp.patch(e.id, { current: ev.target.checked, end: ev.target.checked ? "" : e.end })} className="h-4 w-4 accent-indigo-600" />
                I work here now
              </label>
            </TwoCol>
            <Bullets path={`experience.${e.id}`} bullets={e.bullets} onChange={(bullets) => exp.patch(e.id, { bullets })} onRewrite={onRewrite} checks={checks} />
          </div>
        ))}
      </Section>

      <Section
        id="skills"
        title="Skills"
        action={
          <Button size="sm" variant="secondary" onClick={() => skills.set([...data.skills, { id: newId(), name: "", items: [] } as ResumeSkillGroup])} disabled={data.skills.length >= 10}>
            <Plus className="h-3.5 w-3.5" /> Add group
          </Button>
        }
      >
        {!data.skills.length && <p className="text-sm text-zinc-500 dark:text-zinc-400">Group them if you like: Languages, Tools, Methods.</p>}
        {data.skills.map((g, i) => (
          <div key={g.id} className="flex items-start gap-2">
            <Input aria-label="Group name" maxLength={60} value={g.name} placeholder="Tools" className="!w-32 shrink-0" onChange={(ev) => skills.patch(g.id, { name: ev.target.value })} />
            <div className="flex-1"><SkillItems id={`k-${g.id}`} items={g.items} onChange={(items) => skills.patch(g.id, { items })} /></div>
            <ItemTools i={i} n={data.skills.length} label="skill group" onMove={(by) => skills.set(move(data.skills, i, by))} onRemove={() => skills.set(data.skills.filter((x) => x.id !== g.id))} />
          </div>
        ))}
      </Section>

      <Section
        id="projects"
        title="Projects"
        action={
          <Button size="sm" variant="secondary" onClick={() => projects.set([...data.projects, { id: newId(), name: "", link: "", description: "", bullets: [] } as ResumeProject])} disabled={data.projects.length >= 10}>
            <Plus className="h-3.5 w-3.5" /> Add project
          </Button>
        }
      >
        {data.projects.map((p, i) => (
          <div key={p.id} data-path={`projects.${p.id}`} tabIndex={-1} className="space-y-3 rounded-xl border border-zinc-200 p-3 outline-none dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{p.name || "New project"}</p>
              <ItemTools
                i={i}
                n={data.projects.length}
                label="project"
                onMove={(by) => projects.set(move(data.projects, i, by))}
                onRemove={() => projects.set(data.projects.filter((x) => x.id !== p.id))}
                onDuplicate={data.projects.length < 10 ? () => projects.set(duplicateAt(data.projects, i)) : undefined}
              />
            </div>
            <TwoCol>
              <Field label="Name" htmlFor={`pn-${p.id}`}><Input id={`pn-${p.id}`} maxLength={160} value={p.name} onChange={(ev) => projects.patch(p.id, { name: ev.target.value })} /></Field>
              <Field label="Link" htmlFor={`pl-${p.id}`}><Input id={`pl-${p.id}`} maxLength={300} value={p.link} onChange={(ev) => projects.patch(p.id, { link: ev.target.value })} /></Field>
            </TwoCol>
            <Field label="Description" htmlFor={`pd-${p.id}`}>
              <Textarea id={`pd-${p.id}`} maxLength={600} data-path={`projects.${p.id}.description`} rows={2} value={p.description} onChange={(ev) => projects.patch(p.id, { description: ev.target.value })} />
            </Field>
            <Bullets path={`projects.${p.id}`} bullets={p.bullets} onChange={(bullets) => projects.patch(p.id, { bullets })} onRewrite={onRewrite} checks={checks} />
          </div>
        ))}
      </Section>

      <Section
        id="education"
        title="Education"
        action={
          <Button size="sm" variant="secondary" onClick={() => edu.set([...data.education, { id: newId(), school: "", degree: "", field: "", start: "", end: "", grade: "", details: "" } as ResumeEducation])} disabled={data.education.length >= 10}>
            <Plus className="h-3.5 w-3.5" /> Add education
          </Button>
        }
      >
        <p className="-mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {india
            ? "Most recent first. Students and freshers: add Class 12 and Class 10 as their own entries, with the board, the year and your percentage."
            : "Most recent first."}
        </p>
        {data.education.map((e, i) => (
          <div key={e.id} data-path={`education.${e.id}`} tabIndex={-1} className="scroll-mt-24 space-y-3 rounded-xl border border-zinc-200 p-3 outline-none dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{[e.degree, e.school].filter(Boolean).join(", ") || "New education"}</p>
              <ItemTools i={i} n={data.education.length} label="education" onMove={(by) => edu.set(move(data.education, i, by))} onRemove={() => edu.set(data.education.filter((x) => x.id !== e.id))} />
            </div>
            <TwoCol>
              <Field label="School, college or university" htmlFor={`es-${e.id}`}>
                <Input id={`es-${e.id}`} maxLength={160} value={e.school} placeholder={example.school} onChange={(ev) => edu.patch(e.id, { school: ev.target.value })} />
              </Field>
              <Field label={india ? "Degree or class" : "Degree"} htmlFor={`ed-${e.id}`}>
                <Input id={`ed-${e.id}`} maxLength={160} value={e.degree} placeholder={example.degree} onChange={(ev) => edu.patch(e.id, { degree: ev.target.value })} />
              </Field>
              <Field label="Field of study" htmlFor={`ef-${e.id}`}>
                <Input id={`ef-${e.id}`} maxLength={160} value={e.field} placeholder="Computer Science" onChange={(ev) => edu.patch(e.id, { field: ev.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start" htmlFor={`e1-${e.id}`}><Input id={`e1-${e.id}`} maxLength={40} value={e.start} placeholder="2021" onChange={(ev) => edu.patch(e.id, { start: ev.target.value })} /></Field>
                <Field label="End" htmlFor={`e2-${e.id}`}><Input id={`e2-${e.id}`} maxLength={40} value={e.end} placeholder="2025" onChange={(ev) => edu.patch(e.id, { end: ev.target.value })} /></Field>
              </div>
              <Field label={grade.label} htmlFor={`eg-${e.id}`} hint={grade.hint}>
                <Input id={`eg-${e.id}`} maxLength={60} value={e.grade ?? ""} placeholder={grade.placeholder} onChange={(ev) => edu.patch(e.id, { grade: ev.target.value })} />
              </Field>
            </TwoCol>
            <Field label="Details (optional)" htmlFor={`ex-${e.id}`} hint="Honours, rank, scholarships.">
              <Input id={`ex-${e.id}`} maxLength={600} value={e.details} onChange={(ev) => edu.patch(e.id, { details: ev.target.value })} />
            </Field>
          </div>
        ))}
      </Section>

      <Section
        id="certifications"
        title="Certifications"
        action={
          <Button size="sm" variant="secondary" onClick={() => certs.set([...data.certifications, { id: newId(), name: "", issuer: "", date: "" } as ResumeCertification])} disabled={data.certifications.length >= 20}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        }
      >
        {data.certifications.map((c, i) => (
          <div key={c.id} className="flex items-start gap-2">
            <div className="grid flex-1 gap-2 sm:grid-cols-3">
              <Input aria-label="Certification" maxLength={160} value={c.name} placeholder="AWS Solutions Architect" onChange={(ev) => certs.patch(c.id, { name: ev.target.value })} />
              <Input aria-label="Issuer" maxLength={160} value={c.issuer} placeholder="Amazon" onChange={(ev) => certs.patch(c.id, { issuer: ev.target.value })} />
              <Input aria-label="Date" maxLength={40} value={c.date} placeholder="2023" onChange={(ev) => certs.patch(c.id, { date: ev.target.value })} />
            </div>
            <ItemTools i={i} n={data.certifications.length} label="certification" onMove={(by) => certs.set(move(data.certifications, i, by))} onRemove={() => certs.set(data.certifications.filter((x) => x.id !== c.id))} />
          </div>
        ))}
      </Section>

      <Section id="extras" title="More sections">
        {data.extras.map((x, i) => (
          <ExtraEditor
            key={x.id}
            x={x}
            i={i}
            n={data.extras.length}
            onPatch={(patch) => extras.patch(x.id, patch)}
            onMove={(by) => extras.set(move(data.extras, i, by))}
            onRemove={() => removeExtra(x.id)}
          />
        ))}
        {data.extras.length < MAX_EXTRAS ? (
          <div>
            <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
              {data.extras.length ? "Add another:" : "Languages, awards, volunteering: add the ones that help you stand out."}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {extraPresets(country).filter((p) => !usedTitles.has(p.title.toLowerCase())).map((p) => (
                <Button key={p.title} size="sm" variant="secondary" onClick={() => addExtra(p.title, p.style, p.fill)}>
                  <Plus className="h-3.5 w-3.5" /> {p.title}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => addExtra("", "bullets")}>
                <Plus className="h-3.5 w-3.5" /> Custom section
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">That's the most extra sections a resume can have.</p>
        )}
      </Section>

      {order}
    </div>
  );
}
