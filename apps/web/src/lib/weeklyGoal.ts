// The weekly practice goal (Practice → Your progress): "3 this week", counted from mock interviews and warm-up answers,
// with weeks in a row and a freeze, so one missed week doesn't wipe out a run (Duolingo's finding: freezes keep people
// going; guilt doesn't). Kept in this browser, per account, so a shared computer doesn't mix two people's streaks.
// Nothing is sent anywhere. Plain logic, unit-tested.

export const GOAL_KEY = "orbit.practiceGoal";
/** Warm-up answers checked in this browser (times), so the free warm-up counts toward the goal too. */
export const WARMUP_LOG_KEY = "orbit.warmupLog";
export const GOAL_CHOICES = [1, 2, 3, 5, 7] as const;
export const DEFAULT_GOAL = 3;
const MAX_LOG = 200;
const WEEKS = 26;
/** Met goals that earn a used freeze back. */
const FREEZE_BACK_AFTER = 4;
const DAY_MS = 86_400_000;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the goal still shows, it just isn't kept
  }
}

function accountKey(base: string, userId?: string | null): string {
  return `${base}.${userId || "guest"}`;
}

export function loadGoal(userId?: string | null): number {
  const n = read<number>(accountKey(GOAL_KEY, userId), DEFAULT_GOAL);
  return (GOAL_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_GOAL;
}

export function saveGoal(n: number, userId?: string | null): void {
  write(accountKey(GOAL_KEY, userId), n);
}

export function loadWarmupLog(userId?: string | null): number[] {
  const log = read<unknown>(accountKey(WARMUP_LOG_KEY, userId), []);
  return Array.isArray(log) ? log.filter((t): t is number => typeof t === "number" && Number.isFinite(t)) : [];
}

/** One warm-up answer checked now. */
export function logWarmupAnswer(now: number = Date.now(), userId?: string | null): void {
  write(accountKey(WARMUP_LOG_KEY, userId), [...loadWarmupLog(userId), now].slice(-MAX_LOG));
}

/** Monday 00:00, local time, of the week `t` is in. */
export function weekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Practice per week, this week first (index 0), `weeks` weeks back. */
export function weeklyCounts(times: number[], now: number, weeks: number = WEEKS): number[] {
  const counts = new Array<number>(weeks).fill(0);
  const thisWeek = weekStart(now);
  for (const t of times) {
    if (t > now) continue;
    const back = Math.round((thisWeek - weekStart(t)) / (7 * DAY_MS));
    if (back >= 0 && back < weeks) counts[back]! += 1;
  }
  return counts;
}

export interface GoalState {
  goal: number;
  /** Done this week. */
  done: number;
  met: boolean;
  /** Weeks in a row the goal was met, this week included once it's met. Frozen weeks keep the run, don't add to it. */
  weeks: number;
  /** A missed week would be covered. */
  freezeReady: boolean;
  /** Last week was missed and the freeze covered it. */
  frozeLastWeek: boolean;
  /** Days left this week, today included (Sunday: 1). */
  daysLeft: number;
}

/**
 * Where the goal stands. Walks the finished weeks oldest first: a met week adds to the run; a missed one is covered by
 * the freeze if it's ready (it comes back after FREEZE_BACK_AFTER met weeks), else ends the run. This week counts once
 * it's met, and never breaks the run while it's still going.
 */
export function goalState(times: number[], goal: number, now: number = Date.now()): GoalState {
  const counts = weeklyCounts(times, now);
  let run = 0;
  let freeze = true;
  let metSince = 0;
  let frozeLast = false;
  for (let i = counts.length - 1; i >= 1; i--) {
    frozeLast = false;
    if (counts[i]! >= goal) {
      run += 1;
      metSince += 1;
      if (!freeze && metSince >= FREEZE_BACK_AFTER) freeze = true;
    } else if (run > 0 && freeze) {
      freeze = false;
      metSince = 0;
      frozeLast = true;
    } else {
      run = 0;
    }
  }
  const done = counts[0]!;
  const met = done >= goal;
  const dow = (new Date(now).getDay() + 6) % 7; // Monday 0
  return { goal, done, met, weeks: run + (met ? 1 : 0), freezeReady: freeze, frozeLastWeek: frozeLast && run > 0, daysLeft: 7 - dow };
}
