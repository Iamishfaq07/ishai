import { useCallback, useEffect, useState } from "react";
import type { PreflightCheck } from "@orbit/types";
import type { ApiClient } from "../api/client";
import { ChevronDown, CircleAlert, CircleCheck, CircleX, RefreshCw } from "../icons";
import { cx, focusRing } from "./cx";

const ICON = { ok: CircleCheck, warn: CircleAlert, fail: CircleX } as const;
const STATUS_LABEL = { ok: "OK", warn: "Warning", fail: "Problem" } as const;
const TONE = {
  ok: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  fail: "text-rose-600 dark:text-rose-400",
} as const;

async function networkCheck(healthUrl: string): Promise<PreflightCheck> {
  const t0 = performance.now();
  try {
    const r = await fetch(healthUrl, { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    const ms = Math.round(performance.now() - t0);
    const slow = ms > 800;
    return {
      id: "network",
      label: "Network",
      status: slow ? "warn" : "ok",
      latency_ms: ms,
      detail: `${ms} ms to the Orbit server${slow ? " (slow)" : ""}.`,
      fix: slow ? "Answers may arrive late. A wired connection or closing downloads helps." : null,
    };
  } catch {
    return {
      id: "network",
      label: "Network",
      status: "fail",
      severity: "blocker",
      detail: "Can't reach the Orbit server.",
      fix: "Check your internet connection (the server may also be waking up — re-check in 30 s).",
    };
  }
}

/**
 * Pre-session checklist, shared by web and desktop: the app's own device/document checks (`local`), a network round
 * trip, and the server's provider/allowance checks. `onStatus` reports failing blockers so Setup can gate Start.
 */
export function PreflightPanel({
  api,
  healthUrl,
  local,
  appVersion,
  onStatus,
}: {
  api: Pick<ApiClient, "preflight">;
  /** The server's /health URL (a plain round trip for the network check). */
  healthUrl: string;
  /** Checks only this app can make (microphone, interviewer audio, selected documents). */
  local: PreflightCheck[];
  /** Desktop: the installed version, so the server can flag an outdated app. */
  appVersion?: () => Promise<string | undefined>;
  onStatus?: (blockers: PreflightCheck[]) => void;
}) {
  const [remote, setRemote] = useState<PreflightCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);

  const run = useCallback(
    async (refresh: boolean) => {
      setChecking(true);
      const version = appVersion ? await appVersion().catch(() => undefined) : undefined;
      const [net, server] = await Promise.all([
        networkCheck(healthUrl),
        api
          .preflight({ ...(version ? { appVersion: version } : {}), refresh })
          .then((r) => r.checks)
          .catch((err: unknown): PreflightCheck[] => [
            {
              id: "server",
              label: "Orbit server",
              status: "fail",
              detail: err instanceof Error ? err.message : "Checks unavailable.",
              fix: "Re-check in a moment.",
            },
          ]),
      ]);
      setRemote([net, ...server]);
      setChecking(false);
    },
    [api, healthUrl, appVersion],
  );

  useEffect(() => {
    void run(false);
  }, [run]);

  const checks = [...local, ...(remote ?? [])];
  const problems = checks.filter((c) => c.status !== "ok");
  const failures = checks.filter((c) => c.status === "fail");
  const blockers = failures.filter((c) => c.severity === "blocker");
  const blockerKey = blockers.map((c) => c.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on which blockers fail, not the array identity
  useEffect(() => onStatus?.(blockers), [blockerKey, onStatus]);

  const overall = remote === null ? null : failures.length ? "fail" : problems.length ? "warn" : "ok";
  const summary =
    remote === null
      ? "Checking…"
      : failures.length
        ? `${failures.length} problem${failures.length === 1 ? "" : "s"} to fix`
        : problems.length
          ? `Ready · ${problems.length} tip${problems.length === 1 ? "" : "s"}` // short: the panel shares a narrow column
          : "All set";

  return (
    <section
      aria-label="Pre-session checklist"
      className={cx(
        "rounded-2xl p-3 ring-1",
        overall === "fail"
          ? "bg-rose-500/5 ring-rose-500/25"
          : overall === "ok"
            ? "bg-emerald-500/5 ring-emerald-500/20"
            : "bg-zinc-500/5 ring-zinc-200 dark:ring-white/10",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cx("tap-y flex min-w-0 flex-1 items-center gap-2 text-left text-xs font-medium", focusRing)}
        >
          {overall === null ? (
            <RefreshCw className="h-4 w-4 flex-none text-zinc-400 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <StatusIcon status={overall} size="h-4 w-4" />
          )}
          <span className="whitespace-nowrap">Ready check</span>
          <span className="truncate font-normal text-zinc-500 dark:text-zinc-400">{summary}</span>
          <ChevronDown
            className={cx(
              "ml-auto h-3.5 w-3.5 flex-none text-zinc-400 transition-transform motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </button>
        <button
          type="button"
          disabled={checking}
          onClick={() => void run(true)}
          className={cx(
            "tap-y rounded-lg border border-zinc-200 px-2 py-0.5 text-xs hover:bg-white/60 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5",
            focusRing,
          )}
        >
          {checking ? "Checking…" : "Re-check"}
        </button>
      </div>
      {(open || failures.length > 0) && (
        <ul className="mt-2 max-h-52 space-y-1.5 overflow-y-auto pr-1">
          {checks
            .filter((c) => open || c.status === "fail")
            .map((c) => (
              <li key={c.id} className="flex gap-2 text-xs">
                <StatusIcon status={c.status} />
                <span className="min-w-0">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-zinc-500 dark:text-zinc-400"> — {c.detail}</span>
                  {c.fix && c.status !== "ok" && <span className="block text-zinc-600 dark:text-zinc-300">{c.fix}</span>}
                </span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

function StatusIcon({ status, size = "h-3.5 w-3.5" }: { status: keyof typeof ICON; size?: string }) {
  const Icon = ICON[status];
  return (
    <span role="img" aria-label={STATUS_LABEL[status]} className={cx("mt-px flex-none", TONE[status])}>
      <Icon className={size} />
    </span>
  );
}
