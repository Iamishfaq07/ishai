import { guideTitle } from "../pages/bank/names";

/** The browser tab's title for each page ("Sessions · Orbit"). First match wins, so deeper paths come first. */
const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/$/, "Today"],
  [/^\/career\/?$/, "My Career"],
  [/^\/prepare\/?$/, "Prepare"],
  [/^\/tools(\/|$)/, "Explore Orbit tools"],
  [/^\/jobs\/journey/, "Application agent"],
  [/^\/welcome/, "Welcome"],
  [/^\/warmup/, "Interview warm-up"],
  [/^\/companies(\/|$)/, "Company interview guides"],
  [/^\/roles(\/|$)/, "Interview guides by role"],
  [/^\/guides(\/|$)/, "Interview guides"],
  [/^\/start/, "New session"],
  [/^\/sessions\/[^/]+/, "Session"],
  [/^\/sessions/, "Sessions"],
  [/^\/resume-ai\/jobs(\/|$)/, "Jobs"], // Jobs' old address, on its way to Jobs
  [/^\/resume-ai/, "Resume"],
  [/^\/jobs\/alerts\/off/, "Stop job alerts"],
  [/^\/jobs\/auto-apply/, "Orbit Apply setup"],
  [/^\/jobs\/applications/, "Applications"],
  [/^\/jobs(\/|$)/, "Jobs"],
  [/^\/offers(\/|$)/, "Offers"],
  [/^\/linkedin(\/|$)/, "LinkedIn"],
  [/^\/code(\/|$)/, "Coding practice"],
  [/^\/learn(\/|$)/, "Learning"],
  [/^\/documents\/stories/, "Story bank"],
  [/^\/documents\/evidence/, "Evidence vault"],
  [/^\/documents\/answers/, "My answers"],
  [/^\/documents/, "Documents"],
  [/^\/mock(\/|$)/, "Practice"], // not /mock-interview, the public page
  [/^\/billing/, "Billing"],
  [/^\/admin\/users/, "Users & access"],
  [/^\/admin\/payments/, "Payments"],
  [/^\/admin\/audit/, "Audit log"],
  [/^\/admin\/inbox/, "Inbox"],
  [/^\/admin\/support/, "Support"],
  [/^\/settings/, "Settings"],
  [/^\/extension\/connect/, "Connect the extension"],
  [/^\/interview$/, "AI video interview"],
  [/^\/live\//, "Live session"],
  [/^\/companion/, "Phone companion"],
  [/^\/contact/, "Contact us"],
  [/^\/technical/, "How Orbit works"],
  [/^\/pricing/, "Pricing"],
  [/^\/interview-copilot/, "Interview copilot"],
  [/^\/mock-interview/, "Mock interviews"],
  [/^\/linkedin-ai/, "LinkedIn"],
  [/^\/login/, "Sign in"],
  [/^\/register/, "Create account"],
  [/^\/forgot-password/, "Reset password"],
  [/^\/reset-password/, "Reset password"],
  [/^\/verify-email/, "Verify email"],
  [/^\/confirm-email-change/, "Confirm email"],
];

/** Signed out, "/" is the front page, which says what Orbit is instead of "Home". */
const FRONT_PAGE = "Practise interviews, fix your resume, find jobs";

export function routeTitle(pathname: string, signedOut = false): string | null {
  if (signedOut && pathname === "/") return FRONT_PAGE;
  const guide = guideTitle(pathname);
  if (guide) return guide;
  return ROUTE_TITLES.find(([re]) => re.test(pathname))?.[1] ?? null;
}

/** Descriptions for the pages people share or land on. Other pages keep whatever is already in the document. */
const ROUTE_DESCRIPTIONS: Array<[RegExp, string]> = [
  [/^\/tools(\/|$)/, "Find AI resume tools, hosted applications, interview practice and hiring automations. Explore Personal and Business workflows step by step."],
  [/^\/$/, "Interview practice and live help, a resume checker with an ATS score, and new jobs that fit you. One free account. No subscription."],
  [/^\/resume-ai\/?$/, "An ATS score out of 100, what's missing for the job you want, and AI rewrites that keep your own numbers. Editing, the score and downloads are free."],
  [/^\/jobs\/?$/, "The latest openings from companies' careers pages, matched to your resume, with a tracker and free AI fit checks."],
  [/^\/warmup/, "Practise interview questions out loud or by typing and get instant tips. A free alternative to Google's Interview Warmup, no account needed."],
  [/^\/contact/, "Questions, payments, a technical problem or a job that looks wrong: send the Orbit team a message."],
  [/^\/technical/, "Live latency, the answer pipeline, and how the desktop app keeps your data safe."],
  [/^\/pricing/, "Plans and credit packs in rupees and US dollars. Start free, pay once, nothing renews."],
  [/^\/interview-copilot/, "Live interview answers from your resume, in calls where AI help is allowed."],
  [/^\/mock-interview/, "Mock interviews with an AI interviewer: follow-ups, a video round and a scorecard."],  [/^\/login/, "Sign in to Orbit to practise, fix your resume, and see jobs that fit you."],
  [/^\/register/, "Create a free Orbit account. No subscription. Interview practice, Resume and Jobs are included."],
  [/^\/billing/, "Buy interview minutes and Resume credits once. Nothing renews, and what you buy never expires."],
];

export function routeDescription(pathname: string): string | null {
  return ROUTE_DESCRIPTIONS.find(([re]) => re.test(pathname))?.[1] ?? null;
}
