import type { ReactNode } from "react";
import type { DocumentKind, SessionType } from "@orbit/types";
import { Briefcase, FileIcon, FileText, NotebookPen, cx, type LucideIcon } from "@orbit/ui";
import { SESSION_TYPE_ICON } from "./sessionIcons";

/**
 * Small pieces the desktop screens share (DESIGN.md "The desktop app"): a session's type mark, a document's kind
 * mark, a review score, and a section's heading.
 */

/** A session's type as a small icon tile: mock interviews in Practice's orange, the rest the copilot's colour. */
export function TypeMark({ type, size = "md" }: { type: SessionType; size?: "sm" | "md" }) {
  const Icon = SESSION_TYPE_ICON[type];
  return (
    <span
      aria-hidden="true"
      className={cx(
        "flex shrink-0 items-center justify-center ring-1 ring-inset",
        size === "sm" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl",
        type === "mock"
          ? "bg-orange-50 text-orange-700 ring-orange-600/15 dark:bg-orange-400/10 dark:text-orange-200 dark:ring-orange-300/20"
          : "bg-indigo-50 text-indigo-700 ring-indigo-600/15 dark:bg-indigo-400/10 dark:text-indigo-200 dark:ring-indigo-300/20",
      )}
    >
      <Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    </span>
  );
}

// Each kind of document's icon and colour (the same as the web app's): a resume green, a job description blue, notes
// amber. Decorative: the words beside it name the kind.
const KIND_MARK: Record<DocumentKind, { icon: LucideIcon; tile: string }> = {
  resume: { icon: FileText, tile: "bg-emerald-500/15 text-emerald-800 ring-emerald-600/25 dark:bg-emerald-400/15 dark:text-emerald-200 dark:ring-emerald-300/20" },
  job_description: { icon: Briefcase, tile: "bg-sky-500/15 text-sky-800 ring-sky-600/25 dark:bg-sky-400/15 dark:text-sky-200 dark:ring-sky-300/20" },
  notes: { icon: NotebookPen, tile: "bg-amber-500/15 text-amber-800 ring-amber-600/25 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20" },
  other: { icon: FileIcon, tile: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10" },
};

export const KIND_LABEL: Record<DocumentKind, string> = {
  resume: "Resume",
  job_description: "Job description",
  notes: "Notes",
  other: "Other",
};

export function KindMark({ kind, size = "md" }: { kind: DocumentKind; size?: "sm" | "md" }) {
  const { icon: Icon, tile } = KIND_MARK[kind];
  return (
    <span
      aria-hidden="true"
      className={cx("flex shrink-0 items-center justify-center ring-1", size === "sm" ? "h-7 w-7 rounded-md" : "h-9 w-9 rounded-lg", tile)}
    >
      <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </span>
  );
}

/** A review's overall score (1–5) as a small ring, coloured by how it went, with its scale for screen readers. */
export function ScorePip({ score }: { score: number }) {
  const r = 11;
  const circ = 2 * Math.PI * r;
  const tone = score >= 4 ? "stroke-emerald-500" : score === 3 ? "stroke-indigo-500" : "stroke-amber-500";
  return (
    <span role="img" aria-label={`Review score ${score} out of 5`} title={`Review score ${score}/5`} className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center">
      <svg viewBox="0 0 28 28" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="14" cy="14" r={r} fill="none" strokeWidth="3" className="stroke-zinc-200 dark:stroke-white/10" />
        <circle cx="14" cy="14" r={r} fill="none" strokeWidth="3" strokeLinecap="round" className={tone} strokeDasharray={circ} strokeDashoffset={circ * (1 - score / 5)} />
      </svg>
      <span aria-hidden="true" className="stat-value text-xs font-semibold">
        {score}
      </span>
    </span>
  );
}

/** A section's heading: its spot or icon, its title, a line, and its actions at the end. */
export function SectionTitle({ art, title, line, id, actions, as: Tag = "h2" }: { art?: ReactNode; title: string; line?: ReactNode; id?: string; actions?: ReactNode; as?: "h2" | "h3" }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      {art}
      <div className="min-w-0 flex-1">
        <Tag id={id} className="text-[15px] font-semibold tracking-tight">
          {title}
        </Tag>
        {line && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{line}</p>}
      </div>
      {actions}
    </div>
  );
}
