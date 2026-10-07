import type { ProductId } from "./onboarding";

/**
 * The command palette's search (Ctrl+K, components/CommandPalette.tsx): pages, actions and recent things, matched by
 * title, by the words people actually type ("cv", "jd", "upi") and by loose spelling, best first. Pure, so it's
 * unit-tested (palette.test.ts) and the palette's own code stays a lazy chunk.
 */

export type CommandGroup = "Recent" | "Actions" | "Go to";

export interface Command {
  id: string;
  title: string;
  group: CommandGroup;
  /** A second line ("Resume AI · ATS 72"). Searched too. */
  hint?: string;
  /** Other words for it: synonyms, abbreviations, what it's for. Searched, never shown. */
  keywords?: string[];
  product?: ProductId;
  /** An address to open, or an action the palette runs (`run`). */
  to?: string;
  run?: "help" | "theme" | "sign-out";
}

/** The groups' order on screen. Recent things lead once there's a query that matches them. */
const GROUP_ORDER: Record<CommandGroup, number> = { Recent: 0, Actions: 1, "Go to": 2 };

/** Lower case, accents off, punctuation to spaces: "Résumé AI!" → "resume ai". */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9₹]+/g, " ")
    .trim();
}

function words(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

/** Every letter of `needle`, in order, somewhere in `hay` (for typos like "trakcer" it won't; "trckr" it will). */
function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

/** How well one query word matches a command; 0 is no match. */
function tokenScore(token: string, title: string[], titleText: string, extra: string[], extraText: string): number {
  if (title[0]?.startsWith(token)) return 100;
  if (title.some((w) => w.startsWith(token))) return 80;
  if (extra.some((w) => w === token)) return 70;
  if (extra.some((w) => w.startsWith(token))) return 60;
  if (titleText.includes(token)) return 40;
  if (extraText.includes(token)) return 30;
  // Loose spelling, word by word ("trckr" finds "tracker"); across the whole title it matched nonsense ("trac" in
  // "sTaRt A moCk").
  if (token.length >= 3 && title.some((w) => w[0] === token[0] && isSubsequence(token, w))) return 10;
  return 0;
}

/** A command's score for a query; 0 when any word of the query matches nothing. */
export function scoreCommand(query: string, command: Command): number {
  const tokens = words(query);
  if (tokens.length === 0) return 1;
  const title = words(command.title);
  const titleText = title.join(" ");
  const extra = [...words(command.hint ?? ""), ...(command.keywords ?? []).flatMap(words)];
  const extraText = extra.join(" ");
  let total = 0;
  for (const token of tokens) {
    const s = tokenScore(token, title, titleText, extra, extraText);
    if (s === 0) return 0;
    total += s;
  }
  // The whole query as typed, at the start of the title ("start l" → "Start a live session"), wins ties.
  if (titleText.startsWith(normalize(query))) total += 25;
  return total;
}

/**
 * The commands to show for a query, best first, at most `limit`. With no query: everything in group order (Recent,
 * then Actions, then Go to) as listed. Ties keep the listed order, so the caller decides what comes first.
 */
export function searchCommands(query: string, commands: Command[], limit = 40): Command[] {
  const indexed = commands.map((command, index) => ({ command, index, score: scoreCommand(query, command) }));
  const hits = indexed.filter((x) => x.score > 0);
  if (!normalize(query)) {
    hits.sort((a, b) => GROUP_ORDER[a.command.group] - GROUP_ORDER[b.command.group] || a.index - b.index);
  } else {
    hits.sort((a, b) => b.score - a.score || GROUP_ORDER[a.command.group] - GROUP_ORDER[b.command.group] || a.index - b.index);
  }
  return hits.slice(0, limit).map((x) => x.command);
}

/** The pages and actions the palette always has. Practice only when mock interviews are on in this build. */
export function baseCommands({ mockEnabled }: { mockEnabled: boolean }): Command[] {
  const practice: Command[] = mockEnabled
    ? [
        {
          id: "do-mock",
          title: "Start a mock interview",
          group: "Actions",
          product: "interview",
          to: "/mock",
          keywords: ["practice", "practise", "mock", "hr round", "interview", "rehearse", "score"],
        },
      ]
    : [];
  return [
    ...practice,
    {
      id: "do-warmup",
      title: "Answer a practice question",
      group: "Actions",
      product: "interview",
      to: "/warmup",
      keywords: ["warm up", "warmup", "question", "tell me about yourself", "free", "practice"],
    },
    {
      id: "do-live",
      title: "Start a live session",
      group: "Actions",
      product: "interview",
      to: "/start",
      keywords: ["copilot", "live", "call", "meeting", "coding", "interview help", "new session"],
    },
    {
      id: "do-resume",
      title: "Make or import a resume",
      group: "Actions",
      product: "resume",
      to: "/resume-ai",
      keywords: ["cv", "new resume", "import", "upload", "ats", "build"],
    },
    {
      id: "do-jobs",
      title: "Find jobs for me",
      group: "Actions",
      product: "jobs",
      to: "/jobs/matches",
      keywords: ["matches", "openings", "vacancy", "naukri", "linkedin", "search jobs", "fresher jobs"],
    },
    {
      id: "do-story",
      title: "Write a story for behavioural questions",
      group: "Actions",
      product: "interview",
      to: "/documents/stories",
      keywords: ["star", "tell me about a time", "story bank", "example"],
    },
    {
      id: "do-credits",
      title: "Buy credits",
      group: "Actions",
      to: "/billing",
      keywords: ["upi", "pay", "payment", "pack", "price", "minutes", "plan", "billing", "₹", "rupees", "utr"],
    },
    { id: "do-help", title: "Get help", group: "Actions", run: "help", keywords: ["support", "contact", "whatsapp", "email", "faq", "question", "glossary"] },
    { id: "do-theme", title: "Switch light or dark theme", group: "Actions", run: "theme", keywords: ["dark mode", "light mode", "appearance", "colour", "color"] },
    { id: "go-home", title: "Home", group: "Go to", to: "/", keywords: ["next step", "dashboard", "start", "checklist"] },
    ...(mockEnabled
      ? [{ id: "go-practice", title: "Practice", group: "Go to" as const, product: "interview" as const, to: "/mock", keywords: ["mock", "progress", "prep", "interview"] }]
      : []),
    { id: "go-sessions", title: "Sessions", group: "Go to", product: "interview", to: "/sessions", keywords: ["history", "transcripts", "reports", "interview"] },
    { id: "go-stories", title: "Story bank", group: "Go to", product: "interview", to: "/documents/stories", keywords: ["stories", "star", "behavioural"] },
    {
      id: "go-documents",
      title: "Documents",
      group: "Go to",
      product: "interview",
      to: "/documents",
      keywords: ["files", "uploads", "jd", "job description", "job post", "resume file"],
    },
    { id: "go-resume-ai", title: "Resume AI", group: "Go to", product: "resume", to: "/resume-ai", keywords: ["cv", "resumes", "ats score", "cover letter"] },
    { id: "go-jobs", title: "Jobs AI", group: "Go to", product: "jobs", to: "/jobs", keywords: ["jobs overview", "careers"] },
    { id: "go-matches", title: "Job matches", group: "Go to", product: "jobs", to: "/jobs/matches", keywords: ["feed", "openings", "match"] },
    { id: "go-tracker", title: "Job tracker", group: "Go to", product: "jobs", to: "/jobs/tracker", keywords: ["applications", "applied", "saved jobs", "follow up", "kanban"] },
    { id: "go-job-profile", title: "Job search profile", group: "Go to", product: "jobs", to: "/jobs/profile", keywords: ["preferences", "city", "role", "filters", "location"] },
    { id: "go-billing", title: "Plan and credits", group: "Go to", to: "/billing", keywords: ["billing", "upi", "payments", "balance", "minutes left", "credits left"] },
    { id: "go-settings", title: "Settings", group: "Go to", to: "/settings", keywords: ["account", "password", "privacy", "delete account", "appearance", "accent", "text size"] },
    { id: "do-sign-out", title: "Sign out", group: "Actions", run: "sign-out", keywords: ["log out", "logout"] },
  ];
}

export interface RecentSources {
  resumes?: Array<{ id: string; title: string; score: number }> | null;
  sessions?: Array<{ id: string; title: string; status: string }> | null;
  tracker?: Array<{ id: string; listing_id: string; company: string; title: string; status: string }> | null;
}

/** Up to five of each: the resumes, sessions and tracked jobs, newest first as the API lists them. */
export function recentCommands({ resumes, sessions, tracker }: RecentSources): Command[] {
  const out: Command[] = [];
  for (const r of (resumes ?? []).slice(0, 5)) {
    out.push({ id: `resume-${r.id}`, title: r.title || "Untitled resume", hint: `Resume AI · ATS score ${r.score}`, group: "Recent", product: "resume", to: `/resume-ai/${encodeURIComponent(r.id)}`, keywords: ["resume", "cv"] });
  }
  for (const s of (sessions ?? []).slice(0, 5)) {
    const ended = s.status === "ended";
    out.push({
      id: `session-${s.id}`,
      title: s.title || "Session",
      hint: ended ? "Session report" : "Unfinished session",
      group: "Recent",
      product: "interview",
      to: ended ? `/sessions/${encodeURIComponent(s.id)}` : `/live/${encodeURIComponent(s.id)}`,
      keywords: ["session", "interview"],
    });
  }
  for (const t of (tracker ?? []).slice(0, 5)) {
    // A job added by hand isn't in the feed: it opens on the tracker.
    const external = t.listing_id.startsWith("ext:");
    out.push({
      id: `job-${t.id}`,
      title: `${t.title} at ${t.company}`,
      hint: `Tracker · ${t.status.charAt(0).toUpperCase()}${t.status.slice(1)}`,
      group: "Recent",
      product: "jobs",
      to: external ? "/jobs/tracker" : `/jobs/listing/${encodeURIComponent(t.listing_id)}`,
      keywords: ["job", "application", t.company],
    });
  }
  return out;
}
