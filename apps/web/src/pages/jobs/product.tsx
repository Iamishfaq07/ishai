import {
  BookmarkCheck,
  Building2,
  Gauge,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Target,
  Wand2,
  INDIA,
  isIndia,
  regionWords,
  type LucideIcon,
} from "@orbit/ui";

/**
 * Orbit Jobs AI, Orbit's third product next to the interview copilot and Resume AI: what it does (its home and the
 * public page list the same things) and its own pages. Light on purpose: Home imports it.
 */

/** One thing Jobs AI does: `short` for the chips on its home, `text` for the public page. */
export interface JobsAiFeature {
  icon: LucideIcon;
  short: string;
  title: string;
  text: string;
}

/** Only what Jobs AI really does today, in the order people need it (as written for India; jobsAiFeatures words it for
 *  everywhere else). */
export const JOBS_AI_FEATURES: JobsAiFeature[] = [
  {
    icon: Gauge,
    short: "Match % for every job",
    title: "Matched to your resume",
    text: "Every job gets a match score from your titles, skills, experience and city, with the skills you have and the ones it asks for that your resume doesn't show.",
  },
  {
    icon: Sparkles,
    short: "Free AI fit check",
    title: "A free AI fit check",
    text: "Strong, good or a stretch: why you fit, the gaps, and honest tweaks to your resume. Based only on what your resume says.",
  },
  {
    icon: Building2,
    short: "Straight from career pages",
    title: "Straight from the source",
    text: "Companies' own career pages and remote job boards that allow it. Apply opens the original post, and every job says where it came from.",
  },
  {
    icon: Search,
    short: "Search LinkedIn, Naukri and more",
    title: "The big job sites too",
    text: "LinkedIn, Naukri, Indeed and more, opened with your search already filled in. Orbit doesn't copy their listings.",
  },
  {
    icon: SlidersHorizontal,
    short: "Your filters",
    title: "Your search, your way",
    text: "The AI reads your resume into titles, skills and cities. Change any of it, and pick the work mode, job types, how recent, and words to leave out.",
  },
  {
    icon: BookmarkCheck,
    short: "Application tracker",
    title: "Track every application",
    text: "Saved, applied, interviewing, offer: a board with notes and dates, so no application slips.",
  },
  {
    icon: Wand2,
    short: "Tailor your resume per job",
    title: "Tailor your resume for a job",
    text: "A copy of your resume aimed at the job, opened in Resume AI, where you see every change before you keep it.",
  },
  {
    icon: Send,
    short: "Outreach + Naukri, LinkedIn profiles",
    title: "Outreach that gets replies",
    text: "Referral requests, emails to HR, follow-ups and thank-you notes for each job, and your Naukri and LinkedIn profiles, written from your resume.",
  },
  {
    icon: Target,
    short: "Interview prep per job",
    title: "Prepare for the interview",
    text: "The job description saved for Practice: the questions that job is likely to ask, and a mock interview on them.",
  },
];

/** What Jobs AI does, for where the user applies: Naukri is India's, and outside India outreach writes to recruiters. */
export function jobsAiFeatures(country: string = INDIA): JobsAiFeature[] {
  if (isIndia(country)) return JOBS_AI_FEATURES;
  return JOBS_AI_FEATURES.map((f) => {
    if (f.icon === Search) {
      return { ...f, short: "Search LinkedIn, Indeed and more", text: "LinkedIn, Indeed and more, opened with your search already filled in. Orbit doesn't copy their listings." };
    }
    if (f.icon === Send) {
      return {
        ...f,
        short: "Outreach + LinkedIn profile",
        text: `Referral requests, ${regionWords(country).coldEmails}, follow-ups and thank-you notes for each job, and your LinkedIn profile, written from your resume.`,
      };
    }
    return f;
  });
}
