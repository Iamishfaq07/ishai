/** The browser tab's title for each page ("Sessions · Orbit"). First match wins, so deeper paths come first. */
const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/$/, "Home"],
  [/^\/welcome/, "Welcome"],
  [/^\/warmup/, "Interview warm-up"],
  [/^\/start/, "New session"],
  [/^\/sessions\/[^/]+/, "Session"],
  [/^\/sessions/, "Sessions"],
  [/^\/resume-ai\/jobs(\/|$)/, "Jobs AI"], // Jobs' old address, on its way to Jobs AI
  [/^\/resume-ai/, "Resume AI"],
  [/^\/jobs\/alerts\/off/, "Stop job alerts"],
  [/^\/jobs(\/|$)/, "Jobs AI"],
  [/^\/documents\/stories/, "Story bank"],
  [/^\/documents\/evidence/, "Evidence vault"],
  [/^\/documents\/answers/, "My answers"],
  [/^\/documents/, "Documents"],
  [/^\/mock/, "Practice"],
  [/^\/billing/, "Billing"],
  [/^\/admin\/users/, "Users & access"],
  [/^\/admin\/payments/, "Payments"],
  [/^\/admin\/audit/, "Audit log"],
  [/^\/admin\/inbox/, "Inbox"],
  [/^\/admin\/support/, "Support"],
  [/^\/settings/, "Settings"],
  [/^\/live\//, "Live session"],
  [/^\/companion/, "Phone companion"],
  [/^\/contact/, "Contact us"],
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
  return ROUTE_TITLES.find(([re]) => re.test(pathname))?.[1] ?? null;
}

/** Descriptions for the pages people share or land on. Other pages keep whatever is already in the document. */
const ROUTE_DESCRIPTIONS: Array<[RegExp, string]> = [
  [/^\/$/, "Interview practice and live help, a resume checker with an ATS score, and new jobs that fit you. One free account. No subscription."],
  [/^\/resume-ai\/?$/, "An ATS score out of 100, what's missing for the job you want, and AI rewrites that keep your own numbers. Editing, the score and downloads are free."],
  [/^\/jobs\/?$/, "The latest openings from companies' careers pages, matched to your resume, with a tracker and free AI fit checks."],
  [/^\/warmup/, "Answer a common interview question by typing or speaking, and see what to improve straight away. Free, no account needed."],
  [/^\/contact/, "Questions, payments, a technical problem or a job that looks wrong: send the Orbit team a message."],
  [/^\/login/, "Sign in to Orbit to practise, fix your resume, and see jobs that fit you."],
  [/^\/register/, "Create a free Orbit account. No subscription. Interview practice, Resume AI and Jobs AI are included."],
  [/^\/billing/, "Buy interview minutes and Resume AI credits once. Nothing renews, and what you buy never expires."],
];

export function routeDescription(pathname: string): string | null {
  return ROUTE_DESCRIPTIONS.find(([re]) => re.test(pathname))?.[1] ?? null;
}
