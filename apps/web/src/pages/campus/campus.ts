/**
 * Campus placements: the drives a college's placement cell announces (company, date, CTC, cut-offs, rounds), each
 * checked against the student's own marks, with a countdown and the prep for every round it has. The early-career
 * job lists trending on GitHub (new-grad and internship trackers) cover off-campus roles; this covers the on-campus
 * season. Everything is typed by the student and stays on the device.
 */

export const ROUNDS = [
  { id: "aptitude", label: "Online aptitude test", to: "/aptitude", prep: "Timed quant, reasoning and verbal practice" },
  { id: "coding", label: "Coding test", to: "/code", prep: "Practise problems in the editor" },
  { id: "gd", label: "Group discussion", to: "/group-discussion", prep: "Timed GD practice with both sides' points" },
  { id: "technical", label: "Technical interview", to: "/mock", prep: "Mock interview on your subjects and projects" },
  { id: "hr", label: "HR interview", to: "/star-check", prep: "STAR answers, plus tell me about yourself" },
] as const;
export type RoundId = typeof ROUNDS[number]["id"];

export type DriveStatus = "upcoming" | "applied" | "shortlisted" | "selected" | "not-selected" | "skipped";
export const STATUSES: { id: DriveStatus; label: string }[] = [
  { id: "upcoming", label: "Upcoming" }, { id: "applied", label: "Registered" }, { id: "shortlisted", label: "Shortlisted" },
  { id: "selected", label: "Selected" }, { id: "not-selected", label: "Not selected" }, { id: "skipped", label: "Skipped" },
];

export interface Drive {
  id: string; company: string; role: string; date: string; ctc: string;
  minCgpa: number | null; min10: number | null; min12: number | null; maxBacklogs: number | null;
  branches: string; rounds: RoundId[]; status: DriveStatus; done: RoundId[];
}
export interface Marks { cgpa: number | null; tenth: number | null; twelfth: number | null; backlogs: number | null; branch: string }

export interface Eligibility { ok: boolean | null; reasons: string[] }

/** Each cut-off the student's marks fail, or null when a needed mark isn't entered yet. */
export function eligibility(d: Drive, m: Marks): Eligibility {
  const reasons: string[] = [];
  let unknown = false;
  const check = (cut: number | null, mine: number | null, label: string, below = true) => {
    if (cut === null) return;
    if (mine === null) { unknown = true; return; }
    if (below ? mine < cut : mine > cut) reasons.push(below ? `${label} ${mine} is below the ${cut} cut-off` : `${mine} active backlog${mine === 1 ? "" : "s"}; at most ${cut} allowed`);
  };
  check(d.minCgpa, m.cgpa, "CGPA");
  check(d.min10, m.tenth, "10th", true);
  check(d.min12, m.twelfth, "12th", true);
  check(d.maxBacklogs, m.backlogs, "Backlogs", false);
  const allowed = d.branches.split(",").map((b) => b.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes("all")) {
    if (!m.branch.trim()) unknown = true;
    else if (!allowed.some((b) => m.branch.trim().toLowerCase() === b || m.branch.trim().toLowerCase().includes(b))) reasons.push(`Open to ${d.branches.trim()}, not ${m.branch.trim()}`);
  }
  return { ok: reasons.length ? false : unknown ? null : true, reasons };
}

/** Whole days from today to the drive (negative once it's past); null without a date. */
export function daysTo(date: string, now = new Date()): number | null {
  const t = Date.parse(`${date}T00:00:00`);
  if (Number.isNaN(t)) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((t - today) / 86_400_000);
}

export function newDrive(id: string): Drive {
  return { id, company: "", role: "", date: "", ctc: "", minCgpa: null, min10: null, min12: null, maxBacklogs: null, branches: "", rounds: ["aptitude", "technical", "hr"], status: "upcoming", done: [] };
}

/** Drives in the order to act on: upcoming soonest first, then the rest by date, newest first. */
export function ordered(drives: Drive[], now = new Date()): Drive[] {
  const live = (d: Drive) => ["upcoming", "applied", "shortlisted"].includes(d.status) && (daysTo(d.date, now) ?? 0) >= 0;
  return [...drives].sort((a, b) => {
    const la = live(a), lb = live(b);
    if (la !== lb) return la ? -1 : 1;
    const da = daysTo(a.date, now) ?? 9999, db = daysTo(b.date, now) ?? 9999;
    return la ? da - db : db - da;
  });
}
