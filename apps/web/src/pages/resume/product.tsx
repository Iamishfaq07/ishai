import { NavLink } from "react-router-dom";
import { FileText, FileUp, Gauge, GraduationCap, Mail, MessagesSquare, Send, Wand2, cx, focusRing, type LucideIcon } from "@orbit/ui";
import { RESUME_AI_HOME } from "./paths";

/**
 * Orbit Resume AI, Orbit's second product next to the interview copilot: what marks it in the app (the "AI" pill),
 * what its AI does (the product home and the public page list the same things), and its own pages. Light on
 * purpose: the main nav, Home and the sign-in screens import it.
 */

/** The small gradient "AI" tag after "Resume" in the nav and on the product's cards and headings. */
export function AiPill({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-[5px] bg-gradient-to-r from-indigo-600 to-aurora-600 px-1 py-px text-[0.625rem] font-bold leading-[0.875rem] tracking-wide text-white shadow-sm",
        className,
      )}
    >
      AI
    </span>
  );
}

/** One thing the AI does: `short` for the chips on the product home, `text` for the public page. */
export interface ResumeAiFeature {
  icon: LucideIcon;
  short: string;
  title: string;
  text: string;
}

/**
 * Only what Resume AI really does today, in the order people need it. One line per feature, so the Jobs portal
 * ("Jobs matched to your resume") adds itself here when it lands.
 */
export const RESUME_AI_FEATURES: ResumeAiFeature[] = [
  {
    icon: Gauge,
    short: "ATS score + keyword match",
    title: "ATS score and keyword match",
    text: "A score out of 100, read the way screening software reads it, with the job post's keywords you're missing and a fix for every point.",
  },
  {
    icon: Wand2,
    short: "AI rewrite, tailored to a job",
    title: "AI rewrites for every job",
    text: "Stronger bullets and a summary for the job you're applying to. You see each change first and keep only the ones you want.",
  },
  {
    icon: FileUp,
    short: "AI import: PDF, Word, LinkedIn",
    title: "Import what you have",
    text: "Upload your old resume as a PDF or Word file, or LinkedIn's \"Save to PDF\", and it's read into sections you can edit.",
  },
  {
    icon: MessagesSquare,
    short: "Interview prep from your resume",
    title: "Interview prep from your resume",
    text: "The questions your resume will get you asked, the skills the job wants that it doesn't show yet, and a mock interview to practise.",
  },
  {
    icon: GraduationCap,
    short: "Campus / fresher mode",
    title: "Campus and fresher mode",
    text: "One page for placements: education first with your CGPA, then projects, internships and positions of responsibility.",
  },
  {
    icon: Mail,
    short: "Cover letters",
    title: "Cover letters",
    text: "Written from your resume and the job post, in the tone and length you choose.",
  },
  {
    icon: Send,
    short: "Naukri + LinkedIn profiles, outreach",
    title: "Naukri and LinkedIn profiles, and outreach",
    text: "Headlines and summaries that fit each site's limits, plus referral requests, emails to HR, follow-ups and thank-you notes.",
  },
];

/**
 * Resume AI's own pages, as tabs under its header once there's more than one. The Jobs portal adds
 * `{ to: RESUME_AI_JOBS, label: "Jobs", icon: Briefcase }` here when its page is mounted at /resume-ai/jobs.
 */
export const RESUME_AI_SECTIONS: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: RESUME_AI_HOME, label: "My resumes", icon: FileText, end: true },
];

/** The tabs between Resume AI's pages. Nothing while it has only the one. */
export function ResumeAiTabs() {
  if (RESUME_AI_SECTIONS.length < 2) return null;
  const tab = ({ isActive }: { isActive: boolean }) =>
    cx(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3",
      isActive
        ? "bg-white text-zinc-900 shadow-sm dark:bg-white/10 dark:text-white"
        : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white",
      focusRing,
    );
  return (
    <nav aria-label="Resume AI" className="mb-6 inline-flex gap-1 rounded-xl bg-zinc-500/10 p-1">
      {RESUME_AI_SECTIONS.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={tab}>
          <Icon className="hidden h-4 w-4 sm:block" aria-hidden="true" /> {label}
        </NavLink>
      ))}
    </nav>
  );
}

/** The colour of an ATS score, from red (needs work) to green (passes). */
export function scoreTone(score: number): string {
  return score >= 80
    ? "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300"
    : score >= 65
      ? "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300"
      : score >= 45
        ? "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300"
        : "bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300";
}
