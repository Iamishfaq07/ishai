import { FileText, FileUp, Gauge, GraduationCap, INDIA, Mail, MessagesSquare, Wand2, gradeCopy, isIndia, type LucideIcon } from "@orbit/ui";
import { ProductTabs, type ProductSection } from "../../components/products";
import { RESUME_AI_HOME } from "./paths";

/**
 * Orbit Resume, one of Orbit's products next to the interview copilot and Jobs: what its AI does (the product
 * home and the public page list the same things) and its own pages. Light on purpose: Home imports it.
 */

/** One thing the AI does: `short` for the chips on the product home, `text` for the public page. */
export interface ResumeAiFeature {
  icon: LucideIcon;
  short: string;
  title: string;
  text: string;
}

/**
 * Only what Resume really does today, in the order people need it. Finding jobs, and the outreach messages and the
 * Naukri and LinkedIn profiles written from a resume, are Jobs's (pages/jobs). India's as written; resumeAiFeatures
 * words the student resume for everywhere else.
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
];

/** What Resume does, worded for where the user applies: outside India the campus mode is for new graduates. */
export function resumeAiFeatures(country: string = INDIA): ResumeAiFeature[] {
  if (isIndia(country)) return RESUME_AI_FEATURES;
  return RESUME_AI_FEATURES.map((f) =>
    f.icon === GraduationCap
      ? {
          ...f,
          short: "Student / new grad mode",
          title: "Student and new grad mode",
          text: `One page for graduate jobs and internships: education first with your ${gradeCopy(country).word}, then projects, internships and leadership roles.`,
        }
      : f,
  );
}

/** Resume's own pages, as tabs under its header once there's more than one. */
export const RESUME_AI_SECTIONS: ProductSection[] = [{ to: RESUME_AI_HOME, label: "My resumes", icon: FileText, end: true }];

/** The tabs between Resume's pages. Nothing while it has only the one. */
export function ResumeAiTabs() {
  return <ProductTabs label="Resume" sections={RESUME_AI_SECTIONS} />;
}

/** The colour of an ATS score, from red (needs work) to green (passes). */
export function scoreTone(score: number): string {
  return score >= 80
    ? "bg-emerald-500/10 text-emerald-800 ring-emerald-500/25 dark:text-emerald-300"
    : score >= 65
      ? "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300"
      : score >= 45
        ? "bg-amber-500/10 text-amber-800 ring-amber-500/25 dark:text-amber-300"
        : "bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300";
}
