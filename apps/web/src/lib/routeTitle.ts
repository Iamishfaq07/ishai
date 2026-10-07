/** The browser tab's title for each page ("Sessions · Orbit"). First match wins, so deeper paths come first. */
const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/$/, "Home"],
  [/^\/welcome/, "Welcome"],
  [/^\/warmup/, "Practice question"],
  [/^\/start/, "New session"],
  [/^\/sessions\/[^/]+/, "Session"],
  [/^\/sessions/, "Sessions"],
  [/^\/resume-ai\/jobs(\/|$)/, "Jobs AI"], // Jobs' old address, on its way to Jobs AI
  [/^\/resume-ai/, "Resume AI"],
  [/^\/jobs(\/|$)/, "Jobs AI"],
  [/^\/documents\/stories/, "Story bank"],
  [/^\/documents/, "Documents"],
  [/^\/mock/, "Practice"],
  [/^\/billing/, "Billing"],
  [/^\/admin\/users/, "Users & access"],
  [/^\/admin\/payments/, "Payments"],
  [/^\/admin\/audit/, "Audit log"],
  [/^\/settings/, "Settings"],
  [/^\/live\//, "Live session"],
  [/^\/companion/, "Phone companion"],
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
