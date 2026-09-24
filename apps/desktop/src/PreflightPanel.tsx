import { useCallback, useEffect, useState } from "react";
import type { PreflightCheck } from "@orbit/types";
import { cx, focusRing } from "@orbit/ui";
import { getVersion } from "@tauri-apps/api/app";
import { API_URL, api } from "./api";

export interface LocalAudioState {
  micName: string | null; // null = no microphone found
  systemAudio: boolean;
  /** "Capturing: Microsoft Teams" / "Capturing: Speakers (Realtek)". */
  interviewerSource: string | null;
  hasResume: boolean;
  hasJobDescription: boolean;
}

const ICON = { ok: "✓", warn: "!", fail: "✕" } as const;
const TONE = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  fail: "text-rose-600 dark:text-rose-400",
} as const;

function localChecks(s: LocalAudioState): PreflightCheck[] {
  const out: PreflightCheck[] = [];
  out.push(
    s.micName
      ? { id: "mic", label: "Microphone", status: "ok", detail: s.micName }
      : {
          id: "mic",
          label: "Microphone",
          status: "fail",
          detail: "No microphone found.",
          fix: "Plug one in, or allow microphone access in Windows Settings → Privacy & security → Microphone.",
        },
  );
  out.push(
    !s.systemAudio
      ? { id: "system", label: "Interviewer audio", status: "warn", detail: "Off — Orbit only hears your microphone.",
          fix: "Turn on interviewer audio below so Orbit can tell who's speaking." }
      : { id: "system", label: "Interviewer audio", status: "ok", detail: s.interviewerSource ?? "Default output" },
  );
  out.push(
    s.hasResume
      ? { id: "resume", label: "Resume", status: "ok", detail: "Selected." }
      : { id: "resume", label: "Resume", status: "warn", detail: "None selected.",
          fix: "Add or tick your resume below so answers use your real background." },
  );
  out.push(
    s.hasJobDescription
      ? { id: "jd", label: "Job description", status: "ok", detail: "Selected." }
      : { id: "jd", label: "Job description", status: "warn", detail: "None selected.",
          fix: "Optional: add the job description so answers fit the role." },
  );
  return out;
}

async function networkCheck(): Promise<PreflightCheck> {
  const t0 = performance.now();
  try {
    const r = await fetch(`${API_URL}/health`, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const ms = Math.round(performance.now() - t0);
    const slow = ms > 800;
    return { id: "network", label: "Network", status: slow ? "warn" : "ok", latency_ms: ms,
             detail: `${ms} ms to the Orbit server${slow ? " (slow)" : ""}.`,
             fix: slow ? "Answers may arrive late. A wired connection or closing downloads helps." : null };
  } catch {
    return { id: "network", label: "Network", status: "fail", detail: "Can't reach the Orbit server.",
             fix: "Check your internet connection (the server may also be waking up — re-check in 30 s)." };
  }
}

/** Pre-session checklist: local audio + documents, network, and the server's provider/allowance checks. */
export function PreflightPanel({ local, onStatus }: { local: LocalAudioState; onStatus?: (hasFailure: boolean) => void }) {
  const [remote, setRemote] = useState<PreflightCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);

  const run = useCallback(async (refresh: boolean) => {
    setChecking(true);
    const version = await getVersion().catch(() => undefined);
    const [net, server] = await Promise.all([
      networkCheck(),
      api.preflight({ ...(version ? { appVersion: version } : {}), refresh })
        .then((r) => r.checks)
        .catch((err: unknown): PreflightCheck[] => [{
          id: "server", label: "Orbit server", status: "fail",
          detail: err instanceof Error ? err.message : "Checks unavailable.",
          fix: "Re-check in a moment.",
        }]),
    ]);
    setRemote([net, ...server]);
    setChecking(false);
  }, []);

  useEffect(() => {
    void run(false);
  }, [run]);

  const checks = [...localChecks(local), ...(remote ?? [])];
  const problems = checks.filter((c) => c.status !== "ok");
  const failures = checks.filter((c) => c.status === "fail");
  useEffect(() => onStatus?.(failures.length > 0), [failures.length, onStatus]);

  const summary = remote === null
    ? "Checking…"
    : failures.length
      ? `${failures.length} problem${failures.length === 1 ? "" : "s"} to fix`
      : problems.length
        ? `Ready · ${problems.length} suggestion${problems.length === 1 ? "" : "s"}`
        : "Ready — everything checks out";

  return (
    <section aria-label="Pre-session checklist" className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
                className={cx("flex flex-1 items-center gap-2 text-left text-xs font-medium", focusRing)}>
          <span className={cx("text-sm", failures.length ? TONE.fail : problems.length ? TONE.warn : TONE.ok)}>
            {remote === null ? "…" : failures.length ? ICON.fail : problems.length ? ICON.warn : ICON.ok}
          </span>
          <span>Checklist</span>
          <span className="font-normal text-zinc-500">{summary}</span>
          <span className="ml-auto text-zinc-400">{open ? "▴" : "▾"}</span>
        </button>
        <button type="button" disabled={checking} onClick={() => void run(true)}
                className={cx("rounded-lg border border-zinc-200 px-2 py-0.5 text-xs disabled:opacity-40 dark:border-zinc-800", focusRing)}>
          {checking ? "Checking…" : "Re-check"}
        </button>
      </div>
      {(open || failures.length > 0) && (
        <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-1">
          {checks.filter((c) => open || c.status === "fail").map((c) => (
            <li key={c.id} className="flex gap-2 text-xs">
              <span className={cx("w-3 flex-none text-center font-bold", TONE[c.status])} aria-label={c.status}>
                {ICON[c.status]}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{c.label}</span>
                <span className="text-zinc-500"> — {c.detail}</span>
                {c.fix && c.status !== "ok" && <span className="block text-zinc-600 dark:text-zinc-300">{c.fix}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
